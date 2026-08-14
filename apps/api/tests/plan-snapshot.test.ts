import { describe, expect, it } from "vitest";
import { createPlanSnapshot, type CreatePlanSnapshotInput } from "../src/plan-snapshot.js";

function snapshotInput(overrides: Record<string, unknown> = {}): CreatePlanSnapshotInput {
  return {
    draftId: "draft-1",
    revision: 2,
    figureSet: {
      version: 1,
      figureSetId: "figure-set-1",
      draftId: "draft-1",
      revision: 2,
      intentHash: "f".repeat(64),
      panels: [{ panelId: "overview", title: "Overview", primitives: [{ id: "node-1", kind: "shape", semanticIds: ["node-1"] }] }],
      crossPanelMappings: [],
    },
    previewArtifactHashes: [{ panelId: "overview", kind: "svg", sha256: "a".repeat(64) }],
    compilerManifest: {
      canonicalization: "RFC-8785-JCS",
      architectureIrHash: "b".repeat(64),
      figureIntentHash: "f".repeat(64),
      componentCompilerVersion: "1.0.0",
      layoutCompilerVersion: "1.0.0",
      styleTokenVersion: "1.0.0",
      layoutSeed: "seed-1",
    },
    visualQa: { status: "pass", checks: [{ id: "fit", severity: "blocking", passed: true, message: "fits page" }] },
    createdAt: "2026-08-14T00:00:00.000Z",
    ...overrides,
  } as CreatePlanSnapshotInput;
}

describe("PlanSnapshot", () => {
  it("produces the same immutable identity when object keys are ordered differently", () => {
    const first = createPlanSnapshot(snapshotInput());
    const second = createPlanSnapshot(snapshotInput({
      figureSet: {
        revision: 2, panels: [{ primitives: [{ semanticIds: ["node-1"], kind: "shape", id: "node-1" }], title: "Overview", panelId: "overview" }],
        crossPanelMappings: [], intentHash: "f".repeat(64), draftId: "draft-1", figureSetId: "figure-set-1", version: 1,
      },
    }));
    expect(second.canonicalPlanBytesSha256).toBe(first.canonicalPlanBytesSha256);
    expect(second.planId).toBe(first.planId);
    expect(second.immutable).toBe(true);
  });

  it("changes snapshot identity when its viewed preview or compiler manifest changes", () => {
    const original = createPlanSnapshot(snapshotInput());
    const changedPreview = createPlanSnapshot(snapshotInput({ previewArtifactHashes: [{ panelId: "overview", kind: "svg", sha256: "c".repeat(64) }] }));
    const changedCompiler = createPlanSnapshot(snapshotInput({ compilerManifest: { ...snapshotInput().compilerManifest, layoutCompilerVersion: "1.1.0" } }));
    expect(changedPreview.planId).not.toBe(original.planId);
    expect(changedCompiler.planId).not.toBe(original.planId);
  });

  it("rejects a non-passing QA result and inconsistent panel/artifact mappings", () => {
    expect(() => createPlanSnapshot(snapshotInput({ visualQa: { status: "fail", checks: [] } }))).toThrow(/QA|pass/i);
    expect(() => createPlanSnapshot(snapshotInput({ previewArtifactHashes: [{ panelId: "missing", kind: "svg", sha256: "a".repeat(64) }] }))).toThrow(/panel|artifact/i);
    expect(() => createPlanSnapshot(snapshotInput({ figureSet: { ...snapshotInput().figureSet, panels: [snapshotInput().figureSet.panels[0], { ...snapshotInput().figureSet.panels[0] }] } }))).toThrow(/unique|panel/i);
  });
});
