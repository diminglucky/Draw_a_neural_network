import { assertPublicationVisualPlanRendererCapabilities } from "./publication-visual-plan-compiler.js";
import { cloneGenericPlanSnapshot, type GenericPlanSnapshot, type GenericPlanSnapshotOwner } from "./generic-plan-snapshot.js";
import type { GenericPlanSnapshotStore } from "./generic-plan-snapshot-store.js";
import { assertTrustedPublicationVisualPlan } from "./generic-plan-snapshot-service.js";
import { parsePublicationVisualPlan, type PublicationVisualPlan } from "./publication-visual-plan.js";
import { evaluatePublicationVisualPlanQa } from "./publication-visual-plan-qa.js";
import { compareCodeUnits } from "./stable-string-order.js";

const STRUCTURAL_ID = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const AUTHENTICATED_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SHAPE_KINDS = new Map<string, NativeShapeKind>([
  ["InputTerminal", "terminal"],
  ["OutputTerminal", "terminal"],
  ["TensorStage", "module"],
  ["TensorVolume", "module"],
  ["OperatorFrame", "module"],
  ["ModuleFrame", "module"],
  ["SplitMarker", "split"],
  ["AddMarker", "merge-add"],
  ["ConcatMarker", "merge-concat"],
  ["AttentionTokenStrip", "module"],
  ["AttentionRelation", "module"],
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

export interface ResolvedNativeStyle {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidthPt: number;
}

export interface ResolvedNativeLineStyle {
  readonly stroke: string;
  readonly strokeWidthPt: number;
}

export type NativeVisualGeometry =
  | { readonly kind: "none" }
  | { readonly kind: "tensor_volume"; readonly frontFace: readonly NativeIntentPoint[]; readonly depthFace: readonly NativeIntentPoint[] }
  | { readonly kind: "ordered_cells"; readonly orderedCells: readonly { readonly cellId: string; readonly order: number; readonly bounds: NativeIntentBounds }[] };

export interface NativeVisualIntent {
  readonly regionRole: string;
  readonly nativeSupport: "supported";
  readonly geometry: NativeVisualGeometry;
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
  readonly visualKind: string;
  readonly zIndex: number;
  readonly label: string;
  readonly bounds: NativeIntentBounds;
  readonly styleTokenIds: readonly string[];
  readonly style: ResolvedNativeStyle;
  readonly visual: NativeVisualIntent;
  readonly shapeData: Readonly<Record<"pvp.planId" | "pvp.planHash" | "pvp.primitiveId" | "pvp.componentId" | "pvp.ownership", string>>;
}

export interface NativeConnectorIntent {
  readonly connectorId: string;
  readonly nativeKind: NativeConnectorKind;
  readonly zIndex: number;
  readonly sourcePrimitiveId: string;
  readonly sourcePortId: string;
  readonly targetPrimitiveId: string;
  readonly targetPortId: string;
  readonly route: readonly NativeIntentPoint[];
  readonly styleTokenIds: readonly string[];
  readonly style: ResolvedNativeLineStyle;
  readonly shapeData: Readonly<Record<"pvp.planId" | "pvp.planHash" | "pvp.connectorId" | "pvp.ownership", string>>;
}

export class PublicationVisualNativeIntentService {
  constructor(private readonly options: { snapshotStore: GenericPlanSnapshotStore }) {}

  async compile(input: {
    owner: GenericPlanSnapshotOwner;
    graphId: string;
    ugsRevision: number;
    snapshotId: string;
  }): Promise<PublicationVisualNativeIntent> {
    const stored = await this.options.snapshotStore.get(input.owner, input.graphId, input.ugsRevision, input.snapshotId);
    if (!stored) throw new Error("Trusted GenericPlanSnapshot was not found");
    if (
      stored.tenantId !== input.owner.tenantId
      || stored.userId !== input.owner.userId
      || stored.deviceId !== input.owner.deviceId
      || stored.graphId !== input.graphId
      || stored.ugsRevision !== input.ugsRevision
      || stored.snapshotId !== input.snapshotId
    ) throw new Error("Resolved GenericPlanSnapshot identity does not match its locator");

    const snapshot = cloneGenericPlanSnapshot(stored);
    const plan = parsePublicationVisualPlan(snapshot.publicationVisualPlan);
    assertTrustedPublicationVisualPlan(plan);
    if (
      snapshot.publicationVisualPlanId !== plan.identity.planId
      || snapshot.publicationVisualPlanHash !== plan.identity.canonicalHash
    ) throw new Error("Trusted GenericPlanSnapshot PVP identity is invalid");
    assertTrustedSnapshotPvpBinding(snapshot, plan);
    return compileTrustedPublicationVisualPlanToNativeIntent(plan);
  }
}

/**
 * Maps only the PVP recovered from a store-resolved trusted GenericPlanSnapshot.
 * This helper deliberately remains module-private: M3.1 accepts no raw PVP input.
 */
function compileTrustedPublicationVisualPlanToNativeIntent(input: PublicationVisualPlan): PublicationVisualNativeIntent {
  const plan = parsePublicationVisualPlan(input);
  assertTrustedPublicationVisualPlan(plan);
  if (evaluatePublicationVisualPlanQa(plan).status !== "passed") throw new Error("PVP structural QA must pass before native intent mapping");
  assertRequiredNativeCapabilities(plan);
  assertPublicationVisualPlanRendererCapabilities(plan, ["native-text", "orthogonal-route", "shape-data"]);

  const updateIdentity = parseUpdateIdentity(plan.updateIdentity);
  const coordinateSpace = parseCoordinateSpace(plan.coordinateSpace);
  const styles = parseStyleTokens(plan.styleTokens);
  const primitives = (plan.primitives as readonly unknown[]).map((value) => parsePrimitive(value, plan, styles));
  const primitiveIds = new Set(primitives.map((primitive) => primitive.primitiveId));
  const ports = new Map((plan.ports as readonly unknown[]).map((value) => {
    const port = parsePort(value, primitiveIds);
    return [port.portId, port] as const;
  }));
  const connectors = (plan.connectors as readonly unknown[]).map((value) => parseConnector(value, ports, plan, styles));

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

function assertRequiredNativeCapabilities(plan: PublicationVisualPlan): void {
  const requirements = record(plan.rendererRequirements, "PVP renderer requirements are invalid");
  if (requirements.protocolVersion !== "pvp-renderer-1" || !Array.isArray(requirements.requiredCapabilities)) throw new Error("PVP renderer requirements are invalid");
  const declared = new Set(requirements.requiredCapabilities);
  for (const required of ["native-text", "orthogonal-route", "shape-data"]) {
    if (!declared.has(required)) throw new Error("PVP native renderer capability is required");
  }
}

function assertTrustedSnapshotPvpBinding(snapshot: GenericPlanSnapshot, plan: PublicationVisualPlan): void {
  const updateIdentity = record(plan.updateIdentity, "PVP update identity is invalid");
  if (
    updateIdentity.ownerId !== snapshot.userId
    || updateIdentity.deviceId !== snapshot.deviceId
    || updateIdentity.expectedRevision !== snapshot.ugsRevision
  ) throw new Error("PVP update identity does not match its GenericPlanSnapshot");

  const lineage = record(plan.lineage, "PVP lineage is invalid");
  if (
    lineage.ugsHash !== snapshot.ugsCanonicalHash
    || lineage.gpgHash !== snapshot.generalPublicationGraphHash
  ) throw new Error("PVP lineage does not match its GenericPlanSnapshot");
  const sourceHashes = sourceHashArray(lineage.sourceHashes, "PVP lineage source hashes").sort(compareCodeUnits);
  const expected = [...snapshot.sourceHashes].sort(compareCodeUnits);
  if (sourceHashes.length !== expected.length || sourceHashes.some((value, index) => value !== expected[index])) {
    throw new Error("PVP lineage source hashes do not match its GenericPlanSnapshot");
  }
}

function parsePrimitive(value: unknown, plan: PublicationVisualPlan, styles: ReadonlyMap<string, Readonly<Record<string, string | number>>>): NativePrimitiveIntent {
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
    visualKind: sourceKind,
    zIndex: nonNegativeInteger(primitive.zIndex, "PVP native primitive z-index is invalid"),
    label: label(primitive.label),
    bounds: bounds(primitive.bounds, "PVP native primitive bounds are invalid"),
    styleTokenIds: styleTokenIds(primitive.styleTokenIds),
    style: resolveStyle(primitive.styleTokenIds, styles, { fill: "#ffffff", stroke: "#1e293b", strokeWidthPt: 1.2 }),
    visual: parseVisual(primitive.visual),
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

function parseConnector(value: unknown, ports: ReadonlyMap<string, { portId: string; primitiveId: string }>, plan: PublicationVisualPlan, styles: ReadonlyMap<string, Readonly<Record<string, string | number>>>): NativeConnectorIntent {
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
    zIndex: nonNegativeInteger(connector.zIndex, "PVP native connector z-index is invalid"),
    sourcePrimitiveId: source.primitiveId,
    sourcePortId,
    targetPrimitiveId: target.primitiveId,
    targetPortId,
    route: route(connector.route),
    styleTokenIds: styleTokenIds(connector.styleTokenIds),
    style: resolveLineStyle(connector.styleTokenIds, styles, { stroke: "#475569", strokeWidthPt: 1.2 }),
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
    ownerId: authenticatedIdentifier(identity.ownerId, "PVP native owner ID is invalid"),
    deviceId: authenticatedIdentifier(identity.deviceId, "PVP native device ID is invalid"),
    workflowId: authenticatedIdentifier(identity.workflowId, "PVP native workflow ID is invalid"),
    documentId: authenticatedIdentifier(identity.documentId, "PVP native document ID is invalid"),
    pageId: authenticatedIdentifier(identity.pageId, "PVP native page ID is invalid"),
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
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !STRUCTURAL_ID.test(item))) throw new Error("PVP native style token IDs are invalid");
  return [...value];
}

function label(value: unknown): string {
  const result = stringValue(value, "PVP native primitive label is invalid");
  if (result.length === 0 || result.length > 512) throw new Error("PVP native primitive label is invalid");
  return result;
}

function identifier(value: unknown, message: string): string {
  const result = stringValue(value, message);
  if (!STRUCTURAL_ID.test(result) || result.length > 192) throw new Error(message);
  return result;
}

function parseStyleTokens(value: unknown): ReadonlyMap<string, Readonly<Record<string, string | number>>> {
  const styleSet = record(value, "PVP native style token set is invalid");
  if (styleSet.tokenSetVersion !== "pvp-style-1" || !Array.isArray(styleSet.tokens)) throw new Error("PVP native style token set is invalid");
  const result = new Map<string, Readonly<Record<string, string | number>>>();
  for (const value of styleSet.tokens) {
    const token = record(value, "PVP native style token is invalid");
    const tokenId = identifier(token.tokenId, "PVP native style token ID is invalid");
    if (result.has(tokenId)) throw new Error("PVP native style token IDs are duplicated");
    const rawValues = record(token.values, "PVP native style values are invalid");
    const values: Record<string, string | number> = {};
    for (const [key, raw] of Object.entries(rawValues)) {
      if (!["fill", "stroke", "strokeWidth"].includes(key) || (typeof raw !== "string" && typeof raw !== "number")) continue;
      values[key] = raw;
    }
    result.set(tokenId, values);
  }
  return result;
}

function resolveStyle(value: unknown, styles: ReadonlyMap<string, Readonly<Record<string, string | number>>>, fallback: ResolvedNativeStyle): ResolvedNativeStyle {
  const references = styleTokenIds(value);
  const ordered = [...references].sort((left, right) => Number(left.startsWith("profile:")) - Number(right.startsWith("profile:")) || compareCodeUnits(left, right));
  let fill = fallback.fill;
  let stroke = fallback.stroke;
  let strokeWidthPt = fallback.strokeWidthPt;
  for (const tokenId of ordered) {
    const values = styles.get(tokenId);
    if (!values) throw new Error(`PVP native style token is missing: ${tokenId}`);
    if (values.fill !== undefined) fill = color(values.fill, "PVP native fill is invalid");
    if (values.stroke !== undefined) stroke = color(values.stroke, "PVP native stroke is invalid");
    if (values.strokeWidth !== undefined) strokeWidthPt = positiveNumber(values.strokeWidth, "PVP native stroke width is invalid");
  }
  return { fill, stroke, strokeWidthPt };
}

function resolveLineStyle(value: unknown, styles: ReadonlyMap<string, Readonly<Record<string, string | number>>>, fallback: ResolvedNativeLineStyle): ResolvedNativeLineStyle {
  const resolved = resolveStyle(value, styles, { fill: "#ffffff", ...fallback });
  return { stroke: resolved.stroke, strokeWidthPt: resolved.strokeWidthPt };
}

function parseVisual(value: unknown): NativeVisualIntent {
  const visual = record(value, "PVP native visual is invalid");
  if (visual.nativeSupport !== "supported") throw new Error("PVP primitive is not supported by the native renderer");
  const regionRole = stringValue(visual.regionRole, "PVP native visual region role is invalid");
  const geometry = record(visual.geometry, "PVP native visual geometry is invalid");
  if (geometry.kind === "none") return { regionRole, nativeSupport: "supported", geometry: { kind: "none" } };
  if (geometry.kind === "tensor_volume") {
    return {
      regionRole,
      nativeSupport: "supported",
      geometry: {
        kind: "tensor_volume",
        frontFace: geometryPoints(geometry.frontFace, "PVP native tensor front face is invalid"),
        depthFace: geometryPoints(geometry.depthFace, "PVP native tensor depth face is invalid"),
      },
    };
  }
  if (geometry.kind === "ordered_cells") {
    if (!Array.isArray(geometry.orderedCells) || geometry.orderedCells.length < 2) throw new Error("PVP native token cells are invalid");
    const orderedCells = geometry.orderedCells.map((value, expectedOrder) => {
      const cell = record(value, "PVP native token cell is invalid");
      const order = nonNegativeInteger(cell.order, "PVP native token cell order is invalid");
      if (order !== expectedOrder) throw new Error("PVP native token cells are unordered");
      return { cellId: identifier(cell.cellId, "PVP native token cell ID is invalid"), order, bounds: bounds(cell.bounds, "PVP native token cell bounds are invalid") };
    });
    return { regionRole, nativeSupport: "supported", geometry: { kind: "ordered_cells", orderedCells } };
  }
  throw new Error("PVP native visual geometry is unsupported");
}

function geometryPoints(value: unknown, message: string): readonly NativeIntentPoint[] {
  if (!Array.isArray(value) || value.length !== 4) throw new Error(message);
  return value.map((item) => {
    const point = record(item, message);
    return { x: nonNegativeInteger(point.x, message), y: nonNegativeInteger(point.y, message) };
  });
}

function color(value: unknown, message: string): string {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(message);
  return value.toLowerCase();
}

function positiveNumber(value: unknown, message: string): number {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0 || parsed > 20) throw new Error(message);
  return parsed;
}

function nonNegativeInteger(value: unknown, message: string): number {
  if (!integer(value) || value < 0) throw new Error(message);
  return value;
}

function authenticatedIdentifier(value: unknown, message: string): string {
  const result = stringValue(value, message);
  if (!AUTHENTICATED_ID.test(result) || result.length > 192) throw new Error(message);
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

function sourceHashArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !/^[a-f0-9]{64}$/.test(item))) throw new Error(`${label} are invalid`);
  return [...value];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}
