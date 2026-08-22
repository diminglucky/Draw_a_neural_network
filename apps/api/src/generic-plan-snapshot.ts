import { createHash } from "node:crypto";
import { parsePublicationVisualPlan, type PublicationVisualPlan } from "./publication-visual-plan.js";
import { compareCodeUnits } from "./stable-string-order.js";

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const DIGEST = /^[a-f0-9]{64}$/i;
const INPUT_FIELDS = ["tenantId", "userId", "deviceId", "graphId", "ugsRevision", "ugsCanonicalHash", "generalPublicationGraphHash", "publicationVisualPlan", "createdAt"];
const SNAPSHOT_FIELDS = ["version", "snapshotId", "tenantId", "userId", "deviceId", "graphId", "ugsRevision", "ugsCanonicalHash", "generalPublicationGraphHash", "publicationVisualPlanId", "publicationVisualPlanHash", "sourceHashes", "publicationVisualPlan", "createdAt", "immutable"];

export interface GenericPlanSnapshotOwner {
  tenantId: string;
  userId: string;
  deviceId: string;
}

export interface CreateGenericPlanSnapshotInput extends GenericPlanSnapshotOwner {
  graphId: string;
  ugsRevision: number;
  ugsCanonicalHash: string;
  generalPublicationGraphHash: string;
  publicationVisualPlan: PublicationVisualPlan;
  createdAt: string;
}

export interface GenericPlanSnapshot extends Readonly<GenericPlanSnapshotOwner> {
  readonly version: 2;
  readonly snapshotId: string;
  readonly graphId: string;
  readonly ugsRevision: number;
  readonly ugsCanonicalHash: string;
  readonly generalPublicationGraphHash: string;
  readonly publicationVisualPlanId: string;
  readonly publicationVisualPlanHash: string;
  readonly sourceHashes: readonly string[];
  readonly publicationVisualPlan: PublicationVisualPlan;
  readonly createdAt: string;
  readonly immutable: true;
}

export function createGenericPlanSnapshot(input: CreateGenericPlanSnapshotInput): GenericPlanSnapshot {
  const safe = parseCreateInput(input);
  const identity = {
    tenantId: safe.tenantId,
    userId: safe.userId,
    deviceId: safe.deviceId,
    graphId: safe.graphId,
    ugsRevision: safe.ugsRevision,
    ugsCanonicalHash: safe.ugsCanonicalHash,
    generalPublicationGraphHash: safe.generalPublicationGraphHash,
    publicationVisualPlanId: safe.publicationVisualPlan.identity.planId,
    publicationVisualPlanHash: safe.publicationVisualPlan.identity.canonicalHash,
    sourceHashes: [...safe.sourceHashes],
  };
  return deepFreeze({
    version: 2 as const,
    snapshotId: `generic-plan-${sha256(canonicalGenericPlanSnapshotJson(identity)).slice(0, 32)}`,
    ...identity,
    publicationVisualPlan: safe.publicationVisualPlan,
    createdAt: safe.createdAt,
    immutable: true as const,
  });
}

export function cloneGenericPlanSnapshot(snapshot: GenericPlanSnapshot): GenericPlanSnapshot {
  const cloned = structuredClone(snapshot) as unknown;
  const record = plainRecord(cloned, "GenericPlanSnapshot must be a plain object");
  assertExactKeys(record, SNAPSHOT_FIELDS, "GenericPlanSnapshot");
  if (record.version !== 2 || record.immutable !== true || typeof record.snapshotId !== "string") throw new Error("GenericPlanSnapshot is invalid");
  const reconstructed = createGenericPlanSnapshot({
    tenantId: record.tenantId as string,
    userId: record.userId as string,
    deviceId: record.deviceId as string,
    graphId: record.graphId as string,
    ugsRevision: record.ugsRevision as number,
    ugsCanonicalHash: record.ugsCanonicalHash as string,
    generalPublicationGraphHash: record.generalPublicationGraphHash as string,
    publicationVisualPlan: record.publicationVisualPlan as PublicationVisualPlan,
    createdAt: record.createdAt as string,
  });
  if (canonicalGenericPlanSnapshotJson(record) !== canonicalGenericPlanSnapshotJson(reconstructed)) throw new Error("GenericPlanSnapshot must be canonical");
  return deepFreeze(structuredClone(reconstructed));
}

export function digestGenericPlanSnapshotValue(value: unknown): string {
  return sha256(canonicalGenericPlanSnapshotJson(value));
}

