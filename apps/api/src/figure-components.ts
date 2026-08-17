import {
  parseArchitectureIRv3,
  type ArchitectureEdge,
  type ArchitectureIRNode,
  type ArchitectureIRv3,
  type PortRef,
  type RepeatSemantic,
  type TypedPort,
} from "./network-ir-v3.js";

export const FIGURE_COMPONENT_CONTRACT_VERSION = 1 as const;

export type FigureComponentKind = "terminal" | "operator" | "merge" | "attention" | "repeat";
export type FigureComponentPortDirection = "input" | "output";
export type FigureComponentTransport = "data" | "condition";

export interface FigureComponentPort {
  id: string;
  direction: FigureComponentPortDirection;
  representation: TypedPort["representation"];
  semanticType: TypedPort["semanticType"];
  shape?: TypedPort["shape"];
}

export interface FigureComponent {
  id: string;
  kind: FigureComponentKind;
  semanticRole: string;
  parentModuleId: string | null;
  inputPorts: FigureComponentPort[];
  outputPorts: FigureComponentPort[];
  repeat?: RepeatSemantic;
  evidenceIds: string[];
}

export interface FigureComponentConnection {
  id: string;
  source: PortRef;
  target: PortRef;
  transport: FigureComponentTransport;
  evidenceIds: string[];
}

export interface FigureComponentManifest {
  contractVersion: typeof FIGURE_COMPONENT_CONTRACT_VERSION;
  semanticCompilerVersion: string;
  supportedNodeKinds: Array<ArchitectureIRNode["kind"]>;
  supportedEdgeTransports: FigureComponentTransport[];
  supportsLayout: false;
  supportsRendering: false;
}

export interface FigureComponentGraph {
  version: typeof FIGURE_COMPONENT_CONTRACT_VERSION;
  graphId: string;
  manifest: FigureComponentManifest;
  inputs: PortRef[];
  outputs: PortRef[];
  components: FigureComponent[];
  connections: FigureComponentConnection[];
  evidenceIndex: ArchitectureIRv3["evidenceIndex"];
}

export interface FigureComponentUnresolved {
  code: "blocking-unresolved" | "unsupported-node-kind" | "unsupported-edge-transport";
  message: string;
  nodeId?: string;
  edgeId?: string;
  questionId?: string;
}

export type FigureComponentContractResult =
  | { status: "ready"; graph: FigureComponentGraph }
  | { status: "unresolved"; graphId: string; unresolved: FigureComponentUnresolved[] };

const supportedNodeKinds = ["input", "output", "module", "operator", "merge", "attention", "repeat", "split", "adapter"] as const;
const supportedEdgeTransports = ["data", "condition"] as const;

const manifest: FigureComponentManifest = {
  contractVersion: FIGURE_COMPONENT_CONTRACT_VERSION,
  semanticCompilerVersion: "figure-components-v1",
  supportedNodeKinds: [...supportedNodeKinds],
  supportedEdgeTransports: [...supportedEdgeTransports],
  supportsLayout: false,
  supportsRendering: false,
};

export function createFigureComponentGraph(input: ArchitectureIRv3): FigureComponentContractResult {
  const ir = parseArchitectureIRv3(input);
  const unresolved: FigureComponentUnresolved[] = ir.unresolved
    .filter((question) => question.severity === "blocking")
    .map((question) => ({
      code: "blocking-unresolved" as const,
      message: `Architecture IR contains blocking question ${question.conflictKey}`,
      questionId: question.id,
    }));

  for (const node of ir.nodes) {
    if (!supportedNodeKinds.includes(node.kind as (typeof supportedNodeKinds)[number])) {
      unresolved.push({ code: "unsupported-node-kind", message: `Figure components do not support node kind ${node.kind}`, nodeId: node.id });
    }
  }
  for (const edge of ir.edges) {
    if (!supportedEdgeTransports.includes(edge.transport as (typeof supportedEdgeTransports)[number])) {
      unresolved.push({ code: "unsupported-edge-transport", message: `Figure components do not support ${edge.transport} edges`, edgeId: edge.id });
    }
  }
  if (unresolved.length > 0) return { status: "unresolved", graphId: ir.graphId, unresolved };

  const moduleByNodeId = new Map<string, string>();
  for (const module of ir.modules) for (const nodeId of module.memberNodeIds) moduleByNodeId.set(nodeId, module.id);
  return {
    status: "ready",
    graph: {
      version: FIGURE_COMPONENT_CONTRACT_VERSION,
      graphId: ir.graphId,
      manifest: structuredClone(manifest),
      inputs: ir.inputs.map((ref) => ({ ...ref })),
      outputs: ir.outputs.map((ref) => ({ ...ref })),
      components: ir.nodes.map((node) => toFigureComponent(node, moduleByNodeId.get(node.id) ?? null)),
      connections: ir.edges.map(toFigureConnection),
      evidenceIndex: structuredClone(ir.evidenceIndex),
    },
  };
}

function toFigureComponent(node: ArchitectureIRNode, parentModuleId: string | null): FigureComponent {
  return {
    id: node.id,
    kind: componentKind(node),
    semanticRole: node.semanticRole,
    parentModuleId,
    inputPorts: node.inputPorts.map((port) => toFigurePort(port, "input")),
    outputPorts: node.outputPorts.map((port) => toFigurePort(port, "output")),
    ...(node.repeat ? { repeat: structuredClone(node.repeat) } : {}),
    evidenceIds: [...node.evidenceIds],
  };
}

function componentKind(node: ArchitectureIRNode): FigureComponentKind {
  if (node.kind === "input" || node.kind === "output") return "terminal";
  if (node.kind === "merge") return "merge";
  if (node.kind === "attention") return "attention";
  if (node.kind === "repeat") return "repeat";
  return "operator";
}

function toFigurePort(port: TypedPort, direction: FigureComponentPortDirection): FigureComponentPort {
  return {
    id: port.id,
    direction,
    representation: port.representation,
    semanticType: port.semanticType,
    ...(port.shape ? { shape: structuredClone(port.shape) } : {}),
  };
}

function toFigureConnection(edge: ArchitectureEdge): FigureComponentConnection {
  if (edge.transport === "feedback") throw new Error("Feedback edges must be resolved before creating Figure Components");
  return {
    id: edge.id,
    source: { ...edge.source },
    target: { ...edge.target },
    transport: edge.transport,
    evidenceIds: [...edge.evidenceIds],
  };
}
