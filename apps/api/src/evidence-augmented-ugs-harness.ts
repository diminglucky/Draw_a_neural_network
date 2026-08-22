import { digestGenericPlanSnapshotValue } from "./generic-plan-snapshot.js";
import { compareCodeUnits } from "./stable-string-order.js";
import { parseUniversalGraphSpec, type UniversalEvidence, type UniversalGraphSpec } from "./universal-graph-spec.js";
import type { BoundedInterpretationRequest, BoundedPublicEvidence, InterpreterProposal } from "./architecture-interpretation-contract.js";

const identifier = /^(?=.{1,128}$)(?:[A-Za-z][A-Za-z0-9_-]{0,127}|[A-Za-z][A-Za-z0-9_-]{1,63}(?::[A-Za-z0-9_-]{1,63}){1,7})$/;
const digest = /^[a-f0-9]{64}$/i;
const safeText = /^[^\u0000-\u001f]{1,240}$/;
const forbiddenControlText = /\b(?:provider|renderer|native|worker|com|visio|command|script|execution|snapshot)\b/i;
const filesystemPath = /[\\/]/;
const sourceFileName = /(?:\b[A-Za-z0-9_-]+\.(?:py|pyi|js|mjs|cjs|jsx|ts|mts|cts|tsx|cs|csproj|java|kt|kts|go|rs|c|cc|cpp|cxx|h|hpp|json|ya?ml|toml|ini|cfg|conf|sh|ps1|bat|cmd|exe|dll|so|dylib|vsdx|svg|png|jpe?g|pdf)\b|\b(?:dockerfile|makefile|gemfile|rakefile|procfile)\b)/i;
const sourceLikeText = /(?:\b(?:async\s+)?(?:class|def|function|interface|struct|enum|namespace|module|import|export|from|return|throw|try|catch|finally|if|else|for|while|switch|case|const|let|var|using|package|public|private|protected|static|void|new|func|fn|sub|lambda)\b|\b(?:print|console\.log|system\.console\.writeline|write-host|invoke-expression|start-process|echo)\s*(?:\(|\b)|\bself(?:\.[A-Za-z_]\w*)+\s*=|(?:^|[;\r\n])\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*=(?!=|>))/i;
const publicEvidenceLocator = /^[A-Za-z][A-Za-z0-9_-]{1,63}(?::[A-Za-z0-9][A-Za-z0-9_-]{0,127}){0,7}$/;
const knownOperations = new Set([
  "conv2d", "normalization", "activation", "pool", "dense", "flatten", "identity_projection",
  "token_projection", "encoder_stage", "decoder_stage", "self_attention", "cross_attention",
]);

export interface EvidenceAugmentedInterpretation {
  readonly ugs: UniversalGraphSpec;
  readonly state: "formal" | "clarification";
  readonly proposalHash: string;
  readonly evidenceDigest: string;
}

/** Parses and canonicalizes the only data that may reach an optional interpreter. */
export function parseBoundedInterpretationRequest(input: unknown): BoundedInterpretationRequest {
  return parseRequest(input);
}

export function interpretBoundedEvidenceAugmentedProposal(
  input: BoundedInterpretationRequest,
  proposal: unknown,
): EvidenceAugmentedInterpretation {
  const request = parseBoundedInterpretationRequest(input);
  const evidenceDigest = digestGenericPlanSnapshotValue(request.evidence);
  if (proposal === undefined) return clarificationForUnavailableInterpreter(request, evidenceDigest);

  const parsedProposal = parseProposal(proposal, request);
  const proposalHash = digestGenericPlanSnapshotValue(parsedProposal);
  const ugs = projectProposal(request, parsedProposal, evidenceDigest, proposalHash);
  const firstClarification = [...ugs.unresolved]
    .filter((item) => item.scope === "topology" && item.severity === "blocking")
    .sort((left, right) => compareCodeUnits(left.id, right.id))[0];

  if (!firstClarification) return { ugs, state: "formal", proposalHash, evidenceDigest };
  return { ugs: parseUniversalGraphSpec({ ...ugs, unresolved: [firstClarification] }), state: "clarification", proposalHash, evidenceDigest };
}

export function architectureInputSourceId(requestId: string): string {
  return `architecture-input:${requestId}`;
}

function clarificationForUnavailableInterpreter(request: BoundedInterpretationRequest, evidenceDigest: string): EvidenceAugmentedInterpretation {
  const proposalHash = digestGenericPlanSnapshotValue(null);
  const derivedEvidence = requestEvidence(request, evidenceDigest, proposalHash);
  const ugs = parseUniversalGraphSpec({
    version: 1, graphId: `architecture:${request.requestId}`, revision: 1,
    sourceIds: uniqueSorted([...request.evidence.map((item) => item.sourceId), derivedEvidence.sourceId]),
    sourceHashes: uniqueSorted([...request.evidence.map((item) => item.sourceHash), derivedEvidence.sourceHash]),
    nodes: [{ nodeId: request.requestId, kind: "container", label: "Submitted architecture description", semanticHints: ["architecture-description"], inputPortIds: [], outputPortIds: [], attributes: {}, shapeClaim: "unknown", operationKnowledge: "custom", evidenceIds: [derivedEvidence.evidenceId] }],
    ports: [], edges: [], groups: [], evidence: [...request.evidence, derivedEvidence], topologyConfidence: 0,
    unresolved: [{ id: `${request.requestId}:interpreter-unavailable`, scope: "topology", severity: "blocking", evidenceIds: [derivedEvidence.evidenceId] }],
  });
  return { ugs, state: "clarification", proposalHash, evidenceDigest };
}

function projectProposal(request: BoundedInterpretationRequest, proposal: InterpreterProposal, evidenceDigest: string, proposalHash: string): UniversalGraphSpec {
  const derivedEvidence = requestEvidence(request, evidenceDigest, proposalHash);
  const unresolved = [...proposal.unresolved, ...topologyDirectionUnresolved(proposal), ...topologySemanticUnresolved(proposal)];
  return parseUniversalGraphSpec({
    version: 1, graphId: `architecture:${request.requestId}`, revision: 1,
    sourceIds: uniqueSorted([...request.evidence.map((item) => item.sourceId), derivedEvidence.sourceId]),
    sourceHashes: uniqueSorted([...request.evidence.map((item) => item.sourceHash), derivedEvidence.sourceHash]),
    nodes: proposal.nodes.map((node) => ({
      nodeId: node.nodeId,
      kind: node.kind === "module" ? "custom_module" : node.kind === "operator" && !knownOperations.has(node.operation ?? "") ? "custom_operator" : node.kind,
      label: node.label, semanticHints: uniqueSorted(node.semanticHints ?? []), inputPortIds: uniqueSorted(node.inputPortIds), outputPortIds: uniqueSorted(node.outputPortIds), attributes: orderedAttributes(node.attributes ?? {}), shapeClaim: "unknown",
      operationKnowledge: node.kind === "module" || (node.kind === "operator" && !knownOperations.has(node.operation ?? "")) ? "custom" : "known", evidenceIds: uniqueSorted(node.evidenceIds),
    })),
    ports: proposal.ports.map((port) => ({ portId: port.portId, nodeId: port.nodeId, direction: port.direction, label: port.label ?? null, representation: port.representation ?? null, semanticType: port.semanticType ?? null, evidenceIds: uniqueSorted(port.evidenceIds) })),
    edges: proposal.edges.map((edge) => ({ edgeId: edge.edgeId, sourcePortId: edge.sourcePortId, targetPortId: edge.targetPortId, relation: edge.relation ?? "data", knowledge: "declared", evidenceIds: uniqueSorted(edge.evidenceIds) })),
    groups: [], evidence: [...request.evidence, derivedEvidence], topologyConfidence: unresolved.some((item) => item.scope === "topology" && item.severity === "blocking") ? 0.5 : 1,
    unresolved: unresolved.map((item) => ({ id: item.id, scope: item.scope, severity: item.severity, evidenceIds: uniqueSorted(item.evidenceIds) })),
  });
}

function topologyDirectionUnresolved(proposal: InterpreterProposal): Array<{ id: string; scope: "topology"; severity: "blocking"; evidenceIds: readonly string[] }> {
  const connectedPortIds = new Set(proposal.edges.flatMap((edge) => [edge.sourcePortId, edge.targetPortId]));
  const usedIds = new Set(proposal.unresolved.map((item) => item.id));
  return proposal.ports
    .filter((port) => !connectedPortIds.has(port.portId))
    .sort((left, right) => compareCodeUnits(left.portId, right.portId))
    .map((port) => {
      const base = `topology-direction:${port.portId}`;
      let id = base;
      let suffix = 2;
      while (usedIds.has(id)) id = `${base}:${suffix++}`;
      usedIds.add(id);
      return { id, scope: "topology" as const, severity: "blocking" as const, evidenceIds: port.evidenceIds };
    });
}

function topologySemanticUnresolved(proposal: InterpreterProposal): Array<{ id: string; scope: "topology"; severity: "blocking"; evidenceIds: readonly string[] }> {
  const portById = new Map(proposal.ports.map((port) => [port.portId, port]));
  const incomingByNode = new Map<string, number>();
  const outgoingByNode = new Map<string, number>();
  const incomingSourceNodes = new Map<string, Set<string>>();
  const skipByTargetNode = new Set<string>();
  const dataByTargetNode = new Set<string>();
  for (const edge of proposal.edges) {
    const source = portById.get(edge.sourcePortId);
    const target = portById.get(edge.targetPortId);
    if (source) outgoingByNode.set(source.nodeId, (outgoingByNode.get(source.nodeId) ?? 0) + 1);
    if (target) {
      incomingByNode.set(target.nodeId, (incomingByNode.get(target.nodeId) ?? 0) + 1);
      if (source) (incomingSourceNodes.get(target.nodeId) ?? incomingSourceNodes.set(target.nodeId, new Set()).get(target.nodeId)!).add(source.nodeId);
      if (edge.relation === "skip") skipByTargetNode.add(target.nodeId);
      if (edge.relation === "data") dataByTargetNode.add(target.nodeId);
    }
  }
  const usedIds = new Set(proposal.unresolved.map((item) => item.id));
  const result: Array<{ id: string; scope: "topology"; severity: "blocking"; evidenceIds: readonly string[] }> = [];
  const add = (base: string, evidenceIds: readonly string[]) => {
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) id = `${base}:${suffix++}`;
    usedIds.add(id);
    result.push({ id, scope: "topology", severity: "blocking", evidenceIds });
  };
  for (const node of [...proposal.nodes].sort((left, right) => compareCodeUnits(left.nodeId, right.nodeId))) {
    const incoming = incomingByNode.get(node.nodeId) ?? 0;
    const outgoing = outgoingByNode.get(node.nodeId) ?? 0;
    const sourceCount = incomingSourceNodes.get(node.nodeId)?.size ?? 0;
    const hasConnectedOutput = node.outputPortIds.length > 0 && outgoing > 0;
    if (node.kind === "input" && (incoming > 0 || !hasConnectedOutput)) add(`topology-input-direction:${node.nodeId}`, node.evidenceIds);
    if (node.kind === "output" && (outgoing > 0 || node.inputPortIds.length === 0 || incoming === 0)) add(`topology-output-direction:${node.nodeId}`, node.evidenceIds);
    if ((node.operation === "add" || node.operation === "concat") && (node.inputPortIds.length < 2 || sourceCount < 2 || !hasConnectedOutput)) add(`topology-merge-arity:${node.nodeId}`, node.evidenceIds);
    if (node.operation === "residual" && (node.inputPortIds.length < 2 || sourceCount < 2 || !dataByTargetNode.has(node.nodeId) || !skipByTargetNode.has(node.nodeId) || !hasConnectedOutput)) add(`topology-residual-direction:${node.nodeId}`, node.evidenceIds);
    if (node.operation === "cross_attention") {
      const inputSemanticTypes = node.inputPortIds.map((portId) => portById.get(portId)?.semanticType?.toLowerCase() ?? "");
      const hasQuery = inputSemanticTypes.includes("query");
      const hasContext = inputSemanticTypes.some((type) => type === "context" || type === "key" || type === "value");
      if (node.inputPortIds.length < 2 || sourceCount < 2 || !hasQuery || !hasContext || !hasConnectedOutput) add(`topology-cross-attention-direction:${node.nodeId}`, node.evidenceIds);
    }
  }
  return result;
}

