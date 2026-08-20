import { createHash } from "node:crypto";
import { compareCodeUnits } from "./stable-string-order.js";

const identifier = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const digest = /^[a-f0-9]{64}$/i;

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
  generalPublicationFigurePlanHash: string;
  sourceHashes: string[];
  createdAt: string;
}

export interface GenericPlanSnapshot extends Readonly<GenericPlanSnapshotOwner> {
  readonly version: 1;
  readonly snapshotId: string;
  readonly graphId: string;
  readonly ugsRevision: number;
  readonly ugsCanonicalHash: string;
  readonly generalPublicationGraphHash: string;
  readonly generalPublicationFigurePlanHash: string;
  readonly sourceHashes: readonly string[];
  readonly createdAt: string;
  readonly immutable: true;
}

export function createGenericPlanSnapshot(input: CreateGenericPlanSnapshotInput): GenericPlanSnapshot {
  const safe = validateGenericPlanSnapshotInput(input);
  const identity = {
    tenantId: safe.tenantId,
    userId: safe.userId,
    deviceId: safe.deviceId,
    graphId: safe.graphId,
    ugsRevision: safe.ugsRevision,
    ugsCanonicalHash: safe.ugsCanonicalHash,
    generalPublicationGraphHash: safe.generalPublicationGraphHash,
    generalPublicationFigurePlanHash: safe.generalPublicationFigurePlanHash,
    sourceHashes: [...safe.sourceHashes].sort(compareCodeUnits),
  };
  return deepFreeze({
    version: 1,
    snapshotId: `generic-plan-${sha256(canonicalGenericPlanSnapshotJson(identity)).slice(0, 32)}`,
    ...identity,
    createdAt: safe.createdAt,
    immutable: true,
  });
}

export function cloneGenericPlanSnapshot(snapshot: GenericPlanSnapshot): GenericPlanSnapshot {
  return deepFreeze(structuredClone(snapshot));
}

export function digestGenericPlanSnapshotValue(value: unknown): string {
  return sha256(canonicalGenericPlanSnapshotJson(value));
}

export function canonicalGenericPlanSnapshotJson(value: unknown): string {
  return serializeCanonicalValue(value);
}

function validateGenericPlanSnapshotInput(input: CreateGenericPlanSnapshotInput): CreateGenericPlanSnapshotInput {
  assertIdentifier(input.tenantId, "tenantId");
  assertIdentifier(input.userId, "userId");
  assertIdentifier(input.deviceId, "deviceId");
  assertIdentifier(input.graphId, "graphId");
  if (!Number.isSafeInteger(input.ugsRevision) || input.ugsRevision <= 0) throw new Error("ugsRevision must be a positive safe integer");
  assertDigest(input.ugsCanonicalHash, "ugsCanonicalHash");
  assertDigest(input.generalPublicationGraphHash, "generalPublicationGraphHash");
  assertDigest(input.generalPublicationFigurePlanHash, "generalPublicationFigurePlanHash");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.createdAt) || new Date(input.createdAt).toISOString() !== input.createdAt) throw new Error("createdAt must be a canonical UTC timestamp");
  if (!Array.isArray(input.sourceHashes) || input.sourceHashes.length === 0) throw new Error("sourceHashes must be non-empty");
  for (const sourceHash of input.sourceHashes) assertDigest(sourceHash, "sourceHashes");
  if (new Set(input.sourceHashes.map((value) => value.toLowerCase())).size !== input.sourceHashes.length) throw new Error("sourceHashes must be unique");
  return {
    ...structuredClone(input),
    ugsCanonicalHash: input.ugsCanonicalHash.toLowerCase(),
    generalPublicationGraphHash: input.generalPublicationGraphHash.toLowerCase(),
    generalPublicationFigurePlanHash: input.generalPublicationFigurePlanHash.toLowerCase(),
    sourceHashes: input.sourceHashes.map((value) => value.toLowerCase()),
  };
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

function assertIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || !identifier.test(value) || value.length > 128) throw new Error(`${field} must be a stable identifier`);
}

function assertDigest(value: string, field: string): void {
  if (typeof value !== "string" || !digest.test(value)) throw new Error(`${field} must be a SHA-256 digest`);
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
