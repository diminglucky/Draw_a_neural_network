import { createHash } from "node:crypto";
import { compareCodeUnits } from "./stable-string-order.js";

const ID = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const DIGEST = /^[a-f0-9]{64}$/;
const TOP_LEVEL = ["identity", "eligibility", "lineage", "coordinateSpace", "regions", "primitiveGroups", "primitives", "ports", "connectors", "annotations", "legend", "styleTokens", "profileApplications", "sourceMappings", "rendererRequirements", "updateIdentity"];

export interface PublicationVisualPlan {
  readonly identity: { readonly schemaVersion: 1; readonly planId: string; readonly canonicalHash: string };
  readonly eligibility: { readonly kind: "formal" | "candidate"; readonly formalReasons: readonly string[]; readonly blockingReasons: readonly string[]; readonly qaStatus: "pending" | "passed" };
  readonly primitives: readonly unknown[];
  readonly ports: readonly unknown[];
  readonly connectors: readonly unknown[];
  readonly sourceMappings: readonly unknown[];
  readonly [key: string]: unknown;
}

export function createPublicationVisualPlan(input: unknown): PublicationVisualPlan {
  const plan = cloneRecord(input, "PVP must be a plain JSON object");
  normalize(plan);
  const identity = record(plan.identity, "PVP identity is required");
  identity.canonicalHash = "";
  identity.canonicalHash = sha256(canonicalPublicationVisualPlanJson(plan as PublicationVisualPlan));
  return parsePublicationVisualPlan(plan);
}