function requestEvidence(request: BoundedInterpretationRequest, evidenceDigest: string, proposalHash: string): UniversalEvidence {
  return { evidenceId: `architecture-input:${request.requestId}`, sourceId: architectureInputSourceId(request.requestId), sourceHash: evidenceDigest, locator: "architecture-description:public-evidence", excerptDigest: proposalHash };
}

function parseRequest(input: unknown): BoundedInterpretationRequest {
  const value = record(input, "architecture interpretation request");
  exactKeys(value, ["requestId", "evidence", "detail", "maxNodes", "maxEdges"], "architecture interpretation request");
  identifierValue(value.requestId, "requestId");
  if ((value.requestId as string).length > 100) throw new Error("requestId is too long");
  if (!Array.isArray(value.evidence) || value.evidence.length === 0 || value.evidence.length > 512) throw new Error("architecture interpretation evidence is invalid");
  const evidence = value.evidence.map((item, index) => parseEvidence(item, `evidence[${index}]`));
  unique(evidence.map((item) => item.evidenceId), "evidence ID");
  if (!( ["overview", "architecture", "operator_detail"] as const).includes(value.detail as never)) throw new Error("architecture interpretation detail is invalid");
  capacity(value.maxNodes, "maxNodes", 256); capacity(value.maxEdges, "maxEdges", 2048);
  return { requestId: value.requestId as string, evidence: evidence.sort((left, right) => compareCodeUnits(left.evidenceId, right.evidenceId)), detail: value.detail as BoundedInterpretationRequest["detail"], maxNodes: value.maxNodes as number, maxEdges: value.maxEdges as number };
}

