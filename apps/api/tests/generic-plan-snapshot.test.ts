import { describe, expect, it } from "vitest";
import { createPublicationVisualPlan, type PublicationVisualPlan } from "../src/publication-visual-plan.js";
import {
  canonicalGenericPlanSnapshotJson,
  cloneGenericPlanSnapshot,
  createGenericPlanSnapshot,
  type CreateGenericPlanSnapshotInput,
} from "../src/generic-plan-snapshot.js";

function pvp(overrides: Record<string, unknown> = {}): PublicationVisualPlan {
  return createPublicationVisualPlan({
    identity: { schemaVersion: 1, planId: "pvp:snapshot", canonicalHash: "" },
    eligibility: { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: [], qaStatus: "passed" },
    lineage: { ugsHash: "a".repeat(64), gpgHash: "b".repeat(64), sourceHashes: ["e".repeat(64), "d".repeat(64)], composerHash: "c".repeat(64), profileSetHash: "f".repeat(64) },
    coordinateSpace: { id: "pvp-du-1", origin: "top_left", axes: "x_right_y_down", unit: "du", duPerInch: 1000, page: { x: 0, y: 0, width: 1000, height: 600 }, safeMargins: { x: 10, y: 10, width: 980, height: 580 } },
    regions: [], primitiveGroups: [], primitives: [], ports: [], connectors: [], annotations: [], legend: { entries: [], styleTokenIds: [] }, styleTokens: { tokenSetVersion: "pvp-style-1", tokens: [] }, profileApplications: [], sourceMappings: [],
    rendererRequirements: { protocolVersion: "pvp-renderer-1", requiredCapabilities: ["native-text", "orthogonal-route", "shape-data"], optionalCapabilities: [] },
    updateIdentity: { ownerId: "user-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 },
    ...overrides,
  });
}

function input(overrides: Partial<CreateGenericPlanSnapshotInput> = {}): CreateGenericPlanSnapshotInput {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    deviceId: "device-1",
    graphId: "graph-1",
    ugsRevision: 1,
    ugsCanonicalHash: "a".repeat(64),
    generalPublicationGraphHash: "b".repeat(64),
    publicationVisualPlan: pvp(),
    createdAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("GenericPlanSnapshot", () => {
  it("uses canonical PVP identity and every security-relevant binding for deterministic identity", () => {
    const baseline = createGenericPlanSnapshot(input());
    const reordered = createGenericPlanSnapshot(input({ publicationVisualPlan: pvp({ lineage: { ugsHash: "a".repeat(64), gpgHash: "b".repeat(64), sourceHashes: ["d".repeat(64), "e".repeat(64)], composerHash: "c".repeat(64), profileSetHash: "f".repeat(64) } }) }));
    const differentPvp = createGenericPlanSnapshot(input({ publicationVisualPlan: pvp({ identity: { schemaVersion: 1, planId: "pvp:changed", canonicalHash: "" } }) }));

    expect(reordered.snapshotId).toBe(baseline.snapshotId);
    expect(reordered.sourceHashes).toEqual(["d".repeat(64), "e".repeat(64)]);
    expect(differentPvp.snapshotId).not.toBe(baseline.snapshotId);
    expect(canonicalGenericPlanSnapshotJson({ "2": "two", "10": "ten" })).toBe('{"10":"ten","2":"two"}');
  });

  it("records immutable audit time without making it part of deterministic identity", () => {
    const first = createGenericPlanSnapshot(input());
    const second = createGenericPlanSnapshot(input({ createdAt: "2026-08-20T01:00:00.000Z" }));
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(second.createdAt).not.toBe(first.createdAt);
  });

  it("rejects legacy Figure Plan bindings and invalid PVP Snapshot values", () => {
    expect(() => createGenericPlanSnapshot({ ...input(), generalPublicationFigurePlanHash: "c".repeat(64) } as never)).toThrow(/unsupported|Figure Plan|PVP/i);
    expect(() => createGenericPlanSnapshot(input({ deviceId: "C:\\device" }))).toThrow(/deviceId|identifier/i);
    expect(() => createGenericPlanSnapshot(input({ createdAt: "20/08/2026" }))).toThrow(/timestamp|datetime|createdAt/i);
    expect(() => canonicalGenericPlanSnapshotJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/i);
    expect(() => canonicalGenericPlanSnapshotJson([1, , 2])).toThrow(/sparse|array/i);
  });

  it("accepts numeric-leading authenticated owner identities without broadening structural identifiers", () => {
    const snapshot = createGenericPlanSnapshot(input({
      tenantId: "1b5a4fa9-4d91-4f3f-b9b2-5d1aee9a4162",
      userId: "7f9a7a9e-1bce-44a8-bf2c-1f2a9cd8d70a",
      deviceId: "4e5b1c57-99cf-4d1f-9d12-8c2a6d5f4e40",
    }));

    expect(snapshot.userId).toBe("7f9a7a9e-1bce-44a8-bf2c-1f2a9cd8d70a");
    expect(() => createGenericPlanSnapshot(input({ graphId: "7graph" }))).toThrow(/graphId|identifier/i);
  });

  it("deep-freezes a clone-isolated PVP and exposes no legacy Figure Plan or renderer payload fields", () => {
    const source = input();
    const snapshot = createGenericPlanSnapshot(source);
    const clone = cloneGenericPlanSnapshot(snapshot);

    expect(snapshot.publicationVisualPlanId).toBe("pvp:snapshot");
    expect(snapshot.publicationVisualPlanHash).toBe(snapshot.publicationVisualPlan.identity.canonicalHash);
    expect(snapshot).not.toHaveProperty("generalPublicationFigurePlanHash");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.publicationVisualPlan)).toBe(true);
    expect(clone).toEqual(snapshot);
    expect(clone).not.toBe(snapshot);
    expect(clone.publicationVisualPlan).not.toBe(snapshot.publicationVisualPlan);
    expect(JSON.stringify(snapshot)).not.toMatch(/"(?:rawSource|sourceCode|sourceBytes|evidenceLocator|providerPayload|workerPath|shellCommand|comInstruction|svg|visio)"\s*:/i);
  });
});