export function parsePublicationVisualPlan(input: unknown): PublicationVisualPlan {
  const plan = cloneRecord(input, "PVP must be a plain JSON object");
  assertExactKeys(plan, TOP_LEVEL, "PVP");
  const identity = record(plan.identity, "PVP identity is required");
  assertExactKeys(identity, ["schemaVersion", "planId", "canonicalHash"], "PVP identity");
  if (identity.schemaVersion !== 1 || !identifier(identity.planId) || typeof identity.canonicalHash !== "string" || !DIGEST.test(identity.canonicalHash)) throw new Error("PVP identity is invalid");
  const eligibility = record(plan.eligibility, "PVP eligibility is required");
  if (!(["formal", "candidate"] as unknown[]).includes(eligibility.kind) || !Array.isArray(eligibility.formalReasons) || !Array.isArray(eligibility.blockingReasons) || !(["pending", "passed"] as unknown[]).includes(eligibility.qaStatus)) throw new Error("PVP eligibility is invalid");
  if (eligibility.kind === "candidate" && (eligibility.qaStatus === "passed" || eligibility.formalReasons.length !== 0)) throw new Error("Candidate PVP cannot claim formal eligibility");
  const coordinateSpace = record(plan.coordinateSpace, "PVP coordinateSpace is required");
  if (coordinateSpace.id !== "pvp-du-1" || coordinateSpace.origin !== "top_left" || coordinateSpace.axes !== "x_right_y_down" || coordinateSpace.unit !== "du" || coordinateSpace.duPerInch !== 1000) throw new Error("PVP coordinate space is invalid");
  const page = bounds(coordinateSpace.page, "PVP page");
  const safeMargins = bounds(coordinateSpace.safeMargins, "PVP safeMargins");
  if (page.x !== 0 || page.y !== 0 || !contains(page, safeMargins)) throw new Error("PVP page and safeMargins are invalid");
  for (const field of ["regions", "primitiveGroups", "primitives", "ports", "connectors", "annotations", "profileApplications", "sourceMappings"] as const) if (!Array.isArray(plan[field])) throw new Error(`PVP ${field} must be an array`);
  const primitives = plan.primitives as unknown[];
  const ports = plan.ports as unknown[];
  const connectors = plan.connectors as unknown[];
  const profileApplications = plan.profileApplications as unknown[];
  assertSortedUnique(primitives, "primitiveId", "PVP primitive");
  assertSortedUnique(ports, "portId", "PVP port");
  assertSortedUnique(connectors, "connectorId", "PVP connector");
  assertSortedUnique(profileApplications, "applicationId", "PVP Profile application");
  for (const value of profileApplications) {
    const application = record(value, "PVP Profile application is invalid");
    assertExactKeys(application, ["applicationId", "profileId", "profileVersion", "inputHash", "outputHash", "affectedIds"], "PVP Profile application");
    const affectedIds = application.affectedIds;
    if (application.applicationId !== `profile-application:${String(application.profileId ?? "")}` || !identifier(application.profileId) || typeof application.profileVersion !== "string" || application.profileVersion.length === 0 || application.profileVersion.length > 64 || typeof application.inputHash !== "string" || !DIGEST.test(application.inputHash) || typeof application.outputHash !== "string" || !DIGEST.test(application.outputHash) || !Array.isArray(affectedIds) || affectedIds.length === 0 || affectedIds.some((id) => !identifier(id)) || new Set(affectedIds).size !== affectedIds.length || affectedIds.some((id, index) => id !== [...affectedIds].sort(compareCodeUnits)[index])) throw new Error("PVP Profile application is invalid");
  }
  const primitiveById = new Map<string, Record<string, unknown>>();
  for (const value of primitives) {
    const primitive = record(value, "PVP primitive is invalid");
    if (!identifier(primitive.primitiveId) || !identifier(primitive.componentId) || typeof primitive.kind !== "string" || typeof primitive.regionId !== "string" || !integer(primitive.zIndex)) throw new Error("PVP primitive is invalid");
    const primitiveBounds = bounds(primitive.bounds, "PVP primitive bounds");
    if (!contains(page, primitiveBounds)) throw new Error("PVP primitive bounds must be inside the page");
    primitiveById.set(primitive.primitiveId as string, primitive);
  }
  const portById = new Map<string, { primitiveId: string; x: number; y: number }>();
  for (const value of ports) {
    const port = record(value, "PVP port is invalid");
    const primitive = primitiveById.get(port.primitiveId as string);
    const anchor = record(port.anchor, "PVP port anchor is invalid");
    if (!primitive || !identifier(port.semanticPortId) || !(["input", "output"] as unknown[]).includes(port.role) || !(["left", "right", "top", "bottom"] as unknown[]).includes(anchor.side) || !integer(anchor.offset) || (anchor.offset as number) < 0 || (anchor.offset as number) > 1000 || !integer(port.order)) throw new Error("PVP port is invalid");
    const primitiveBounds = bounds(primitive.bounds, "PVP primitive bounds");
    portById.set(port.portId as string, { primitiveId: port.primitiveId as string, ...anchorPoint(primitiveBounds, anchor.side as string, anchor.offset as number) });
  }
  for (const value of connectors) {
    const connector = record(value, "PVP connector is invalid");
    const source = portById.get(connector.sourcePortId as string);
    const target = portById.get(connector.targetPortId as string);
    if (!source || !target || source.primitiveId === target.primitiveId || !Array.isArray(connector.route) || connector.route.length < 2) throw new Error("PVP connector endpoint is invalid");
    const route = connector.route.map((point) => pointValue(point, "PVP connector route"));
    if (!samePoint(route[0]!, source) || !samePoint(route.at(-1)!, target)) throw new Error("PVP connector route must start and end at its port anchors");
    if (route.some((point) => !contains(page, { x: point.x, y: point.y, width: 0, height: 0 }))) throw new Error("PVP connector route is outside the page");
  }
  const sourceMappings = plan.sourceMappings as unknown[];
  assertSortedUnique(sourceMappings, "visualId", "PVP source mapping");
  if (sourceMappings.length !== primitives.length || sourceMappings.some((value) => !primitiveById.has(record(value, "PVP source mapping is invalid").visualId as string))) throw new Error("PVP requires one source mapping for every primitive");
  const canonical = cloneRecord(plan, "PVP must be canonical");
  record(canonical.identity, "PVP identity is required").canonicalHash = "";
  if (identity.canonicalHash !== sha256(canonicalPublicationVisualPlanJson(canonical as PublicationVisualPlan))) throw new Error("PVP canonicalHash must match its canonical projection");
  return deepFreeze(plan) as PublicationVisualPlan;
}