function parseEvidence(input: unknown, location: string): BoundedPublicEvidence {
  const value = record(input, location); exactKeys(value, ["evidenceId", "sourceId", "sourceHash", "locator", "excerptDigest"], location);
  identifierValue(value.evidenceId, `${location}.evidenceId`); identifierValue(value.sourceId, `${location}.sourceId`); digestValue(value.sourceHash, `${location}.sourceHash`); locatorValue(value.locator, `${location}.locator`); digestValue(value.excerptDigest, `${location}.excerptDigest`);
  if ((value.evidenceId as string).startsWith("architecture-input:") || (value.sourceId as string).startsWith("architecture-input:")) throw new Error(`${location} uses a reserved architecture-input namespace`);
  return { evidenceId: value.evidenceId as string, sourceId: value.sourceId as string, sourceHash: (value.sourceHash as string).toLowerCase(), locator: value.locator as string, excerptDigest: (value.excerptDigest as string).toLowerCase() };
}

function parseProposal(input: unknown, request: BoundedInterpretationRequest): InterpreterProposal {
  const value = record(input, "interpreter proposal"); exactKeys(value, ["version", "nodes", "ports", "edges", "unresolved"], "interpreter proposal");
  if (value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.ports) || !Array.isArray(value.edges) || !Array.isArray(value.unresolved)) throw new Error("interpreter proposal is invalid");
  if (value.nodes.length === 0 || value.nodes.length > request.maxNodes || value.ports.length > 1024 || value.edges.length > request.maxEdges || value.unresolved.length > 64) throw new Error("interpreter proposal exceeds bounded capacity");
  const evidenceIds = new Set(request.evidence.map((item) => item.evidenceId));
  const nodes = value.nodes.map((item, index) => parseNode(item, index, evidenceIds)); const ports = value.ports.map((item, index) => parsePort(item, index, evidenceIds)); const edges = value.edges.map((item, index) => parseEdge(item, index, evidenceIds)); const unresolved = value.unresolved.map((item, index) => parseUnresolved(item, index, evidenceIds));
  unique(nodes.map((item) => item.nodeId), "node ID"); unique(ports.map((item) => item.portId), "port ID"); unique(edges.map((item) => item.edgeId), "edge ID"); unique(unresolved.map((item) => item.id), "unresolved ID");
  return { version: 1, nodes: nodes.sort((left, right) => compareCodeUnits(left.nodeId, right.nodeId)), ports: ports.sort((left, right) => compareCodeUnits(left.portId, right.portId)), edges: edges.sort((left, right) => compareCodeUnits(left.edgeId, right.edgeId)), unresolved: unresolved.sort((left, right) => compareCodeUnits(left.id, right.id)) };
}