export function canonicalGenericPlanSnapshotJson(value: unknown): string {
  return serializeCanonicalValue(value);
}

function parseCreateInput(input: CreateGenericPlanSnapshotInput): CreateGenericPlanSnapshotInput & { sourceHashes: readonly string[] } {
  const copied = structuredClone(input) as unknown;
  const value = plainRecord(copied, "GenericPlanSnapshot input must be a plain object");
  assertExactKeys(value, INPUT_FIELDS, "GenericPlanSnapshot input");
  assertIdentifier(value.tenantId, "tenantId");
  assertIdentifier(value.userId, "userId");
  assertIdentifier(value.deviceId, "deviceId");
  assertIdentifier(value.graphId, "graphId");
  if (!Number.isSafeInteger(value.ugsRevision) || (value.ugsRevision as number) <= 0) throw new Error("ugsRevision must be a positive safe integer");
  assertDigest(value.ugsCanonicalHash, "ugsCanonicalHash");
  assertDigest(value.generalPublicationGraphHash, "generalPublicationGraphHash");
  assertCreatedAt(value.createdAt);
  const publicationVisualPlan = parsePublicationVisualPlan(value.publicationVisualPlan);
  if (publicationVisualPlan.eligibility.kind !== "formal" || publicationVisualPlan.eligibility.qaStatus !== "passed" || publicationVisualPlan.eligibility.blockingReasons.length !== 0) throw new Error("GenericPlanSnapshot requires a formal QA-passed PVP");
  if ((publicationVisualPlan.connectors as Array<Record<string, unknown>>).some((connector) => connector.relation === "feedback")) throw new Error("GenericPlanSnapshot rejects feedback PVPs");
  const lineage = parseLineage(publicationVisualPlan);
  return {
    tenantId: value.tenantId as string,
    userId: value.userId as string,
    deviceId: value.deviceId as string,
    graphId: value.graphId as string,
    ugsRevision: value.ugsRevision as number,
    ugsCanonicalHash: (value.ugsCanonicalHash as string).toLowerCase(),
    generalPublicationGraphHash: (value.generalPublicationGraphHash as string).toLowerCase(),
    publicationVisualPlan,
    sourceHashes: lineage.sourceHashes,
    createdAt: value.createdAt as string,
  };
}

function parseLineage(plan: PublicationVisualPlan): { sourceHashes: readonly string[] } {
  const lineage = plainRecord(plan.lineage, "PVP lineage is invalid");
  assertExactKeys(lineage, ["ugsHash", "gpgHash", "sourceHashes", "composerHash", "profileSetHash"], "PVP lineage");
  assertDigest(lineage.ugsHash, "PVP lineage ugsHash");
  assertDigest(lineage.gpgHash, "PVP lineage gpgHash");
  assertDigest(lineage.composerHash, "PVP lineage composerHash");
  assertDigest(lineage.profileSetHash, "PVP lineage profileSetHash");
  if (!Array.isArray(lineage.sourceHashes) || lineage.sourceHashes.length === 0 || lineage.sourceHashes.some((item) => typeof item !== "string" || !DIGEST.test(item))) throw new Error("PVP lineage sourceHashes are invalid");
  const normalized = lineage.sourceHashes.map((item) => item.toLowerCase()).sort(compareCodeUnits);
  if (new Set(normalized).size !== normalized.length) throw new Error("PVP lineage sourceHashes must be unique");
  return { sourceHashes: Object.freeze(normalized) };
}

function serializeCanonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON does not permit non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) throw new Error("canonical JSON does not permit sparse arrays");
      items.push(serializeCanonicalValue(value[index]));
    }
    return `[${items.join(",")}]`;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort(compareCodeUnits).map((key) => `${JSON.stringify(key)}:${serializeCanonicalValue(record[key])}`).join(",")}}`;
  }
  throw new Error("canonical JSON accepts only plain JSON values");
}

function plainRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(message);
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(compareCodeUnits);
  const sortedExpected = [...expected].sort(compareCodeUnits);
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) throw new Error(`${label} has unsupported fields`);
}

function assertIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string" || !IDENTIFIER.test(value) || value.length > 128) throw new Error(`${field} must be a stable identifier`);
}

function assertDigest(value: unknown, field: string): void {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new Error(`${field} must be a SHA-256 digest`);
}

function assertCreatedAt(value: unknown): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) throw new Error("createdAt must be a canonical UTC timestamp");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}
