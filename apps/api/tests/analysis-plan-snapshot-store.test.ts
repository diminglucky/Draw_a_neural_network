import { describe, expect, it } from "vitest";
import { createAnalysisPlanSnapshot } from "../src/analysis-plan-snapshot.js";
import { InMemoryAnalysisPlanSnapshotStore } from "../src/analysis-plan-snapshot-store.js";
import { buildComposableDagPublicationPlan } from "../src/composable-dag-publication-plan.js";
import type { PublicComposableDagPublicationPlan } from "../src/figure-analysis-preview-service.js";
import { defaultFigureIntent } from "../src/figure-intent.js";
import { cnnGoldIr } from "./fixtures/figure-component-gold-ir.js";

function publicationPlan(): PublicComposableDagPublicationPlan {
  const built = buildComposableDagPublicationPlan({ architectureIr: cnnGoldIr(), intent: defaultFigureIntent(), layoutSeed: "seed-1" });
  if (built.status !== "ready") throw new Error("test fixture must produce a publication plan");
  return {
    version: 1,
    graphId: built.publicationPlan.dagPlan.graphId,
    compilerVersion: built.publicationPlan.dagPlan.compilerVersion,
    layoutVersion: built.publicationPlan.dagPlan.layoutVersion,
    intent: structuredClone(built.publicationPlan.dagPlan.intent),
    pageBounds: structuredClone(built.publicationPlan.dagPlan.pageBounds),
    components: built.publicationPlan.dagPlan.components.map(({ evidenceIds: _evidenceIds, ...component }) => structuredClone(component)),
    connections: built.publicationPlan.dagPlan.connections.map(({ evidenceIds: _evidenceIds, ...connection }) => structuredClone(connection)),
    visualSpec: structuredClone(built.publicationPlan.visualSpec),
    qaVersion: built.publicationPlan.qaVersion,
  };
}

function snapshot() {
  return createAnalysisPlanSnapshot({
    tenantId: "tenant-1",
    userId: "user-1",
    analysisId: "analysis-1",
    analysisStatus: "ready_for_preview",
    architectureIrHash: "a".repeat(64),
    figureIntentHash: "b".repeat(64),
    publicationPlan: publicationPlan(),
    compilerManifest: { canonicalization: "RFC-8785-JCS", architectureIrHash: "a".repeat(64), figureIntentHash: "b".repeat(64), componentCompilerVersion: "component-v1", layoutCompilerVersion: "layout-v1", styleTokenVersion: "style-v1", layoutSeed: "seed-1" },
    visualQa: { status: "pass", checks: [{ id: "bounds", severity: "blocking", passed: true, message: "fits" }] },
    previewArtifactHashes: [{ panelId: "overview", kind: "svg", sha256: "c".repeat(64) }],
    createdAt: "2026-08-18T00:00:00.000Z",
  });
}

describe("InMemoryAnalysisPlanSnapshotStore", () => {
  it("inserts once, scopes reads to the exact owner, and does not overwrite", async () => {
    const store = new InMemoryAnalysisPlanSnapshotStore();
    const value = snapshot();
    const owner = { tenantId: "tenant-1", userId: "user-1" };

    await expect(store.insert(owner, value)).resolves.toEqual(value);
    await expect(store.insert(owner, value)).rejects.toThrow(/immutable|exists/i);
    await expect(store.get(owner, value.analysisId, value.snapshotId)).resolves.toEqual(value);
    await expect(store.get({ tenantId: "tenant-2", userId: "user-1" }, value.analysisId, value.snapshotId)).resolves.toBeNull();
    await expect(store.get({ tenantId: "tenant-1", userId: "user-2" }, value.analysisId, value.snapshotId)).resolves.toBeNull();
  });

  it("isolates stored values from returned and caller-owned object references", async () => {
    const store = new InMemoryAnalysisPlanSnapshotStore();
    const value = snapshot();
    const owner = { tenantId: "tenant-1", userId: "user-1" };

    const inserted = await store.insert(owner, value);
    const first = await store.get(owner, value.analysisId, value.snapshotId);
    const second = await store.get(owner, value.analysisId, value.snapshotId);

    expect(inserted).not.toBe(value);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first!.publicationPlan)).toBe(true);
    expect(() => {
      first!.publicationPlan.components[0]!.semanticRole = "mutated";
    }).toThrow();
    expect(second!.publicationPlan.components[0]!.semanticRole).toBe(value.publicationPlan.components[0]!.semanticRole);
  });
});