function parseNode(input: unknown, index: number, evidenceIds: Set<string>) {
  const location = `nodes[${index}]`; const value = record(input, location); exactKeys(value, ["nodeId", "kind", "label", "operation", "semanticHints", "attributes", "inputPortIds", "outputPortIds", "evidenceIds"], location);
  identifierValue(value.nodeId, `${location}.nodeId`); textValue(value.label, `${location}.label`); if (!( ["input", "output", "operator", "module"] as const).includes(value.kind as never)) throw new Error(`${location}.kind is invalid`); if (value.operation !== undefined) textValue(value.operation, `${location}.operation`);
  const semanticHints = stringList(value.semanticHints ?? [], `${location}.semanticHints`, 32, false); const inputPortIds = stringList(value.inputPortIds, `${location}.inputPortIds`, 32, true); const outputPortIds = stringList(value.outputPortIds, `${location}.outputPortIds`, 32, true); const nodeEvidenceIds = evidenceList(value.evidenceIds, `${location}.evidenceIds`, evidenceIds); const attributes = parseAttributes(value.attributes ?? {}, `${location}.attributes`);
  return { nodeId: value.nodeId as string, kind: value.kind as "input" | "output" | "operator" | "module", label: value.label as string, ...(value.operation === undefined ? {} : { operation: value.operation as string }), ...(semanticHints.length === 0 ? {} : { semanticHints }), ...(Object.keys(attributes).length === 0 ? {} : { attributes }), inputPortIds, outputPortIds, evidenceIds: nodeEvidenceIds };
}

