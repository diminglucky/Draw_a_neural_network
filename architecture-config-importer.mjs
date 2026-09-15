import { createHash } from "node:crypto";
import { parse } from "yaml";

export function importArchitectureConfig(document, context = {}) {
  let value;
  try {
    value = typeof document === "string" ? parse(document) : structuredClone(document);
  } catch (error) {
    return { status: "invalid", graph: emptyGraph(), claims: [], diagnostics: [{ code: "invalid-config", message: error.message }] };
  }
  const declarations = [];
  collectDeclarations(value, [], declarations);
  if (!declarations.length) {
    return { status: "unresolved", graph: emptyGraph(), claims: [], diagnostics: [{ code: "no-module-declarations", message: "Configuration contains no recognizable module declarations." }] };
  }

  const nodes = declarations.map((declaration, index) => normalizeDeclaration(declaration, index));
  const edges = [];
  const diagnostics = [];
  for (let index = 0; index < nodes.length; index += 1) {
    for (const reference of asReferences(nodes[index].from)) {
      const source = resolveReference(reference, index, nodes);
      if (!source) {
        if (!(index === 0 && reference === -1)) diagnostics.push({ code: "unresolved-module-reference", nodeId: nodes[index].id, reference });
        continue;
      }
      edges.push({ id: `config-edge-${edges.length + 1}`, source, target: nodes[index].id, status: "grounded" });
    }
  }
  const publicNodes = nodes.map(({ from, ...node }) => node);
  const sourceId = String(context.sourceId || "config-source");
  const claims = publicNodes.flatMap((node) => [
    claim(`${node.id}:operator`, node.id, "operator", node.operator, sourceId),
    claim(`${node.id}:repeat`, node.id, "repeat", node.repeat, sourceId),
    claim(`${node.id}:parameters`, node.id, "parameters", node.parameters, sourceId),
  ]).concat(edges.map((edge) => claim(`${edge.id}:endpoints`, edge.id, "endpoints", { source: edge.source, target: edge.target }, sourceId)));
  const content = typeof document === "string" ? document : stableJson(document);
  return {
    status: diagnostics.length ? "unresolved" : "grounded",
    sources: [{ id: sourceId, kind: "config", uri: context.uri || "", revision: context.revision || "", sha256: createHash("sha256").update(content).digest("hex"), authority: Number(context.authority || 0) }],
    graph: { nodes: publicNodes, edges, ports: [], tensors: [], containers: [] },
    claims,
    diagnostics,
  };
}

function collectDeclarations(value, path, output) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (isDeclaration(item)) output.push({ value: item, path: [...path, index] });
      else collectDeclarations(item, [...path, index], output);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) collectDeclarations(child, [...path, key], output);
  }
}

function isDeclaration(value) {
  return Array.isArray(value) && value.length >= 3 && Number.isFinite(value[1]) && typeof value[2] === "string"
    || Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value.module || value.op || value.type) === "string");
}

function normalizeDeclaration(declaration, index) {
  const value = declaration.value;
  const prefix = declaration.path.slice(0, -1).map(String).join("-") || "module";
  if (Array.isArray(value)) {
    return { id: `${prefix}-${declaration.path.at(-1)}`, operator: value[2], repeat: positiveRepeat(value[1]), parameters: clone(value[3]), from: value[0], declarationIndex: index };
  }
  return {
    id: String(value.id || `${prefix}-${declaration.path.at(-1)}`),
    operator: String(value.module || value.op || value.type),
    repeat: positiveRepeat(value.repeat ?? value.repeats ?? 1),
    parameters: clone(value.args ?? value.parameters ?? {}),
    from: value.from ?? value.inputs ?? -1,
    declarationIndex: index,
  };
}

function resolveReference(reference, index, nodes) {
  if (typeof reference === "string") return nodes.some((node) => node.id === reference) ? reference : undefined;
  if (!Number.isInteger(reference)) return undefined;
  const targetIndex = reference < 0 ? index + reference : reference;
  return targetIndex >= 0 && targetIndex < index ? nodes[targetIndex].id : undefined;
}

function asReferences(value) { return Array.isArray(value) ? value : [value]; }
function positiveRepeat(value) { return Number.isInteger(value) && value > 0 ? value : 1; }
function claim(id, subjectId, predicate, value, sourceId) { return { id, subjectId, predicate, value, sourceIds: [sourceId], confidence: 1, status: "grounded" }; }
function emptyGraph() { return { nodes: [], edges: [], ports: [], tensors: [], containers: [] }; }
function clone(value) { return value === undefined ? {} : structuredClone(value); }
function stableJson(value) {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}
