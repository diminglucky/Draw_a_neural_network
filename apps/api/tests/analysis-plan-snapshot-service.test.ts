import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, createAnalysisPlanSnapshot } from "../src/analysis-plan-snapshot.js";
import {
  AnalysisPlanSnapshotService,
  type CreateAnalysisPlanSnapshotRequest,
  type AnalysisPlanSnapshotStore,
} from "../src/analysis-plan-snapshot-service.js";
import { InMemoryAnalysisPlanSnapshotStore } from "../src/analysis-plan-snapshot-store.js";
import { buildComposableDagPublicationPlan } from "../src/composable-dag-publication-plan.js";
import { defaultFigureIntent } from "../src/figure-intent.js";
import { runComposableDagVisualQa } from "../src/composable-dag-visual-qa.js";
import { projectPublicComposableDagPublicationPlan } from "../src/figure-analysis-preview-service.js";
import { cnnGoldIr } from "./fixtures/figure-component-gold-ir.js";

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function legacyRequest() {
  const figureIntent = defaultFigureIntent();
  const built = buildComposableDagPublicationPlan({ architectureIr: cnnGoldIr(), intent: figureIntent, layoutSeed: "seed-1" });
  if (built.status !== "ready") throw new Error("test fixture must produce a legacy publication plan");
  const publicationPlan = projectPublicComposableDagPublicationPlan(built.publicationPlan);
  return {
    owner: { tenantId: "tenant-1", userId: "user-1" },
    analysis: {
      id: "analysis-1",
      userId: "user-1",
      sourceId: "source-1",
      sourceName: "model.py",
      sourceMimeType: "text/x-python" as const,
      sourceBytes: 128,
      sourceSha256: "a".repeat(64),
      kind: "pytorch-source" as const,
      status: "ready_for_preview" as const,
      architectureIR: cnnGoldIr(),
      unresolved: [],
      blockingQuestion: null,
      evidenceGraph: {},
      evidenceSummary: {},
      sourceRef: { sourceRecordId: "source-record-1", retentionClass: "analysis_source" as const, sourceSha256: "a".repeat(64), bytes: 128 },
      warnings: [],
      capabilityVersion: "pytorch-static-linear-v0",
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    } as unknown as CreateAnalysisPlanSnapshotRequest["analysis"],
    figureIntent,
    publicationPlan,
    compilerManifest: {
      canonicalization: "RFC-8785-JCS" as const,
      architectureIrHash: digest(cnnGoldIr()),
      figureIntentHash: digest(figureIntent),
      componentCompilerVersion: "composable-dag-v1",
      layoutCompilerVersion: "composable-dag-layout-v1",
      styleTokenVersion: "composable-dag-visual-qa-v1",
      layoutSeed: "seed-1",
    },
    visualQa: runComposableDagVisualQa(built.publicationPlan),
    previewArtifactHashes: [{ panelId: "overview", kind: "svg" as const, sha256: "c".repeat(64) }],
    createdAt: "2026-08-18T00:00:00.000Z",
  };
}

class RecordingStore implements AnalysisPlanSnapshotStore {
  readonly inserted: unknown[] = [];

  async insert(_owner: { tenantId: string; userId: string }, value: unknown) {
    this.inserted.push(value);
    return value as never;
  }

  async get() {
    return null;
  }
}

describe("AnalysisPlanSnapshotService", () => {
  it("reads an already stored legacy Composable-DAG snapshot without compiling a new preview", async () => {
    const store = new InMemoryAnalysisPlanSnapshotStore();
    const service = new AnalysisPlanSnapshotService({ store });
    const request = legacyRequest();
    const legacySnapshot = createAnalysisPlanSnapshot({
      tenantId: request.owner.tenantId,
      userId: request.owner.userId,
      analysisId: request.analysis.id,
      analysisStatus: request.analysis.status,
      architectureIrHash: request.compilerManifest.architectureIrHash,
      figureIntentHash: request.compilerManifest.figureIntentHash,
      publicationPlan: request.publicationPlan,
      compilerManifest: request.compilerManifest,
      visualQa: request.visualQa,
      previewArtifactHashes: request.previewArtifactHashes,
      createdAt: request.createdAt,
    });
    await store.insert(request.owner, legacySnapshot);

    await expect(service.get(request.owner, request.analysis.id, legacySnapshot.snapshotId))
      .resolves.toEqual(legacySnapshot);
  });

  it("rejects new legacy Composable-DAG snapshot creation before storage", async () => {
    const store = new RecordingStore();
    const service = new AnalysisPlanSnapshotService({ store });

    await expect(service.create(legacyRequest())).rejects.toMatchObject({
      code: "ANALYSIS_PLAN_SNAPSHOT_LEGACY_WRITE_RETIRED",
      statusCode: 409,
    });
    expect(store.inserted).toEqual([]);
  });
});
