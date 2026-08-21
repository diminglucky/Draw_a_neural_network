import { assertPublicationVisualPlanRendererCapabilities } from "./publication-visual-plan-compiler.js";
import { parsePublicationVisualPlan, type PublicationVisualPlan } from "./publication-visual-plan.js";
import { evaluatePublicationVisualPlanQa } from "./publication-visual-plan-qa.js";

const ID = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const SHAPE_KINDS = new Map<string, NativeShapeKind>([
  ["Input", "terminal"],
  ["Output", "terminal"],
  ["GenericModule", "module"],
  ["CustomOperator", "module"],
  ["CustomModule", "module"],
  ["Split", "split"],
  ["MergeAdd", "merge-add"],
  ["MergeConcat", "merge-concat"],
  ["CustomFusion", "merge-concat"],
  ["RepeatBadge", "repeat-badge"],
]);
const CONNECTOR_KINDS = new Set<NativeConnectorKind>(["flow", "skip", "merge", "condition"]);

export type NativeShapeKind = "terminal" | "module" | "split" | "merge-add" | "merge-concat" | "repeat-badge";
export type NativeConnectorKind = "flow" | "skip" | "merge" | "condition";

export interface NativeIntentBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface NativeIntentPoint {
  readonly x: number;
  readonly y: number;
}

export interface PublicationVisualNativeIntent {
  readonly protocolVersion: "pvp-native-intent-1";
  readonly planId: string;
  readonly planHash: string;
  readonly updateIdentity: {
    readonly ownerId: string;
    readonly deviceId: string;
    readonly workflowId: string;
    readonly documentId: string;
    readonly pageId: string;
    readonly expectedRevision: number;
  };
  readonly coordinateSpace: {
    readonly id: "pvp-du-1";
    readonly unit: "du";
    readonly duPerInch: 1000;
    readonly page: NativeIntentBounds;
  };
  readonly primitives: readonly NativePrimitiveIntent[];
  readonly connectors: readonly NativeConnectorIntent[];
}

export interface NativePrimitiveIntent {
  readonly primitiveId: string;
  readonly componentId: string;
  readonly nativeKind: NativeShapeKind;
  readonly label: string;
  readonly bounds: NativeIntentBounds;
  readonly styleTokenIds: readonly string[];
  readonly shapeData: Readonly<Record<"pvp.planId" | "pvp.planHash" | "pvp.primitiveId" | "pvp.componentId" | "pvp.ownership", string>>;
}

export interface NativeConnectorIntent {
  readonly connectorId: string;
  readonly nativeKind: NativeConnectorKind;
  readonly sourcePrimitiveId: string;
  readonly sourcePortId: string;
  readonly targetPrimitiveId: string;
  readonly targetPortId: string;
  readonly route: readonly NativeIntentPoint[];
  readonly styleTokenIds: readonly string[];
  readonly shapeData: Readonly<Record<"pvp.planId" | "pvp.planHash" | "pvp.connectorId" | "pvp.ownership", string>>;
}

/**
 * Produces a closed, renderer-neutral native-intent projection for a formal PVP.
 * M3.1 intentionally does not seal it, choose a Visio document/page, call COM, or create an export job.
 */
export function compilePublicationVisualPlanToNativeIntent(input: PublicationVisualPlan): PublicationVisualNativeIntent {
  const plan = parsePublicationVisualPlan(input);
  if (plan.eligibility.kind !== "formal") throw new Error("Only formal PVP can become native intent");
  if (evaluatePublicationVisualPlanQa(plan).status !== "passed") throw new Error("PVP structural QA must pass before native intent mapping");
  assertPublicationVisualPlanRendererCapabilities(plan, ["native-text", "orthogonal-route", "shape-data"]);

  const updateIdentity = parseUpdateIdentity(plan.updateIdentity);
  const coordinateSpace = parseCoordinateSpace(plan.coordinateSpace);
  const primitives = (plan.primitives as readonly unknown[]).map((value) => parsePrimitive(value, plan));
  const primitiveIds = new Set(primitives.map((primitive) => primitive.primitiveId));
  const ports = new Map((plan.ports as readonly unknown[]).map((value) => {
    const port = parsePort(value, primitiveIds);
    return [port.portId, port] as const;
  }));
  const connectors = (plan.connectors as readonly unknown[]).map((value) => parseConnector(value, ports, plan));

  return deepFreeze({
    protocolVersion: "pvp-native-intent-1" as const,
    planId: plan.identity.planId,
    planHash: plan.identity.canonicalHash,
    updateIdentity,
    coordinateSpace,
    primitives,
    connectors,
  });
}

function parsePrimitive(value: unknown, plan: PublicationVisualPlan): NativePrimitiveIntent {
  const primitive = record(value, "PVP native primitive is invalid");
  const primitiveId = identifier(primitive.primitiveId, "PVP native primitive ID is invalid");
  const componentId = identifier(primitive.componentId, "PVP native primitive component ID is invalid");
  const sourceKind = stringValue(primitive.kind, "PVP native primitive kind is invalid");
  const nativeKind = SHAPE_KINDS.get(sourceKind);
  if (!nativeKind) throw new Error(`Unsupported PVP primitive kind: ${sourceKind}`);
  return {
    primitiveId,
    componentId,
    nativeKind,
    label: label(primitive.label),
    bounds: bounds(primitive.bounds, "PVP native primitive bounds are invalid"),
    styleTokenIds: styleTokenIds(primitive.styleTokenIds),
    shapeData: {
      "pvp.planId": plan.identity.planId,
      "pvp.planHash": plan.identity.canonicalHash,
      "pvp.primitiveId": primitiveId,
      "pvp.componentId": componentId,
      "pvp.ownership": "agent",
    },
  };
}

