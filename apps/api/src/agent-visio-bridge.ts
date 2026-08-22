import { createHash } from "node:crypto";
import { buildPublicationFigurePlan } from "../../../publication-figure-plan.js";
import { canonicalJson } from "./plan-snapshot.js";
import { parseCanonicalNetworkIR, type CanonicalNetworkIR } from "./network-ir-v2.js";

export interface WorkerFigureBounds { x: number; y: number; width: number; height: number; }
export interface WorkerFigurePrimitiveGroup {
  id: string;
  kind: string;
  primitiveIds: string[];
  bounds: WorkerFigureBounds;
  extrusionDepthFu: number;
  skewXFu: number;
  skewYFu: number;
  semantic: {
    sourceNodeId: string;
    stage: number;
    visualRole: string;
    layerRole: string;
    repeatCount: number;
    channelCount: number | null;
    tensorShape: Array<number | string>;
    inputSpatialSize?: number;
    outputSpatialSize?: number;
  };
}
export interface AgentVisioDiagram {
  figure: { title: string; stageLabels: string[] };
  nodes: [];
  edges: [];
  figurePlan: {
    coordinateSpace: { unit: "figure-unit"; figureUnitInches: number; origin: "top-left"; width: number; height: number };
    primitiveGroups: WorkerFigurePrimitiveGroup[];
    connectors: Array<{ id: string; kind: string; sourceGroupId: string; targetGroupId: string; sourcePrimitiveId: string; targetPrimitiveId: string; points: Array<{ x: number; y: number }> }>;
    labels: Array<{ id: string; groupId: string; text: string; x: number; y: number; width: number; height: number; fontSizePt: number }>;
  };
}
export interface AgentVisioBridgeResult {
  diagram: AgentVisioDiagram;
  planDigest: string;
}

const VGG16_REPEATS = [2, 2, 3, 3, 3] as const;

export function compileAgentCnnVisioDiagram(input: {
  draftId: string;
  revision: number;
  canonicalNetworkIR: unknown;
}): AgentVisioBridgeResult {
  if (!isIdentifier(input.draftId) || !Number.isSafeInteger(input.revision) || input.revision <= 0) {
    throw new Error("Agent Visio bridge requires a server-owned draft revision identity");
  }

  const ir = parseCanonicalNetworkIR(input.canonicalNetworkIR, undefined, { renderReady: true });
  assertCanonicalVgg16(ir);
  const built = buildPublicationFigurePlan(toVgg16WorkerSource(ir)) as { validation?: { valid?: boolean; violations?: unknown }; figure?: { title?: unknown }; coordinateSpace?: unknown; primitiveGroups?: unknown; connectors?: unknown; labels?: unknown };
  if (built.validation?.valid !== true) {
    throw new Error(`Agent Visio bridge produced an invalid VGG16 Figure Plan: ${Array.isArray(built.validation?.violations) ? built.validation.violations.join(", ") : "unknown"}`);
  }

  const diagram = projectWorkerDiagram(built);
  return {
    diagram,
    planDigest: createHash("sha256").update(canonicalJson({ draftId: input.draftId, revision: input.revision, diagram }), "utf8").digest("hex"),
  };
}

function assertCanonicalVgg16(ir: CanonicalNetworkIR): void {
  const convolutionStages = ir.nodes.filter((node) => node.op === "conv2d" || node.op === "depthwise_conv2d");
  const poolStages = ir.nodes.filter((node) => node.op === "pool");
  const repeatCounts = convolutionStages.map((node) => node.repeats?.count ?? 1);
  const hasInput = ir.nodes.some((node) => node.id === "input" && node.op === "input");
  const hasClassifierTail = ["flatten", "fc-1", "fc-2", "classifier"].every((id) => ir.nodes.some((node) => node.id === id));
  if (!hasInput || convolutionStages.length !== VGG16_REPEATS.length || poolStages.length !== VGG16_REPEATS.length || !hasClassifierTail || repeatCounts.some((count, index) => count !== VGG16_REPEATS[index])) {
    throw new Error("Agent Visio bridge supports only the canonical VGG16 topology");
  }
}

