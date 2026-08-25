import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createGenericPlanSnapshot, type GenericPlanSnapshotOwner } from "../src/generic-plan-snapshot.js";
import { GenericPlanSnapshotStoreConflictError } from "../src/generic-plan-snapshot-store.js";
import { createPublicationVisualPlan } from "../src/publication-visual-plan.js";
import { promotePublicationVisualPlanAfterTrustedReview } from "../src/publication-visual-plan-qa-promotion.js";
import { PostgresGenericPlanSnapshotStore } from "../src/postgres-generic-plan-snapshot-store.js";

const owner: GenericPlanSnapshotOwner = { tenantId: "tenant-1", userId: "user-1", deviceId: "device-1" };

function pendingPvp() {
  return createPublicationVisualPlan({
    identity: { schemaVersion: 1, planId: "pvp:postgres-store", canonicalHash: "" },
    eligibility: { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: [], qaStatus: "pending" },
    lineage: { ugsHash: "a".repeat(64), gpgHash: "b".repeat(64), sourceHashes: ["d".repeat(64)], composerHash: "c".repeat(64), profileSetHash: "e".repeat(64) },
    coordinateSpace: { id: "pvp-du-1", origin: "top_left", axes: "x_right_y_down", unit: "du", duPerInch: 1000, page: { x: 0, y: 0, width: 1000, height: 600 }, safeMargins: { x: 10, y: 10, width: 980, height: 580 } },
    regions: [], primitiveGroups: [], primitives: [], ports: [], connectors: [], annotations: [], legend: { entries: [], styleTokenIds: [] }, styleTokens: { tokenSetVersion: "pvp-style-1", tokens: [] }, profileApplications: [], sourceMappings: [],
    rendererRequirements: { protocolVersion: "pvp-renderer-1", requiredCapabilities: ["native-text", "orthogonal-route", "shape-data"], optionalCapabilities: [] },
    updateIdentity: { ownerId: owner.userId, deviceId: owner.deviceId, workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 },
  });
}

function snapshotWithPlan(publicationVisualPlan: ReturnType<typeof pendingPvp>, overrides: { graphId?: string; ugsRevision?: number } = {}) {
  return createGenericPlanSnapshot({
    ...owner,
    graphId: overrides.graphId ?? "graph-1",
    ugsRevision: overrides.ugsRevision ?? 1,
    ugsCanonicalHash: "a".repeat(64),
    generalPublicationGraphHash: "b".repeat(64),
    publicationVisualPlan,
    createdAt: "2026-08-25T00:00:00.000Z",
  });
}

function confirmedFixture(overrides: { graphId?: string; ugsRevision?: number } = {}) {
  const pending = pendingPvp();
  const publicationVisualPlan = promotePublicationVisualPlanAfterTrustedReview({
    plan: pending,
    review: {
      authority: "trusted-human",
      reviewerId: "reviewer-1",
      reviewedAt: "2026-08-25T00:00:00.000Z",
      approval: "approved",
      expectedPlanHash: pending.identity.canonicalHash,
    },
  }).plan;
  return {
    pendingPreviewHash: pending.identity.canonicalHash,
    snapshot: snapshotWithPlan(publicationVisualPlan, overrides),
  };
}

function snapshot() {
  return confirmedFixture().snapshot;
}

function snapshotWithFormalReasons(formalReasons: readonly string[]) {
  const pending = pendingPvp();
  const publicationVisualPlan = createPublicationVisualPlan({
    ...structuredClone(pending),
    identity: { ...pending.identity, canonicalHash: "" },
    eligibility: { kind: "formal", formalReasons: [...formalReasons], blockingReasons: [], qaStatus: "passed" },
  });
  return snapshotWithPlan(publicationVisualPlan);
}