export function canonicalPublicationVisualPlanJson(value: PublicationVisualPlan): string { return JSON.stringify(canonicalValue(value)); }

function normalize(plan: Record<string, unknown>): void {
  const identifiers: Record<string, string> = { regions: "regionId", primitiveGroups: "groupId", primitives: "primitiveId", ports: "portId", connectors: "connectorId", annotations: "annotationId", profileApplications: "applicationId", sourceMappings: "visualId" };
  for (const [field, identifierField] of Object.entries(identifiers)) if (Array.isArray(plan[field])) (plan[field] as Record<string, unknown>[]).sort((left, right) => compareCodeUnits(String(left[identifierField]), String(right[identifierField])));
  const lineage = plan.lineage;
  if (lineage && typeof lineage === "object" && !Array.isArray(lineage) && Array.isArray((lineage as Record<string, unknown>).sourceHashes)) {
    ((lineage as Record<string, unknown>).sourceHashes as string[]).sort(compareCodeUnits);
  }
}
function record(value: unknown, message: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(message); return value as Record<string, unknown>; }
function cloneRecord(value: unknown, message: string): Record<string, unknown> { try { return structuredClone(record(value, message)); } catch { throw new Error(message); } }
function identifier(value: unknown): value is string { return typeof value === "string" && ID.test(value) && value.length <= 192; }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value); }
function bounds(value: unknown, message: string): { x: number; y: number; width: number; height: number } { const item = record(value, message); if (!integer(item.x) || !integer(item.y) || !integer(item.width) || !integer(item.height) || item.x < 0 || item.y < 0 || item.width < 0 || item.height < 0) throw new Error(message); return item as { x: number; y: number; width: number; height: number }; }
function contains(outer: { x: number; y: number; width: number; height: number }, inner: { x: number; y: number; width: number; height: number }): boolean { return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height; }
function assertExactKeys(value: Record<string, unknown>, keys: string[], label: string): void { const actual = Object.keys(value).sort(compareCodeUnits); const expected = [...keys].sort(compareCodeUnits); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} has unknown or missing fields`); }
function assertSortedUnique(values: unknown[], key: string, label: string): void { const ids = values.map((value) => record(value, `${label} is invalid`)[key]); if (ids.some((id) => !identifier(id))) throw new Error(`${label} ID is invalid`); const sorted = [...ids].sort((a, b) => compareCodeUnits(a as string, b as string)); if (new Set(ids).size !== ids.length || ids.some((id, index) => id !== sorted[index])) throw new Error(`${label} IDs must be unique and sorted`); }
function anchorPoint(value: { x: number; y: number; width: number; height: number }, side: string, offset: number): { x: number; y: number } { if (side === "left") return { x: value.x, y: value.y + value.height * offset / 1000 }; if (side === "right") return { x: value.x + value.width, y: value.y + value.height * offset / 1000 }; if (side === "top") return { x: value.x + value.width * offset / 1000, y: value.y }; return { x: value.x + value.width * offset / 1000, y: value.y + value.height }; }
function pointValue(value: unknown, message: string): { x: number; y: number } { const point = record(value, message); if (!integer(point.x) || !integer(point.y)) throw new Error(message); return point as { x: number; y: number }; }
function samePoint(left: { x: number; y: number }, right: { x: number; y: number }): boolean { return left.x === right.x && left.y === right.y; }
function canonicalValue(value: unknown): unknown { if (value === null || typeof value === "string" || typeof value === "boolean") return value; if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("PVP canonical JSON does not permit non-finite numbers"); return value; } if (Array.isArray(value)) return value.map(canonicalValue); const item = record(value, "PVP canonical JSON accepts only plain JSON values"); return Object.fromEntries(Object.keys(item).sort(compareCodeUnits).map((key) => [key, canonicalValue(item[key])])); }
function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function deepFreeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item); } return value; }
