import { createHash } from "node:crypto";
import { parseUniversalGraphSpec, type UniversalEdgeRelation, type UniversalGraphSpec, type UniversalNodeKind } from "./universal-graph-spec.js";
import { compareCodeUnits } from "./stable-string-order.js";

const knownOperations = new Set([
  "conv2d", "normalization", "activation", "pool", "dense", "flatten", "identity_projection",
  "token_projection", "encoder_stage", "decoder_stage", "self_attention", "cross_attention",
]);
const forbiddenControlText = /\b(?:com|worker|browser|visio|geometry|coordinates?|bounds|path|command|script|execution|renderer|rendering|svg|xml)\b|(?:[A-Za-z]:\\\\)|(?:\/[A-Za-z0-9._-]+){2,}/i;
const attributeValueTypes = new Set(["string", "number", "boolean"]);

export type PromptDeclarationNodeKind = "input" | "output" | "operator" | "module";
export type PromptDeclarationTopology = "complete" | "ambiguous";
export interface PromptDeclaredPort { portId: string; label?: string | null; representation?: string | null; semanticType?: string | null; }
export interface PromptDeclaredNode {
  nodeId: string; kind: PromptDeclarationNodeKind; label: string; operation?: string; semanticHints?: string[];
  attributes?: Record<string, string | number | boolean | null>; inputPorts: PromptDeclaredPort[]; outputPorts: PromptDeclaredPort[];
}
export interface PromptDeclaredEdge { edgeId: string; sourcePortId: string; targetPortId: string; relation?: Exclude<UniversalEdgeRelation, "candidate">; }
/** A bounded graph declaration carried in prompt text, without renderer controls. */
export interface PromptGraphDeclaration { graphId: string; topology?: PromptDeclarationTopology; nodes: PromptDeclaredNode[]; edges: PromptDeclaredEdge[]; }

export function compilePromptToUniversalGraphSpec(input: { sourceId: string; prompt: string; revision?: number }): UniversalGraphSpec {
  assertCompilerInput(input);
  const declaration = parsePromptDeclaration(input.prompt);
  assertBoundedPromptDeclaration(declaration);
  const promptHash = sha256(input.prompt);
  const evidence = new EvidenceFactory(input.sourceId, promptHash);
  const nodes = [...declaration.nodes].sort((left, right) => compareCodeUnits(left.nodeId, right.nodeId)).map((node) => projectNode(node, evidence));
  const ports = nodes.flatMap((node) => {
    const declarationNode = declaration.nodes.find((item) => item.nodeId === node.nodeId)!;
    return [...projectPorts(node.nodeId, declarationNode.inputPorts, "input", evidence), ...projectPorts(node.nodeId, declarationNode.outputPorts, "output", evidence)];
  });
  const edges = [...declaration.edges].sort((left, right) => compareCodeUnits(left.edgeId, right.edgeId)).map((edge) => ({
    edgeId: edge.edgeId, sourcePortId: edge.sourcePortId, targetPortId: edge.targetPortId, relation: edge.relation ?? "data", knowledge: "declared" as const, evidenceIds: [evidence.for(`prompt:edge:${edge.edgeId}`)],
  }));
  const topologyIsComplete = declaration.topology === "complete" && allDeclaredPortsAreConnected(nodes, edges);
  const unresolved = topologyIsComplete ? [] : [{
    id: "prompt-topology-unresolved",
    scope: "topology" as const,
    severity: "blocking" as const,
    evidenceIds: [evidence.for("prompt:topology:unresolved")],
  }];
  return parseUniversalGraphSpec({
    version: 1, graphId: declaration.graphId, revision: input.revision ?? 1, sourceIds: [input.sourceId], sourceHashes: [promptHash], nodes, ports, edges, groups: [], evidence: evidence.items(), topologyConfidence: topologyIsComplete ? 1 : 0.5,
    unresolved,
  });
}

