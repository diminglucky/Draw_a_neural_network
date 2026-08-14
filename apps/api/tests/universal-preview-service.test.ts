import { describe, expect, it } from "vitest";
import { InMemoryPlanSnapshotStore } from "../src/plan-snapshot-store.js";
import { UniversalPreviewService, type UniversalFigureCompiler } from "../src/universal-preview-service.js";

function architecture(unresolved: unknown[] = []) {
  return {
    version: 3,
    graphId: "graph-1",
    inputs: [{ nodeId: "input", portId: "out" }],
    outputs: [{ nodeId: "output", portId: "out" }],
    modules: [],
    nodes: [
      { id: "input", kind: "input", semanticRole: "input", inputPorts: [], outputPorts: [{ id: "out", representation: "vector", semanticType: "data" }], evidenceIds: [] },
      { id: "output", kind: "output", semanticRole: "output", inputPorts: [{ id: "in", representation: "vector", semanticType: "data" }], outputPorts: [{ id: "out", representation: "vector", semanticType: "prediction" }], evidenceIds: [] },
    ],
    edges: [{ id: "edge-1", source: { nodeId: "input", portId: "out" }, target: { nodeId: "output", portId: "in" }, transport: "data", evidenceIds: [] }],
    processes: [], evidenceIndex: {}, unresolved,
  };
}

function compiled(): Awaited<ReturnType<UniversalFigureCompiler["compile"]>> {
  return {
    figureSet: { version: 1, figureSetId: "set-1", draftId: "draft-1", revision: 1, intentHash: "f".repeat(64), panels: [{ panelId: "overview", title: "Overview", primitives: [{ id: "node-input", kind: "shape", semanticIds: ["input"] }] }], crossPanelMappings: [] },
    previewArtifactHashes: [{ panelId: "overview", kind: "svg", sha256: "a".repeat(64) }],
    compilerManifest: { canonicalization: "RFC-8785-JCS", architectureIrHash: "b".repeat(64), figureIntentHash: "f".repeat(64), componentCompilerVersion: "1", layoutCompilerVersion: "1", styleTokenVersion: "1", layoutSeed: "seed" },
    visualQa: { status: "pass", checks: [] },
  };
}

describe("UniversalPreviewService", () => {
  it("returns a watermarked candidate and never compiles or snapshots a blocking structure", async () => {
    const store = new InMemoryPlanSnapshotStore();
    let compiledCount = 0;
    const service = new UniversalPreviewService({
      snapshotStore: store,
      compiler: { compile: async () => { compiledCount += 1; return compiled(); } },
      now: () => "2026-08-14T00:00:00.000Z",
    });

    const preview = await service.preview({
      owner: { tenantId: "tenant-1", userId: "user-1" }, draftId: "draft-1", revision: 1,
      architectureIR: architecture([{ id: "q-merge", severity: "blocking", conflictKey: "merge", candidateValues: ["add", "concat"], evidenceFactIds: [], dependencyQuestionIds: [] }]),
    });

    expect(preview).toMatchObject({ kind: "candidate_structure", watermark: "STRUCTURE_PENDING_CONFIRMATION", blockingQuestion: { id: "q-merge" } });
    expect(compiledCount).toBe(0);
  });

  it("persists and returns the exact immutable snapshot only for a render-ready structure", async () => {
    const store = new InMemoryPlanSnapshotStore();
    const service = new UniversalPreviewService({ snapshotStore: store, compiler: { compile: async () => compiled() }, now: () => "2026-08-14T00:00:00.000Z" });
    const owner = { tenantId: "tenant-1", userId: "user-1" };

    const preview = await service.preview({ owner, draftId: "draft-1", revision: 1, architectureIR: architecture() });

    expect(preview).toMatchObject({ kind: "publication_figure_set", planHash: expect.any(String), previewArtifactHashes: compiled().previewArtifactHashes });
    if (preview.kind !== "publication_figure_set") throw new Error("expected full preview");
    await expect(store.getForRevision(owner, "draft-1", 1, preview.planId)).resolves.toMatchObject({ immutable: true, canonicalPlanBytesSha256: preview.planHash });
  });

  it("refuses to snapshot a full figure when server-side visual QA fails", async () => {
    const service = new UniversalPreviewService({
      snapshotStore: new InMemoryPlanSnapshotStore(),
      compiler: { compile: async () => ({ ...compiled(), visualQa: { status: "fail" as const, checks: [{ id: "overflow", severity: "blocking" as const, passed: false, message: "overflow" }] } }) },
    });
    await expect(service.preview({ owner: { tenantId: "tenant-1", userId: "user-1" }, draftId: "draft-1", revision: 1, architectureIR: architecture() })).rejects.toThrow(/QA|pass/i);
  });
});