function parsePort(input: unknown, index: number, evidenceIds: Set<string>) {
  const location = `ports[${index}]`; const value = record(input, location); exactKeys(value, ["portId", "nodeId", "direction", "label", "representation", "semanticType", "evidenceIds"], location);
  identifierValue(value.portId, `${location}.portId`); identifierValue(value.nodeId, `${location}.nodeId`); if (value.direction !== "input" && value.direction !== "output") throw new Error(`${location}.direction is invalid`);
  for (const field of ["label", "representation", "semanticType"] as const) if (value[field] !== undefined && value[field] !== null) textValue(value[field], `${location}.${field}`);
  return { portId: value.portId as string, nodeId: value.nodeId as string, direction: value.direction as "input" | "output", ...(value.label === undefined ? {} : { label: value.label as string | null }), ...(value.representation === undefined ? {} : { representation: value.representation as string | null }), ...(value.semanticType === undefined ? {} : { semanticType: value.semanticType as string | null }), evidenceIds: evidenceList(value.evidenceIds, `${location}.evidenceIds`, evidenceIds) };
}

function parseEdge(input: unknown, index: number, evidenceIds: Set<string>) {
  const location = `edges[${index}]`; const value = record(input, location); exactKeys(value, ["edgeId", "sourcePortId", "targetPortId", "relation", "evidenceIds"], location);
  identifierValue(value.edgeId, `${location}.edgeId`); identifierValue(value.sourcePortId, `${location}.sourcePortId`); identifierValue(value.targetPortId, `${location}.targetPortId`); if (value.relation !== undefined && !( ["data", "skip", "merge", "condition", "feedback"] as const).includes(value.relation as never)) throw new Error(`${location}.relation is invalid`);
  return { edgeId: value.edgeId as string, sourcePortId: value.sourcePortId as string, targetPortId: value.targetPortId as string, ...(value.relation === undefined ? {} : { relation: value.relation as "data" | "skip" | "merge" | "condition" | "feedback" }), evidenceIds: evidenceList(value.evidenceIds, `${location}.evidenceIds`, evidenceIds) };
}