function parsePromptDeclaration(prompt: string): PromptGraphDeclaration { try { return JSON.parse(prompt) as PromptGraphDeclaration; } catch { throw new Error("Prompt must be a JSON-serialized typed graph declaration"); } }
function projectNode(node: PromptDeclaredNode, evidence: EvidenceFactory) {
  const kind = nodeKind(node);
  return { nodeId: node.nodeId, kind, label: node.label, semanticHints: uniqueSorted(node.semanticHints ?? []), inputPortIds: node.inputPorts.map((port) => portId(node.nodeId, port.portId)).sort(compareCodeUnits), outputPortIds: node.outputPorts.map((port) => portId(node.nodeId, port.portId)).sort(compareCodeUnits), attributes: orderedAttributes(node.attributes ?? {}), shapeClaim: "unknown" as const, operationKnowledge: kind === "custom_operator" || kind === "custom_module" ? "custom" as const : "known" as const, evidenceIds: [evidence.for(`prompt:node:${node.nodeId}`)] };
}
function projectPorts(nodeId: string, ports: PromptDeclaredPort[], direction: "input" | "output", evidence: EvidenceFactory) { return [...ports].sort((left, right) => compareCodeUnits(left.portId, right.portId)).map((port) => ({ portId: portId(nodeId, port.portId), nodeId, direction, label: port.label ?? null, representation: port.representation ?? null, semanticType: port.semanticType ?? null, evidenceIds: [evidence.for(`prompt:port:${nodeId}:${direction}:${port.portId}`)] })); }
function nodeKind(node: PromptDeclaredNode): UniversalNodeKind { if (node.kind === "input") return "input"; if (node.kind === "output") return "output"; if (node.kind === "module") return "custom_module"; return node.operation && knownOperations.has(node.operation) ? "operator" : "custom_operator"; }
function allDeclaredPortsAreConnected(nodes: Array<{ inputPortIds: string[]; outputPortIds: string[] }>, edges: Array<{ sourcePortId: string; targetPortId: string }>): boolean {
  const declaredInputs = nodes.flatMap((node) => node.inputPortIds); const declaredOutputs = nodes.flatMap((node) => node.outputPortIds);
  if (declaredInputs.length === 0 && declaredOutputs.length === 0) return true;
  const connectedInputs = new Set(edges.map((edge) => edge.targetPortId)); const connectedOutputs = new Set(edges.map((edge) => edge.sourcePortId));
  return declaredInputs.every((id) => connectedInputs.has(id)) && declaredOutputs.every((id) => connectedOutputs.has(id));
}
function assertBoundedPromptDeclaration(declaration: PromptGraphDeclaration): void {
  const root = asRecord(declaration, "prompt declaration"); assertExactKeys(root, ["graphId", "topology", "nodes", "edges"], "prompt declaration"); assertSafeText(declaration.graphId, "graphId");
  if (declaration.topology !== undefined && declaration.topology !== "complete" && declaration.topology !== "ambiguous") throw new Error("Prompt declaration topology must be complete or ambiguous");
  if (!Array.isArray(declaration.nodes) || !Array.isArray(declaration.edges)) throw new Error("Prompt declaration nodes and edges must be arrays");
  for (const [index, node] of declaration.nodes.entries()) assertNode(node, index); for (const [index, edge] of declaration.edges.entries()) assertEdge(edge, index);
  assertUnique(declaration.nodes.map((node) => node.nodeId), "node ID"); assertUnique(declaration.edges.map((edge) => edge.edgeId), "edge ID"); assertUnique(declaration.edges.map((edge) => `${edge.sourcePortId}\u0000${edge.targetPortId}`), "edge endpoint pair");
}
function assertCompilerInput(input: { sourceId: string; prompt: string; revision?: number }): void { const value = asRecord(input, "compile prompt input"); assertExactKeys(value, ["sourceId", "prompt", "revision"], "compile prompt input"); assertSafeText(input.sourceId, "sourceId"); assertSafeText(input.prompt, "prompt"); if (input.revision !== undefined && (!Number.isInteger(input.revision) || input.revision <= 0)) throw new Error("revision must be a positive integer"); }
function assertNode(node: PromptDeclaredNode, index: number): void {
  const value = asRecord(node, `nodes[${index}]`); assertExactKeys(value, ["nodeId", "kind", "label", "operation", "semanticHints", "attributes", "inputPorts", "outputPorts"], `nodes[${index}]`); assertSafeText(node.nodeId, `nodes[${index}].nodeId`); assertSafeText(node.label, `nodes[${index}].label`);
  if (!( ["input", "output", "operator", "module"] as const).includes(node.kind)) throw new Error(`nodes[${index}].kind is not permitted`); if (node.operation !== undefined) assertSafeText(node.operation, `nodes[${index}].operation`); if (!Array.isArray(node.inputPorts) || !Array.isArray(node.outputPorts)) throw new Error(`nodes[${index}] ports must be arrays`);
  if (node.semanticHints !== undefined) { if (!Array.isArray(node.semanticHints)) throw new Error(`nodes[${index}].semanticHints must be an array`); for (const [hintIndex, hint] of node.semanticHints.entries()) assertSafeText(hint, `nodes[${index}].semanticHints[${hintIndex}]`); }
  if (node.attributes !== undefined) assertAttributes(node.attributes, `nodes[${index}].attributes`); for (const [portIndex, port] of node.inputPorts.entries()) assertPort(port, `nodes[${index}].inputPorts[${portIndex}]`); for (const [portIndex, port] of node.outputPorts.entries()) assertPort(port, `nodes[${index}].outputPorts[${portIndex}]`); assertUnique([...node.inputPorts, ...node.outputPorts].map((port) => port.portId), `port ID on ${node.nodeId}`);
}
function assertPort(port: PromptDeclaredPort, location: string): void { const value = asRecord(port, location); assertExactKeys(value, ["portId", "label", "representation", "semanticType"], location); assertSafeText(port.portId, `${location}.portId`); for (const [field, text] of Object.entries({ label: port.label, representation: port.representation, semanticType: port.semanticType })) if (text !== undefined && text !== null) assertSafeText(text, `${location}.${field}`); }
function assertEdge(edge: PromptDeclaredEdge, index: number): void { const value = asRecord(edge, `edges[${index}]`); assertExactKeys(value, ["edgeId", "sourcePortId", "targetPortId", "relation"], `edges[${index}]`); assertSafeText(edge.edgeId, `edges[${index}].edgeId`); assertSafeText(edge.sourcePortId, `edges[${index}].sourcePortId`); assertSafeText(edge.targetPortId, `edges[${index}].targetPortId`); if (edge.relation !== undefined && !( ["data", "skip", "merge", "condition", "feedback"] as const).includes(edge.relation)) throw new Error(`edges[${index}].relation is not permitted`); }
function assertAttributes(attributes: Record<string, string | number | boolean | null>, location: string): void { const value = asRecord(attributes, location); for (const [key, item] of Object.entries(value)) { assertSafeText(key, `${location}.${key}`); if (item !== null && (!attributeValueTypes.has(typeof item) || (typeof item === "number" && !Number.isFinite(item)))) throw new Error(`${location}.${key} has an invalid value`); if (typeof item === "string") assertSafeText(item, `${location}.${key}`); } }
function assertExactKeys(value: Record<string, unknown>, allowed: string[], location: string): void { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Prompt declaration contains forbidden control field ${location}.${key}`); }
function assertSafeText(value: unknown, location: string): asserts value is string { if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${location} must be non-empty text`); if (forbiddenControlText.test(value)) throw new Error(`Prompt declaration contains forbidden control text at ${location}`); }
function asRecord(value: unknown, location: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${location} must be an object`); return value as Record<string, unknown>; }
function assertUnique(values: string[], description: string): void { if (new Set(values).size !== values.length) throw new Error(`Prompt declaration contains duplicate ${description}`); }
function portId(nodeId: string, localPortId: string): string { return `${nodeId}:${localPortId}`; }
function orderedAttributes(attributes: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> { return Object.fromEntries(Object.entries(attributes).sort(([left], [right]) => compareCodeUnits(left, right))); }
function uniqueSorted(values: string[]): string[] { return [...new Set(values)].sort(compareCodeUnits); }
function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
class EvidenceFactory {
  private readonly evidenceByLocator = new Map<string, { evidenceId: string; sourceId: string; sourceHash: string; locator: string; excerptDigest: string }>();
  constructor(private readonly sourceId: string, private readonly sourceHash: string) {}
  for(locator: string): string { const existing = this.evidenceByLocator.get(locator); if (existing) return existing.evidenceId; const evidenceId = `e:${sha256(`${this.sourceId}\n${this.sourceHash}\n${locator}`).slice(0, 48)}`; this.evidenceByLocator.set(locator, { evidenceId, sourceId: this.sourceId, sourceHash: this.sourceHash, locator, excerptDigest: sha256(`${this.sourceHash}\n${locator}`) }); return evidenceId; }
  items() { return [...this.evidenceByLocator.values()].sort((left, right) => compareCodeUnits(left.evidenceId, right.evidenceId)); }
}