function parsePort(value: unknown, primitiveIds: ReadonlySet<string>): { portId: string; primitiveId: string } {
  const port = record(value, "PVP native port is invalid");
  const portId = identifier(port.portId, "PVP native port ID is invalid");
  const primitiveId = identifier(port.primitiveId, "PVP native port primitive ID is invalid");
  if (!primitiveIds.has(primitiveId)) throw new Error("PVP native port references an unknown primitive");
  return { portId, primitiveId };
}

function parseConnector(value: unknown, ports: ReadonlyMap<string, { portId: string; primitiveId: string }>, plan: PublicationVisualPlan): NativeConnectorIntent {
  const connector = record(value, "PVP native connector is invalid");
  const connectorId = identifier(connector.connectorId, "PVP native connector ID is invalid");
  const nativeKind = stringValue(connector.relation, "PVP native connector kind is invalid") as NativeConnectorKind;
  if (!CONNECTOR_KINDS.has(nativeKind)) throw new Error(`Unsupported PVP connector relation: ${String(connector.relation)}`);
  const sourcePortId = identifier(connector.sourcePortId, "PVP native connector source port is invalid");
  const targetPortId = identifier(connector.targetPortId, "PVP native connector target port is invalid");
  const source = ports.get(sourcePortId);
  const target = ports.get(targetPortId);
  if (!source || !target || source.primitiveId === target.primitiveId) throw new Error("PVP native connector endpoints are invalid");
  return {
    connectorId,
    nativeKind,
    sourcePrimitiveId: source.primitiveId,
    sourcePortId,
    targetPrimitiveId: target.primitiveId,
    targetPortId,
    route: route(connector.route),
    styleTokenIds: styleTokenIds(connector.styleTokenIds),
    shapeData: {
      "pvp.planId": plan.identity.planId,
      "pvp.planHash": plan.identity.canonicalHash,
      "pvp.connectorId": connectorId,
      "pvp.ownership": "agent",
    },
  };
}

function parseUpdateIdentity(value: unknown): PublicationVisualNativeIntent["updateIdentity"] {
  const identity = record(value, "PVP native update identity is invalid");
  const keys = Object.keys(identity).sort();
  const expected = ["deviceId", "documentId", "expectedRevision", "ownerId", "pageId", "workflowId"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error("PVP native update identity is invalid");
  const expectedRevision = identity.expectedRevision;
  if (!integer(expectedRevision) || expectedRevision <= 0) throw new Error("PVP native expected revision is invalid");
  return {
    ownerId: identifier(identity.ownerId, "PVP native owner ID is invalid"),
    deviceId: identifier(identity.deviceId, "PVP native device ID is invalid"),
    workflowId: identifier(identity.workflowId, "PVP native workflow ID is invalid"),
    documentId: identifier(identity.documentId, "PVP native document ID is invalid"),
    pageId: identifier(identity.pageId, "PVP native page ID is invalid"),
    expectedRevision,
  };
}

function parseCoordinateSpace(value: unknown): PublicationVisualNativeIntent["coordinateSpace"] {
  const coordinateSpace = record(value, "PVP native coordinate space is invalid");
  if (coordinateSpace.id !== "pvp-du-1" || coordinateSpace.unit !== "du" || coordinateSpace.duPerInch !== 1000) throw new Error("PVP native coordinate space is invalid");
  return { id: "pvp-du-1", unit: "du", duPerInch: 1000, page: bounds(coordinateSpace.page, "PVP native page is invalid") };
}

function route(value: unknown): readonly NativeIntentPoint[] {
  if (!Array.isArray(value) || value.length < 2) throw new Error("PVP native connector route is invalid");
  return value.map((point) => {
    const item = record(point, "PVP native connector route point is invalid");
    if (!integer(item.x) || !integer(item.y)) throw new Error("PVP native connector route point is invalid");
    return { x: item.x, y: item.y };
  });
}

function bounds(value: unknown, message: string): NativeIntentBounds {
  const item = record(value, message);
  if (!integer(item.x) || !integer(item.y) || !integer(item.width) || !integer(item.height) || item.x < 0 || item.y < 0 || item.width < 0 || item.height < 0) throw new Error(message);
  return { x: item.x, y: item.y, width: item.width, height: item.height };
}

function styleTokenIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !ID.test(item))) throw new Error("PVP native style token IDs are invalid");
  return [...value];
}

function label(value: unknown): string {
  const result = stringValue(value, "PVP native primitive label is invalid");
  if (result.length === 0 || result.length > 512) throw new Error("PVP native primitive label is invalid");
  return result;
}

function identifier(value: unknown, message: string): string {
  const result = stringValue(value, message);
  if (!ID.test(result) || result.length > 192) throw new Error(message);
  return result;
}

function stringValue(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(message);
  return value;
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(message);
  return value as Record<string, unknown>;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}