function parseUnresolved(input: unknown, index: number, evidenceIds: Set<string>) {
  const location = `unresolved[${index}]`; const value = record(input, location); exactKeys(value, ["id", "scope", "severity", "evidenceIds"], location);
  identifierValue(value.id, `${location}.id`); if (!( ["operation", "shape", "topology"] as const).includes(value.scope as never) || !( ["blocking", "warning"] as const).includes(value.severity as never)) throw new Error(`${location} is invalid`);
  return { id: value.id as string, scope: value.scope as "operation" | "shape" | "topology", severity: value.severity as "blocking" | "warning", evidenceIds: evidenceList(value.evidenceIds, `${location}.evidenceIds`, evidenceIds) };
}

function parseAttributes(input: unknown, location: string): Record<string, string | number | boolean | null> { const value = record(input, location); if (Object.keys(value).length > 32) throw new Error(`${location} exceeds bounded capacity`); const attributes: Record<string, string | number | boolean | null> = {}; for (const [key, item] of Object.entries(value)) { if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || forbiddenControlText.test(key)) throw new Error(`${location}.${key} is invalid`); if (item !== null && typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") throw new Error(`${location}.${key} is invalid`); if (typeof item === "number" && !Number.isFinite(item)) throw new Error(`${location}.${key} is invalid`); if (typeof item === "string") textValue(item, `${location}.${key}`); attributes[key] = item; } return attributes; }
function evidenceList(input: unknown, location: string, knownEvidenceIds: Set<string>): string[] { const values = stringList(input, location, 64, false); if (values.length === 0) throw new Error(`${location} must reference public evidence`); for (const item of values) if (!knownEvidenceIds.has(item)) throw new Error(`${location} references unsupported evidence`); return values; }
function stringList(input: unknown, location: string, maximum: number, identifiers: boolean): string[] { if (!Array.isArray(input) || input.length > maximum) throw new Error(`${location} is invalid`); const values = input.map((item, index) => { if (identifiers) identifierValue(item, `${location}[${index}]`); else textValue(item, `${location}[${index}]`); return item as string; }); unique(values, location); return uniqueSorted(values); }
function record(input: unknown, location: string): Record<string, unknown> { if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) throw new Error(`${location} must be a plain object`); return input as Record<string, unknown>; }
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], location: string): void { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${location} contains an unknown field`); }
function identifierValue(value: unknown, location: string): asserts value is string { if (typeof value !== "string" || !identifier.test(value)) throw new Error(`${location} is invalid`); }
function digestValue(value: unknown, location: string): asserts value is string { if (typeof value !== "string" || !digest.test(value)) throw new Error(`${location} is invalid`); }
function textValue(value: unknown, location: string): asserts value is string { if (typeof value !== "string" || !safeText.test(value) || forbiddenControlText.test(value) || filesystemPath.test(value) || sourceFileName.test(value) || sourceLikeText.test(value)) throw new Error(`${location} is invalid`); }
function locatorValue(value: unknown, location: string): asserts value is string { if (typeof value !== "string" || !publicEvidenceLocator.test(value)) throw new Error(`${location} is invalid`); }
function capacity(value: unknown, location: string, maximum: number): asserts value is number { if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum) throw new Error(`${location} is invalid`); }
function unique(values: readonly string[], location: string): void { if (new Set(values).size !== values.length) throw new Error(`${location} contains duplicate values`); }
function uniqueSorted(values: readonly string[]): string[] { return [...new Set(values)].sort(compareCodeUnits); }
function orderedAttributes(attributes: Readonly<Record<string, string | number | boolean | null>>): Record<string, string | number | boolean | null> { return Object.fromEntries(Object.entries(attributes).sort(([left], [right]) => compareCodeUnits(left, right))); }
