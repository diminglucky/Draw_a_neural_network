import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { FigureAnalysisRecord } from "../src/figure-analysis.js";
import { canonicalJson } from "../src/analysis-plan-snapshot.js";
import {
  AnalysisPlanSnapshotError,
  AnalysisPlanSnapshotService,
  type AnalysisPlanSnapshotStore,
} from "../src/analysis-plan-snapshot-service.js";
import { buildComposableDagPublicationPlan } from "../src/composable-dag-publication-plan.js";
import {
  FigureAnalysisPreviewServiceImpl,
  type PublicComposableDagPublicationPlan,
} from "../src/figure-analysis-preview-service.js";
import { defaultFigureIntent } from "../src/figure-intent.js";
import { runComposableDagVisualQa } from "../src/composable-dag-visual-qa.js";
import { cnnGoldIr } from "./fixtures/figure-component-gold-ir.js";

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function analysis(overrides: Partial<FigureAnalysisRecord> = {}): FigureAnalysisRecord {
  return {
    id: "analysis-1",
    userId: "user-1",
    sourceId: "source-1",
    sourceName: "model.py",
    sourceMimeType: "text/x-python",
    sourceBytes: 128,
    sourceSha256: "a".repeat(64),
    kind: "pytorch-source",
    status: "ready_for_preview",
    architectureIR: cnnGoldIr(),
    unresolved: [],
    blockingQuestion: null,
    evidenceGraph: {} as FigureAnalysisRecord["evidenceGraph"],
    evidenceSummary: {} as FigureAnalysisRecord["evidenceSummary"],
    sourceRef: { sourceRecordId: "source-record-1", retentionClass: "analysis_source", sourceSha256: "a".repeat(64), bytes: 128 },
    warnings: [],
    capabilityVersion: "pytorch-static-linear-v0",
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

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

function visualQa() {
  const built = buildComposableDagPublicationPlan({ architectureIr: cnnGoldIr(), intent: defaultFigureIntent(), layoutSeed: "seed-1" });
  if (built.status !== "ready") throw new Error("test fixture must produce visual QA input");
  return runComposableDagVisualQa(built.publicationPlan);
}

class RecordingStore implements AnalysisPlanSnapshotStore {
  readonly inserted: unknown[] = [];

  async insert(owner: { tenantId: string; userId: string }, value: unknown) {
    this.inserted.push({ owner, value });
    return value as never;
  }

  async get() {
    return null;
  }
}

function request(overrides: Record<string, unknown> = {}) {
  const record = analysis();
  const figureIntent = defaultFigureIntent();
  return {
    owner: { tenantId: "tenant-1", userId: "user-1" },
    analysis: record,
    figureIntent,
    publicationPlan: publicationPlan(),
    compilerManifest: {
      canonicalization: "RFC-8785-JCS" as const,
      architectureIrHash: digest(record.architectureIR),
      figureIntentHash: digest(figureIntent),
      componentCompilerVersion: "composable-dag-v1",
      layoutCompilerVersion: "composable-dag-layout-v1",
      styleTokenVersion: "composable-dag-visual-qa-v1",
      layoutSeed: "seed-1",
    },
    visualQa: visualQa(),
    previewArtifactHashes: [{ panelId: "overview", kind: "svg" as const, sha256: "c".repeat(64) }],
    createdAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("AnalysisPlanSnapshotService", () => {
  it("returns a stable typed code when an analysis is not ready for an immutable snapshot", async () => {
    const service = new AnalysisPlanSnapshotService({ store: new RecordingStore() });

    await expect(service.create(request({ analysis: analysis({ status: "candidate_structure" }) })))
      .rejects.toBeInstanceOf(AnalysisPlanSnapshotError);
    await expect(service.create(request({ analysis: analysis({ status: "candidate_structure" }) })))
      .rejects.toMatchObject({ code: "ANALYSIS_PLAN_SNAPSHOT_NOT_READY", statusCode: 409 });
  });

  it("never calls storage for candidate, failed, invalid IR, or failed blocking QA analysis", async () => {
    const store = new RecordingStore();
    const service = new AnalysisPlanSnapshotService({ store });

    await expect(service.create(request({ analysis: analysis({ status: "candidate_structure" }) }))).rejects.toThrow(/ready|candidate/i);
    await expect(service.create(request({ analysis: analysis({ status: "needs_confirmation" }) }))).rejects.toThrow(/ready|confirmation/i);
    await expect(service.create(request({ analysis: analysis({ status: "failed" }) }))).rejects.toThrow(/ready|failed/i);
    await expect(service.create(request({ analysis: analysis({ architectureIR: null }) }))).rejects.toThrow(/IR|architecture/i);
    await expect(service.create(request({ analysis: analysis({ architectureIR: {
      ...cnnGoldIr(),
      unresolved: [{ id: "question-1", severity: "blocking", conflictKey: "dynamic branch", candidateValues: ["left", "right"], evidenceFactIds: [], dependencyQuestionIds: [] }],
    } }) }))).rejects.toThrow(/render-ready|IR/i);
    await expect(service.create(request({ visualQa: { status: "pass", checks: [{ id: "bounds", severity: "blocking", passed: false, message: "overflow" }] } }))).rejects.toMatchObject({ code: "ANALYSIS_PLAN_SNAPSHOT_INVALID", statusCode: 400 });
    expect(store.inserted).toHaveLength(0);
  });

  it("binds the validated record owner and canonical architecture identity before one immutable insert", async () => {
    const store = new RecordingStore();
    const service = new AnalysisPlanSnapshotService({ store });
    const result = await service.create(request());

    expect(store.inserted).toHaveLength(1);
    expect(result).toMatchObject({ tenantId: "tenant-1", userId: "user-1", analysisId: "analysis-1", architectureIrHash: digest(analysis().architectureIR), immutable: true });
    expect(JSON.stringify(result)).not.toMatch(/sourceBytes|sourceSha256|sourceRecordId|provider|locator|worker|path|command/i);
  });

  it("accepts the public publication plan returned by FigureAnalysisPreviewService and rejects attached raw source", async () => {
    const record = analysis();
    const previewService = new FigureAnalysisPreviewServiceImpl({
      store: { getFigureAnalysis: async (userId, id) => userId === record.userId && id === record.id ? record : null },
    });
    const preview = await previewService.preview(record.userId, record.id);
    if (preview.kind !== "publication_plan") throw new Error("test fixture must produce a public publication plan");

    const store = new RecordingStore();
    const service = new AnalysisPlanSnapshotService({ store });
    await expect(service.create(request({
      publicationPlan: preview.publicationPlan,
      visualQa: preview.visualQa,
      compilerManifest: { ...request().compilerManifest, layoutSeed: "m2-4-analysis-1" },
    }))).resolves.toMatchObject({ immutable: true });
    await expect(service.create(request({
      publicationPlan: { ...preview.publicationPlan, source: "raw model source" },
    }))).rejects.toMatchObject({ code: "ANALYSIS_PLAN_SNAPSHOT_INVALID", statusCode: 400 });
    expect(store.inserted).toHaveLength(1);
  });

  it("rejects a separately valid plan or QA that was not compiled from this analysis, intent, and manifest seed", async () => {
    const store = new RecordingStore();
    const service = new AnalysisPlanSnapshotService({ store });
    const changedIntent = { ...defaultFigureIntent(), density: "compact" as const };

    await expect(service.create(request({
      figureIntent: changedIntent,
      compilerManifest: { ...request().compilerManifest, figureIntentHash: digest(changedIntent) },
    }))).rejects.toMatchObject({ code: "ANALYSIS_PLAN_SNAPSHOT_INVALID", statusCode: 400 });
    await expect(service.create(request({
      visualQa: { status: "pass", checks: [{ id: "other-proof", severity: "blocking", passed: true, message: "detached" }] },
    }))).rejects.toMatchObject({ code: "ANALYSIS_PLAN_SNAPSHOT_INVALID", statusCode: 400 });
    expect(store.inserted).toHaveLength(0);
  });

  it("rejects an owner that does not match the analysis owner", async () => {
    const store = new RecordingStore();
    const service = new AnalysisPlanSnapshotService({ store });

    await expect(service.create(request({ owner: { tenantId: "tenant-1", userId: "other-user" } }))).rejects.toThrow(/owner/i);
    expect(store.inserted).toHaveLength(0);
  });
});
