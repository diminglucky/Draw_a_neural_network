import { createFigureComponentGraph, type FigureComponent, type FigureComponentConnection, type FigureComponentGraph, type FigureComponentKind, type FigureComponentPort, type FigureComponentContractResult } from "./figure-components.js";
import type { FigureIntent } from "./figure-intent.js";
import type { ArchitectureIRv3, PortRef } from "./network-ir-v3.js";

export const COMPOSABLE_DAG_COMPILER_VERSION = "composable-dag-v1" as const;
export const COMPOSABLE_DAG_LAYOUT_VERSION = "composable-dag-layout-v1" as const;

export interface FigurePoint { x: number; y: number; }
export interface FigureBounds { x: number; y: number; width: number; height: number; }

export interface ComposableFigureComponent {
  id: string;
  kind: FigureComponentKind;
  semanticRole: string;
  parentModuleId: string | null;
  bounds: FigureBounds;
  inputPorts: FigureComponentPort[];
  outputPorts: FigureComponentPort[];
  repeat: FigureComponent["repeat"];
  evidenceIds: string[];
}

export interface ComposableFigureConnection {
  id: string;
  source: PortRef;
  target: PortRef;
  transport: FigureComponentConnection["transport"];
  route: FigurePoint[];
  evidenceIds: string[];
}

export interface ComposableDagFigurePlan {
  version: 1;
  graphId: string;
  compilerVersion: typeof COMPOSABLE_DAG_COMPILER_VERSION;
  layoutVersion: typeof COMPOSABLE_DAG_LAYOUT_VERSION;
  layoutSeed: string;
  intent: FigureIntent;
  pageBounds: FigureBounds;
  components: ComposableFigureComponent[];
  connections: ComposableFigureConnection[];
  sourceMappings: Array<{ semanticId: string; evidenceIds: string[] }>;
}

export type ComposableDagUnresolvedCode =
  | "component-contract"
  | "cycle"
  | "unreachable-component"
  | "invalid-connection";

export interface ComposableDagUnresolved {
  code: ComposableDagUnresolvedCode;
  message: string;
  componentId?: string;
  connectionId?: string;
}

export type ComposableDagCompileResult =
  | { status: "ready"; plan: ComposableDagFigurePlan }
  | { status: "unresolved"; graphId: string; unresolved: ComposableDagUnresolved[] };

export interface CompileComposableDagInput {
  architectureIr: ArchitectureIRv3;
  intent: FigureIntent;
  layoutSeed: string;
}

const COMPONENT_WIDTH: Record<FigureComponentKind, number> = {
  terminal: 112,
  operator: 148,
  merge: 136,
  attention: 168,
  repeat: 156,
};
const COMPONENT_HEIGHT = 72;
const PAGE_PADDING = 48;
const COLUMN_GAP = 64;
const ROW_GAP = 40;

export function compileComposableDagFigure(input: CompileComposableDagInput): ComposableDagCompileResult {
  if (!input.layoutSeed.trim() || input.layoutSeed.length > 128) throw new Error("layoutSeed must be a non-empty value of at most 128 characters");
  const contract: FigureComponentContractResult = createFigureComponentGraph(input.architectureIr);
  if (contract.status === "unresolved") {
    return {
      status: "unresolved",
      graphId: contract.graphId,
      unresolved: contract.unresolved.map((item) => ({ code: "component-contract", message: item.message, componentId: item.nodeId, connectionId: item.edgeId })),
    };
  }

  const topology = orderGraph(contract.graph);
  if (topology.status === "unresolved") return topology;
  const positions = placeComponents(topology.order, topology.rankByComponentId, input.intent);
  const horizontal = input.intent.orientation !== "portrait";
  const components = topology.order.map((component) => toPlanComponent(component, positions.get(component.id)!));
  const connections: ComposableFigureConnection[] = [];
  const unresolved: ComposableDagUnresolved[] = [];
  for (const connection of contract.graph.connections) {
    const source = positions.get(connection.source.nodeId);
    const target = positions.get(connection.target.nodeId);
    if (!source || !target) {
      unresolved.push({ code: "invalid-connection", message: `Connection ${connection.id} references a component outside the layout`, connectionId: connection.id });
      continue;
    }
    connections.push({
      id: connection.id,
      source: { ...connection.source },
      target: { ...connection.target },
      transport: connection.transport,
      route: routeBetween(source, target, horizontal),
      evidenceIds: [...connection.evidenceIds],
    });
  }
  if (unresolved.length > 0) return { status: "unresolved", graphId: contract.graph.graphId, unresolved };

  const pageBounds = pageBoundsFor(positions);
  return {
    status: "ready",
    plan: {
      version: 1,
      graphId: contract.graph.graphId,
      compilerVersion: COMPOSABLE_DAG_COMPILER_VERSION,
      layoutVersion: COMPOSABLE_DAG_LAYOUT_VERSION,
      layoutSeed: input.layoutSeed,
      intent: structuredClone(input.intent),
      pageBounds,
      components,
      connections,
      sourceMappings: components.map((component) => ({ semanticId: component.id, evidenceIds: [...component.evidenceIds] })),
    },
  };
}