describe("PostgresGenericPlanSnapshotStore", () => {
  it("inserts canonical JSON and reads it back through the full owner/device locator", async () => {
    const confirmed = confirmedFixture();
    const canonical = confirmed.snapshot;
    const pool = new RecordingPool([
      { rows: [{ snapshot_id: canonical.snapshotId }], rowCount: 1 },
      { rows: [{ snapshot: JSON.stringify(canonical) }], rowCount: 1 },
    ]);
    const store = new PostgresGenericPlanSnapshotStore(pool as never);

    await expect(store.insert(owner, canonical)).resolves.toEqual(canonical);
    await expect(store.get(owner, canonical.graphId, canonical.ugsRevision, canonical.snapshotId)).resolves.toEqual(canonical);

    expect(pool.calls[0].text).toContain("INSERT INTO generic_plan_snapshots");
    expect(pool.calls[0].text).toContain("publication_visual_plan_hash");
    expect(pool.calls[0].text).toContain("confirmed_preview_hash");
    expect(pool.calls[0].values).toContain(canonical.publicationVisualPlanHash);
    expect(pool.calls[0].values).toContain(confirmed.pendingPreviewHash);
    expect(pool.calls[1].text).toContain("tenant_id = $1 AND user_id = $2 AND device_id = $3");
    expect(pool.calls[1].values).toEqual([owner.tenantId, owner.userId, owner.deviceId, canonical.graphId, canonical.ugsRevision, canonical.snapshotId]);
  });

  it("resolves by exact owner, device, and explicit PVP hash without scanning JSONB", async () => {
    const canonical = snapshot();
    const pool = new RecordingPool([{ rows: [{ snapshot: JSON.stringify(canonical), publication_visual_plan_hash: canonical.publicationVisualPlanHash }], rowCount: 1 }]);
    const store = new PostgresGenericPlanSnapshotStore(pool as never);

    await expect(store.getByPublicationVisualPlanHash(owner, canonical.publicationVisualPlanHash)).resolves.toEqual(canonical);

    expect(pool.calls[0].text).toContain("tenant_id = $1 AND user_id = $2 AND device_id = $3");
    expect(pool.calls[0].text).toContain("publication_visual_plan_hash = $4");
    expect(pool.calls[0].text).toMatch(/LIMIT\s+2/i);
    expect(pool.calls[0].text).not.toMatch(/snapshot\s*(?:->|#>)/i);
    expect(pool.calls[0].values).toEqual([owner.tenantId, owner.userId, owner.deviceId, canonical.publicationVisualPlanHash]);
  });

  it("returns null when no snapshot has the confirmed PVP hash", async () => {
    const store = new PostgresGenericPlanSnapshotStore(new RecordingPool([{ rows: [], rowCount: 0 }]) as never);
    await expect(store.getByPublicationVisualPlanHash(owner, "f".repeat(64))).resolves.toBeNull();
  });

  it("fails closed if PostgreSQL returns ambiguous snapshots for one owner/device/PVP hash", async () => {
    const canonical = snapshot();
    const row = { snapshot: JSON.stringify(canonical), publication_visual_plan_hash: canonical.publicationVisualPlanHash };
    const store = new PostgresGenericPlanSnapshotStore(new RecordingPool([{ rows: [row, row], rowCount: 2 }]) as never);

    await expect(store.getByPublicationVisualPlanHash(owner, canonical.publicationVisualPlanHash)).rejects.toThrow(/ambiguous/i);
  });

  it("resolves by exact owner, device, and explicit confirmed-preview hash without scanning JSONB", async () => {
    const confirmed = confirmedFixture();
    const row = { snapshot: JSON.stringify(confirmed.snapshot), confirmed_preview_hash: confirmed.pendingPreviewHash };
    const pool = new RecordingPool([{ rows: [row], rowCount: 1 }]);
    const store = new PostgresGenericPlanSnapshotStore(pool as never);

    await expect(store.getByConfirmedPreviewHash(owner, confirmed.pendingPreviewHash.toUpperCase())).resolves.toEqual(confirmed.snapshot);

    expect(confirmed.pendingPreviewHash).not.toBe(confirmed.snapshot.publicationVisualPlanHash);
    expect(pool.calls[0].text).toContain("tenant_id = $1 AND user_id = $2 AND device_id = $3");
    expect(pool.calls[0].text).toContain("confirmed_preview_hash = $4");
    expect(pool.calls[0].text).toMatch(/LIMIT\s+2/i);
    expect(pool.calls[0].text).not.toMatch(/snapshot\s*(?:->|#>)/i);
    expect(pool.calls[0].values).toEqual([owner.tenantId, owner.userId, owner.deviceId, confirmed.pendingPreviewHash]);
  });

  it("returns null when the confirmed-preview hash is missing", async () => {
    const store = new PostgresGenericPlanSnapshotStore(new RecordingPool([{ rows: [], rowCount: 0 }]) as never);
    await expect(store.getByConfirmedPreviewHash(owner, "f".repeat(64))).resolves.toBeNull();
  });

  it("fails closed for ambiguous confirmed-preview rows or a mismatched row locator", async () => {
    const confirmed = confirmedFixture();
    const row = { snapshot: JSON.stringify(confirmed.snapshot), confirmed_preview_hash: confirmed.pendingPreviewHash };
    const ambiguous = new PostgresGenericPlanSnapshotStore(new RecordingPool([{ rows: [row, row], rowCount: 2 }]) as never);
    await expect(ambiguous.getByConfirmedPreviewHash(owner, confirmed.pendingPreviewHash)).rejects.toThrow(/ambiguous/i);

    const mismatched = new PostgresGenericPlanSnapshotStore(new RecordingPool([{
      rows: [{ ...row, confirmed_preview_hash: "f".repeat(64) }],
      rowCount: 1,
    }]) as never);
    await expect(mismatched.getByConfirmedPreviewHash(owner, confirmed.pendingPreviewHash)).rejects.toThrow(/identity|locator|hash/i);
  });

  it("refuses to insert snapshots without exactly one trusted promotion reason", async () => {
    const pending = pendingPvp();
    const untrustedPassed = createPublicationVisualPlan({
      ...structuredClone(pending),
      identity: { ...pending.identity, canonicalHash: "" },
      eligibility: { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: [], qaStatus: "passed" },
    });
    const noReasonPool = new RecordingPool([]);
    await expect(new PostgresGenericPlanSnapshotStore(noReasonPool as never).insert(owner, snapshotWithPlan(untrustedPassed))).rejects.toThrow(/promotion|confirmed/i);
    expect(noReasonPool.calls).toHaveLength(0);

    const confirmed = confirmedFixture();
    const promoted = confirmed.snapshot.publicationVisualPlan;
    const multiplyPromoted = createPublicationVisualPlan({
      ...structuredClone(promoted),
      identity: { ...promoted.identity, canonicalHash: "" },
      eligibility: {
        ...promoted.eligibility,
        formalReasons: [...promoted.eligibility.formalReasons, `visual-qa:pvp-qa-1:${"f".repeat(64)}`],
      },
    });
    const multipleReasonsPool = new RecordingPool([]);
    await expect(new PostgresGenericPlanSnapshotStore(multipleReasonsPool as never).insert(owner, snapshotWithPlan(multiplyPromoted))).rejects.toThrow(/ambiguous|promotion/i);
    expect(multipleReasonsPool.calls).toHaveLength(0);
  });

  it("uses the same strict malformed promotion-reason grammar as the in-memory store", async () => {
    const pendingHash = "a".repeat(64);
    const malformedReasons = [
      `visual-qa:pvp-qa-1:${"a".repeat(63)}`,
      `visual-qa:pvp-qa-1:${pendingHash.toUpperCase()}`,
      `visual-qa:pvp-qa-1:${pendingHash}:trailing`,
      `trusted-qa:pvp-qa-1:${pendingHash}`,
      `visual-qa:pvp-qa-2:${pendingHash}`,
    ];

    for (const malformedReason of malformedReasons) {
      const malformedPool = new RecordingPool([]);
      await expect(new PostgresGenericPlanSnapshotStore(malformedPool as never).insert(owner, snapshotWithFormalReasons([
        "topology-complete",
        malformedReason,
      ]))).rejects.toThrow(/promotion|confirmed/i);
      expect(malformedPool.calls).toHaveLength(0);

      const acceptedPool = new RecordingPool([{ rows: [{ snapshot_id: "stored" }], rowCount: 1 }]);
      await expect(new PostgresGenericPlanSnapshotStore(acceptedPool as never).insert(owner, snapshotWithFormalReasons([
        "topology-complete",
        `visual-qa:pvp-qa-1:${pendingHash}`,
        malformedReason,
      ]))).resolves.toBeDefined();
      expect(acceptedPool.calls[0].values).toContain(pendingHash);
    }
  });

  it("reports an immutable-key conflict instead of overwriting an existing snapshot", async () => {
    const canonical = snapshot();
    const store = new PostgresGenericPlanSnapshotStore(new RecordingPool([{ rows: [], rowCount: 0 }]) as never);
    await expect(store.insert(owner, canonical)).rejects.toBeInstanceOf(GenericPlanSnapshotStoreConflictError);
  });

  it("ships a dedicated immutable generic snapshot migration", () => {
    const sql = readFileSync(resolve(process.cwd(), "apps/api/sql/016_generic_plan_snapshots.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS generic_plan_snapshots");
    expect(sql).toContain("publication_visual_plan_hash TEXT NOT NULL");
    expect(sql).toContain("PRIMARY KEY (tenant_id, user_id, device_id, graph_id, ugs_revision, snapshot_id)");
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS generic_plan_snapshots_owner_pvp_hash_uidx\s+ON generic_plan_snapshots \(tenant_id, user_id, device_id, publication_visual_plan_hash\)/);
    expect(sql).not.toMatch(/ON\s+DELETE\s+CASCADE/i);
  });

  it("installs an immutable trigger that rejects both updates and deletes", () => {
    const sql = readFileSync(resolve(process.cwd(), "apps/api/sql/016_generic_plan_snapshots.sql"), "utf8");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION reject_generic_plan_snapshot_mutation()");
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON generic_plan_snapshots");
    expect(sql).toContain("EXECUTE FUNCTION reject_generic_plan_snapshot_mutation()");
  });

  it("ships an idempotent schema-016 backfill migration with a required unique confirmed-preview hash", () => {
    const sql = readFileSync(resolve(process.cwd(), "apps/api/sql/017_generic_plan_snapshot_confirmed_previews.sql"), "utf8");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS confirmed_preview_hash TEXT");
    expect(sql).toContain("jsonb_array_elements_text");
    expect(sql).toContain("AS promotion(reason)");
    expect(sql).toContain("visual-qa:pvp-qa-1:");
    expect(sql).toMatch(/HAVING\s+COUNT\(\*\)\s*=\s*1/i);
    expect(sql).toContain("ALTER COLUMN confirmed_preview_hash SET NOT NULL");
    expect(sql).toContain("CHECK (confirmed_preview_hash ~ '^[0-9a-f]{64}$')");
    expect(sql).toContain("confirmed_preview_hash IS DISTINCT FROM trusted_promotions.confirmed_preview_hash");
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS generic_plan_snapshots_owner_confirmed_preview_hash_uidx\s+ON generic_plan_snapshots \(tenant_id, user_id, device_id, confirmed_preview_hash\)/);
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON generic_plan_snapshots");
  });

  it("runs migrations 001-017 for fresh schemas and only 016-017 for existing schemas in both smoke paths", () => {
    for (const path of ["scripts/postgres-smoke.mjs", "scripts/postgres-restart-smoke.ts"]) {
      const smoke = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(smoke).toContain('"generic_plan_snapshot_confirmed_previews"');
      expect(smoke).toMatch(/Array\.from\(\{ length: 17 \}/);
      expect(smoke).toMatch(/if \(!schema\.rows\[0\]\?\.users_table\) \{\s*for \(const migration of migrations\) await \w+\.query\(migration\);\s*\} else \{\s*for \(const migration of migrations\.slice\(15\)\) await \w+\.query\(migration\);\s*\}/);
      expect(smoke).not.toContain("migrations.slice(1)");
    }
  });

  it("provides a disposable behavioral PostgreSQL migration smoke path", () => {
    const smoke = readFileSync(resolve(process.cwd(), "scripts/postgres-generic-plan-snapshot-migration-smoke.ts"), "utf8");
    expect(smoke).toContain("CREATE SCHEMA");
    expect(smoke).toContain("SET search_path");
    expect(smoke).toContain("016_generic_plan_snapshots.sql");
    expect(smoke).toContain("017_generic_plan_snapshot_confirmed_previews.sql");
    expect(smoke).toContain("confirmed_preview_hash");
    expect(smoke).toContain("23502");
    expect(smoke).toContain("23514");
    expect(smoke).toContain("23505");
    expect(smoke).toContain("UPDATE generic_plan_snapshots");
    expect(smoke).toContain("DELETE FROM generic_plan_snapshots");
    expect(smoke).toContain("DROP SCHEMA");
  });
});

class RecordingPool {
  readonly calls: Array<{ text: string; values: unknown[] }> = [];

  constructor(private readonly results: Array<{ rows: unknown[]; rowCount: number }>) {}

  async query(text: string, values: unknown[] = []) {
    this.calls.push({ text, values });
    return this.results.shift() ?? { rows: [], rowCount: 0 };
  }
}