function toVgg16WorkerSource(ir: CanonicalNetworkIR): { figure: { id: string; title: string; description: string | null }; nodes: unknown[]; edges: unknown[] } {
  const tensorById = new Map(ir.tensors.map((tensor) => [tensor.id, tensor]));
  const nodes = ir.nodes
    .filter((node) => node.op !== "flatten" && node.op !== "output")
    .map((node, index) => {
      const tensor = node.outputTensorIds.map((id) => tensorById.get(id)).find(Boolean);
      const shape = tensor?.shape ?? [];
      const channelCount = numericChannelCount(shape);
      if (node.op === "input") return legacyNode(node, index, shape, channelCount, "input-rgb-tile", "input", 1);
      if (node.op === "conv2d" || node.op === "depthwise_conv2d") return legacyNode(node, index, shape, channelCount, "feature-map-stack", "convolution-relu", node.repeats?.count ?? 1);
      if (node.op === "pool") return legacyNode(node, index, shape, channelCount, "pooling-block", "max-pool", 1);
      if (node.id === "fc-1" || node.id === "fc-2") return legacyNode(node, index, shape, channelCount, "fully-connected", "fully-connected", 1);
      if (node.id === "classifier") return legacyNode(node, index, shape, channelCount, "softmax-block", "softmax-classifier", 1);
      throw new Error(`Canonical VGG16 contains an unsupported executable node: ${node.id}`);
    });

  const executableIds = new Set(nodes.map((node) => (node as { id: string }).id));
  const edges = ir.edges
    .filter((edge) => executableIds.has(edge.sourceNodeId) && executableIds.has(edge.targetNodeId))
    .map((edge) => ({ id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId, kind: edge.relation }));
  if (!edges.some((edge) => edge.source === "pool-5" && edge.target === "fc-1")) {
    edges.push({ id: "pool-5-to-fc-1", source: "pool-5", target: "fc-1", kind: "data" });
  }
  return { figure: { id: ir.figure.id, title: ir.figure.title, description: ir.figure.description }, nodes, edges };
}

function legacyNode(
  node: CanonicalNetworkIR["nodes"][number],
  stage: number,
  shape: Array<number | string>,
  channelCount: number | null,
  visualRole: string,
  layerRole: string,
  repeatCount: number,
) {
  return {
    id: node.id,
    stage,
    tensor: { shape },
    visualRole,
    layerRole,
    repeatCount,
    channelCount,
    visualEncoding: { spatialShape: numericSpatialShape(shape), extrusionDepthFu: visualRole === "feature-map-stack" ? 24 : 10 },
  };
}

function projectWorkerDiagram(built: { figure?: { title?: unknown }; coordinateSpace?: unknown; primitiveGroups?: unknown; connectors?: unknown; labels?: unknown }): AgentVisioDiagram {
  const plan = {
    coordinateSpace: built.coordinateSpace,
    primitiveGroups: built.primitiveGroups,
    connectors: built.connectors,
    labels: built.labels,
  } as AgentVisioDiagram["figurePlan"];
  if (!plan.coordinateSpace || !Array.isArray(plan.primitiveGroups) || !Array.isArray(plan.connectors) || !Array.isArray(plan.labels)) {
    throw new Error("Agent Visio bridge Figure Plan projection is incomplete");
  }
  return {
    figure: { title: typeof built.figure?.title === "string" ? built.figure.title : "VGG-16", stageLabels: [] },
    nodes: [],
    edges: [],
    figurePlan: structuredClone(plan),
  };
}

function numericSpatialShape(shape: Array<number | string>): number[] {
  const spatial = shape.slice(0, 2).filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0);
  return spatial.length === 2 ? spatial : [];
}

function numericChannelCount(shape: Array<number | string>): number | null {
  const candidate = shape.at(-1);
  return typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0 ? candidate : null;
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) && value.length <= 128;
}