function orderGraph(graph: FigureComponentGraph):
  | { status: "ready"; order: FigureComponent[]; rankByComponentId: Map<string, number> }
  | { status: "unresolved"; graphId: string; unresolved: ComposableDagUnresolved[] } {
  const byId = new Map(graph.components.map((component) => [component.id, component]));
  const incoming = new Map<string, number>(graph.components.map((component) => [component.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const connection of graph.connections) {
    if (!byId.has(connection.source.nodeId) || !byId.has(connection.target.nodeId)) {
      return { status: "unresolved", graphId: graph.graphId, unresolved: [{ code: "invalid-connection", message: `Connection ${connection.id} references an unknown component`, connectionId: connection.id }] };
    }
    incoming.set(connection.target.nodeId, incoming.get(connection.target.nodeId)! + 1);
    const targets = outgoing.get(connection.source.nodeId) ?? [];
    targets.push(connection.target.nodeId);
    outgoing.set(connection.source.nodeId, targets);
  }
  const ready = [...incoming.entries()].filter(([, count]) => count === 0).map(([id]) => id).sort();
  const order: FigureComponent[] = [];
  const rankByComponentId = new Map<string, number>();
  while (ready.length > 0) {
    const id = ready.shift()!;
    const component = byId.get(id)!;
    order.push(component);
    const rank = rankByComponentId.get(id) ?? 0;
    for (const target of [...(outgoing.get(id) ?? [])].sort()) {
      rankByComponentId.set(target, Math.max(rankByComponentId.get(target) ?? 0, rank + 1));
      const next = incoming.get(target)! - 1;
      incoming.set(target, next);
      if (next === 0) {
        ready.push(target);
        ready.sort();
      }
    }
  }
  if (order.length !== graph.components.length) {
    const cycleComponentId = [...incoming.entries()].find(([, count]) => count > 0)?.[0];
    return { status: "unresolved", graphId: graph.graphId, unresolved: [{ code: "cycle", message: "Figure Component graph must be acyclic", componentId: cycleComponentId }] };
  }

  const reachable = new Set<string>(graph.inputs.map((input) => input.nodeId));
  const pending = [...reachable];
  while (pending.length > 0) {
    const id = pending.shift()!;
    for (const target of outgoing.get(id) ?? []) if (!reachable.has(target)) { reachable.add(target); pending.push(target); }
  }
  const unreachable = graph.components.find((component) => !reachable.has(component.id));
  if (unreachable) return { status: "unresolved", graphId: graph.graphId, unresolved: [{ code: "unreachable-component", message: `Component ${unreachable.id} is not reachable from an input`, componentId: unreachable.id }] };
  return { status: "ready", order, rankByComponentId };
}

function placeComponents(order: FigureComponent[], ranks: Map<string, number>, intent: FigureIntent): Map<string, FigureBounds> {
  const densityScale = intent.density === "compact" ? 0.8 : intent.density === "detailed" ? 1.25 : 1;
  const horizontal = intent.orientation !== "portrait";
  const byRank = new Map<number, FigureComponent[]>();
  for (const component of order) {
    const rank = ranks.get(component.id) ?? 0;
    const items = byRank.get(rank) ?? [];
    items.push(component);
    byRank.set(rank, items);
  }
  const result = new Map<string, FigureBounds>();
  const sortedRanks = [...byRank.keys()].sort((a, b) => a - b);
  for (const rank of sortedRanks) {
    const items = [...byRank.get(rank)!].sort((a, b) => a.id.localeCompare(b.id));
    items.forEach((component, index) => {
      const width = Math.round(COMPONENT_WIDTH[component.kind] * densityScale);
      const height = Math.round(COMPONENT_HEIGHT * densityScale);
      const primary = Math.round(PAGE_PADDING + rank * (160 * densityScale + COLUMN_GAP));
      const secondary = Math.round(PAGE_PADDING + index * (height + ROW_GAP));
      result.set(component.id, horizontal
        ? { x: primary, y: secondary, width, height }
        : { x: secondary, y: primary, width, height });
    });
  }
  return result;
}

function toPlanComponent(component: FigureComponent, bounds: FigureBounds): ComposableFigureComponent {
  return {
    id: component.id,
    kind: component.kind,
    semanticRole: component.semanticRole,
    parentModuleId: component.parentModuleId,
    bounds,
    inputPorts: structuredClone(component.inputPorts),
    outputPorts: structuredClone(component.outputPorts),
    repeat: component.repeat ? structuredClone(component.repeat) : undefined,
    evidenceIds: [...component.evidenceIds],
  };
}

function routeBetween(source: FigureBounds, target: FigureBounds, horizontal: boolean): FigurePoint[] {
  if (!horizontal) return verticalRouteBetween(source, target);
  const sourcePoint = { x: source.x + source.width, y: source.y + source.height / 2 };
  const targetPoint = { x: target.x, y: target.y + target.height / 2 };
  if (sourcePoint.x <= targetPoint.x) return [sourcePoint, targetPoint];
  const midX = Math.round((sourcePoint.x + targetPoint.x) / 2);
  return [sourcePoint, { x: midX, y: sourcePoint.y }, { x: midX, y: targetPoint.y }, targetPoint];
}

function verticalRouteBetween(source: FigureBounds, target: FigureBounds): FigurePoint[] {
  const sourcePoint = { x: source.x + source.width / 2, y: source.y + source.height };
  const targetPoint = { x: target.x + target.width / 2, y: target.y };
  if (sourcePoint.y <= targetPoint.y) return [sourcePoint, targetPoint];
  const midY = Math.round((sourcePoint.y + targetPoint.y) / 2);
  return [sourcePoint, { x: sourcePoint.x, y: midY }, { x: targetPoint.x, y: midY }, targetPoint];
}

function pageBoundsFor(positions: Map<string, FigureBounds>): FigureBounds {
  let maxX = PAGE_PADDING;
  let maxY = PAGE_PADDING;
  for (const bounds of positions.values()) {
    maxX = Math.max(maxX, bounds.x + bounds.width + PAGE_PADDING);
    maxY = Math.max(maxY, bounds.y + bounds.height + PAGE_PADDING);
  }
  return { x: 0, y: 0, width: maxX, height: maxY };
}
