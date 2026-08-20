import { describe, expect, it } from "vitest";
import {
  canonicalGenericPlanSnapshotJson,
  cloneGenericPlanSnapshot,
  createGenericPlanSnapshot,
  type CreateGenericPlanSnapshotInput,
} from "../src/generic-plan-snapshot.js";

function input(overrides: Partial<CreateGenericPlanSnapshotInput> = {}): CreateGenericPlanSnapshotInput {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    deviceId: "device-1",
    graphId: "graph-1",
    ugsRevision: 1,
    ugsCanonicalHash: "a".repeat(64),
    generalPublicationGraphHash: "b".repeat(64),
    generalPublicationFigurePlanHash: "c".repeat(64),
    sourceHashes: ["e".repeat(64), "d".repeat(64)],
    createdAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("GenericPlanSnapshot", () => {
  it("uses canonical JSON and every security-relevant binding for deterministic identity", () => {
    const baseline = createGenericPlanSnapshot(input());
    const reordered = createGenericPlanSnapshot(input({ sourceHashes: ["d".repeat(64), "e".repeat(64)] }));
    expect(reordered.snapshotId).toBe(baseline.snapshotId);
    expect(reordered.sourceHashes).toEqual(["d".repeat(64), "e".repeat(64)]);
    expect(canonicalGenericPlanSnapshotJson({ "2": "two", "10": "ten" })).toBe('{"10":"ten","2":"two"}');

    const changedInputs: Array<Partial<CreateGenericPlanSnapshotInput>> = [
      { tenantId: "tenant-2" }, { userId: "user-2" }, { deviceId: "device-2" }, { graphId: "graph-2" }, { ugsRevision: 2 },
      { ugsCanonicalHash: "f".repeat(64) }, { generalPublicationGraphHash: "0".repeat(64) },
      { generalPublicationFigurePlanHash: "1".repeat(64) }, { sourceHashes: ["f".repeat(64)] },
    ];
    for (const changed of changedInputs) expect(createGenericPlanSnapshot(input(changed)).snapshotId).not.toBe(baseline.snapshotId);
  });

  it("records immutable audit time without making it part of deterministic identity", () => {
    const first = createGenericPlanSnapshot(input());
    const second = createGenericPlanSnapshot(input({ createdAt: "2026-08-20T01:00:00.000Z" }));
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(second.createdAt).not.toBe(first.createdAt);
  });

  it("normalizes accepted SHA-256 spellings before deriving identity or retaining metadata", () => {
    const lower = createGenericPlanSnapshot(input());
    const upper = createGenericPlanSnapshot(input({
      ugsCanonicalHash: "A".repeat(64),
      generalPublicationGraphHash: "B".repeat(64),
      generalPublicationFigurePlanHash: "C".repeat(64),
      sourceHashes: ["E".repeat(64), "D".repeat(64)],
    }));
    expect(upper.snapshotId).toBe(lower.snapshotId);
    expect(upper.ugsCanonicalHash).toBe("a".repeat(64));
    expect(upper.sourceHashes).toEqual(["d".repeat(64), "e".repeat(64)]);
  });

  it("rejects invalid IDs, timestamps, duplicate source hashes, and non-finite canonical values", () => {
    expect(() => createGenericPlanSnapshot(input({ deviceId: "C:\\device" }))).toThrow(/deviceId|identifier/i);
    expect(() => createGenericPlanSnapshot(input({ createdAt: "20/08/2026" }))).toThrow(/timestamp|datetime|createdAt/i);
    expect(() => createGenericPlanSnapshot(input({ createdAt: "2026-02-30T00:00:00.000Z" }))).toThrow(/timestamp|datetime|createdAt/i);
    expect(() => createGenericPlanSnapshot(input({ sourceHashes: ["d".repeat(64), "d".repeat(64)] }))).toThrow(/sourceHashes|duplicate/i);
    expect(() => canonicalGenericPlanSnapshotJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/i);
    expect(() => canonicalGenericPlanSnapshotJson(new Array(1))).toThrow(/sparse|array/i);
    expect(() => canonicalGenericPlanSnapshotJson([1, , 2])).toThrow(/sparse|array/i);
    const inheritedIndex = new Array(1);
    Object.setPrototypeOf(inheritedIndex, { 0: "inherited" });
    expect(() => canonicalGenericPlanSnapshotJson(inheritedIndex)).toThrow(/sparse|array/i);
    expect(() => createGenericPlanSnapshot(input({ sourceHashes: ["d".repeat(64), "D".repeat(64)] }))).toThrow(/sourceHashes|unique/i);
  });

  it("deep-freezes clone-isolated metadata and exposes no renderer or source payload fields", () => {
    const source = input();
    const snapshot = createGenericPlanSnapshot(source);
    source.sourceHashes[0] = "f".repeat(64);
    const clone = cloneGenericPlanSnapshot(snapshot);

    expect(snapshot.sourceHashes).toEqual(["d".repeat(64), "e".repeat(64)]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.sourceHashes)).toBe(true);
    expect(clone).toEqual(snapshot);
    expect(clone).not.toBe(snapshot);
    expect(JSON.stringify(snapshot)).not.toMatch(/"(?:rawSource|sourceCode|sourceBytes|evidenceLocator|providerPayload|workerPath|shellCommand|comInstruction|svg|visio)"\s*:/i);
  });
});
