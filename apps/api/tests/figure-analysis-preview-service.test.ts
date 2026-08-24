import { describe, expect, it } from "vitest";
import type { FigureAnalysisRecord } from "../src/figure-analysis.js";
import { buildComposableDagPublicationPlan } from "../src/composable-dag-publication-plan.js";
import { defaultFigureIntent } from "../src/figure-intent.js";
import { PublicationVisualPreviewService } from "../src/publication-visual-preview-service.js";
import { cnnGoldIr } from "./fixtures/figure-component-gold-ir.js";
import {
  FigureAnalysisPreviewServiceImpl,
  type FigureAnalysisPreviewServiceOptions,
  projectPublicComposableDagPublicationPlan,
} from "../src/figure-analysis-preview-service.js";

const blockingQuestion = {
  code: "dynamic-control-flow",
  message: "The analysis requires a control-flow decision before preview.",
  locator: { kind: "code" as const, startLine: 1, startColumn: 1, endLine: 1, endColumn: 8 },
};

function analysisRecord(overrides: Partial<FigureAnalysisRecord> = {}): FigureAnalysisRecord {
  return {
    id: "analysis-ready",
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

function serviceFor(records: FigureAnalysisRecord[], overrides: Omit<FigureAnalysisPreviewServiceOptions, "store"> = {}) {
  const byOwner = new Map(records.map((record) => [`${record.userId}:${record.id}`, record]));
  const service = new FigureAnalysisPreviewServiceImpl({
    store: {
      getFigureAnalysis: async (userId: string, id: string) => byOwner.get(`${userId}:${id}`) ?? null,
    },
    ...overrides,
  });
  return { service };
}

describe("FigureAnalysisPreviewService", () => {
  it("keeps candidate v3 and v4 requests non-authoritative without invoking either preview compiler", async () => {
    const candidate = analysisRecord({
      id: "analysis-candidate",
      status: "candidate_structure",
      blockingQuestion,
      unresolved: [blockingQuestion as never],
    });
    let legacyCalls = 0;
    let pvpCalls = 0;
    const pvp = new PublicationVisualPreviewService();
    const { service } = serviceFor([candidate], {
      compilePublicationPlan: () => {
        legacyCalls += 1;
        throw new Error("legacy compiler must not run for candidate analysis");
      },
      compilePublicationPreview: (input: Parameters<PublicationVisualPreviewService["preview"]>[0]) => {
        pvpCalls += 1;
        return pvp.preview(input);
      },
    });

    const v3 = await service.preview("user-1", "analysis-candidate");
    const v4 = await service.preview("user-1", "analysis-candidate", {
      version: 4,
      deviceId: "device-actual-1",
    });

    expect(v3).toMatchObject({
      version: 3,
      kind: "candidate_structure",
      watermark: "STRUCTURE_PENDING_CONFIRMATION",
      blockingQuestion,
    });
    expect(v4).toMatchObject({
      version: 4,
      kind: "candidate_structure",
      watermark: "STRUCTURE_PENDING_CONFIRMATION",
      blockingQuestion,
    });
    expect({ legacyCalls, pvpCalls }).toEqual({ legacyCalls: 0, pvpCalls: 0 });
  });

  it("retains the established v3 public publication-plan discriminator and legacy fields", async () => {
    const { service } = serviceFor([analysisRecord()]);

    const preview = await service.preview("user-1", "analysis-ready");

    expect(preview).toMatchObject({
      version: 3,
      kind: "publication_plan",
      publicationPlan: { version: 1, graphId: "gold:cnn", compilerVersion: "composable-dag-v1" },
      visualQa: { status: "pass" },
    });
    expect(JSON.stringify(preview)).not.toMatch(/evidenceIndex|sourceSha256|sourceRecordId|excerptDigest|locator/);
  });

  it("routes v4 through the injected UGS/GPG/PVP compiler seam with authenticated identity and no legacy compiler", async () => {
    let legacyCalls = 0;
    const pvpInputs: Parameters<PublicationVisualPreviewService["preview"]>[0][] = [];
    const pvp = new PublicationVisualPreviewService();
    const { service } = serviceFor([analysisRecord()], {
      compilePublicationPlan: () => {
        legacyCalls += 1;
        throw new Error("legacy compiler must not run for v4");
      },
      compilePublicationPreview: (input: Parameters<PublicationVisualPreviewService["preview"]>[0]) => {
        pvpInputs.push(structuredClone(input));
        return pvp.preview(input);
      },
    });

    const preview = await service.preview("user-1", "analysis-ready", {
      version: 4,
      deviceId: "device-actual-1",
    });

    expect(preview).toMatchObject({
      version: 4,
      kind: "publication_visual_preview",
      publicationPreview: {
        schemaVersion: 1,
        plan: { identity: { planId: "pvp:analysis:analysis-ready:architecture", canonicalHash: expect.stringMatching(/^[a-f0-9]{64}$/) } },
        graph: { graphId: "analysis:analysis-ready", detail: "architecture" },
      },
    });
    expect(legacyCalls).toBe(0);
    expect(pvpInputs).toEqual([expect.objectContaining({
      ugs: expect.objectContaining({ graphId: "analysis:analysis-ready" }),
      detail: "architecture",
      updateIdentity: {
        ownerId: "user-1",
        deviceId: "device-actual-1",
        workflowId: "figure-analysis:analysis-ready",
        documentId: "analysis:analysis-ready",
        pageId: "pvp-preview",
        expectedRevision: 1,
      },
    })]);
  });

  it("uses one safe not-found result for missing and foreign analyses", async () => {
    const { service } = serviceFor([analysisRecord()]);

    const missing = service.preview("user-1", "missing");
    const foreign = service.preview("other-user", "analysis-ready");

    await expect(missing).rejects.toThrow(/not found/i);
    await expect(foreign).rejects.toThrow(/not found/i);
  });

  it("rejects a ready record that still contains blocking unresolved IR", async () => {
    const record = analysisRecord({
      architectureIR: { ...cnnGoldIr(), unresolved: [blockingQuestion as never] },
    });
    const { service } = serviceFor([record]);

    await expect(service.preview("user-1", "analysis-ready")).rejects.toThrow(/preview/i);
  });

  it("returns deterministic, caller-isolated ready projections", async () => {
    const { service } = serviceFor([analysisRecord()]);

    const first = await service.preview("user-1", "analysis-ready");
    const second = await service.preview("user-1", "analysis-ready");

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    if (first.kind === "publication_visual_preview") first.publicationPreview.plan.primitives[0]!.primitiveId = "changed";
    const third = await service.preview("user-1", "analysis-ready");
    expect(JSON.stringify(third)).toBe(JSON.stringify(second));
    expect(defaultFigureIntent().version).toBe(1);
  });

  it("projects only allowlisted component and connection fields from an injected compiler seam", () => {
    const built = buildComposableDagPublicationPlan({
      architectureIr: cnnGoldIr(),
      intent: defaultFigureIntent(),
      layoutSeed: "projection-test",
    });
    if (built.status !== "ready") throw new Error("test fixture must produce a publication plan");
    const unsafePlan = structuredClone(built.publicationPlan);
    Object.assign(unsafePlan.dagPlan.components[0] as unknown as Record<string, unknown>, {
      workerPath: "C:\\private\\worker.exe",
      source: "raw source bytes",
      evidenceLocator: "private:1",
      shellCommand: "powershell -Command Invoke-WebRequest",
    });
    Object.assign(unsafePlan.dagPlan.connections[0] as unknown as Record<string, unknown>, {
      workerPath: "C:\\private\\worker.exe",
      sourcePayload: "raw source bytes",
      evidenceLocator: "private:2",
      shellCommand: "cmd /c whoami",
    });

    const projected = projectPublicComposableDagPublicationPlan(unsafePlan);

    expect(projected.components[0]).not.toHaveProperty("workerPath");
    expect(projected.components[0]).not.toHaveProperty("source");
    expect(projected.components[0]).not.toHaveProperty("evidenceLocator");
    expect(projected.components[0]).not.toHaveProperty("shellCommand");
    expect(projected.connections[0]).not.toHaveProperty("workerPath");
    expect(projected.connections[0]).not.toHaveProperty("sourcePayload");
    expect(projected.connections[0]).not.toHaveProperty("evidenceLocator");
    expect(projected.connections[0]).not.toHaveProperty("shellCommand");
  });

  it("recursively reconstructs nested public plan values", () => {
    const built = buildComposableDagPublicationPlan({
      architectureIr: cnnGoldIr(),
      intent: defaultFigureIntent(),
      layoutSeed: "projection-test",
    });
    if (built.status !== "ready") throw new Error("test fixture must produce a publication plan");
    const unsafePlan = structuredClone(built.publicationPlan);
    const component = unsafePlan.dagPlan.components.find((item) => item.inputPorts.length > 0)!;
    const connection = unsafePlan.dagPlan.connections[0]!;
    Object.assign(component.bounds as unknown as Record<string, unknown>, { workerPath: "C:\\private\\worker.exe" });
    Object.assign(component.inputPorts[0] as unknown as Record<string, unknown>, { rawSource: "return model output" });
    Object.assign(connection.source as unknown as Record<string, unknown>, { evidenceLocator: "private:1" });
    Object.assign(connection.route[0] as unknown as Record<string, unknown>, { shellCommand: "whoami" });

    const projected = projectPublicComposableDagPublicationPlan(unsafePlan);

    expect(projected.components.find((item) => item.id === component.id)!.bounds).not.toHaveProperty("workerPath");
    expect(projected.components.find((item) => item.id === component.id)!.inputPorts[0]).not.toHaveProperty("rawSource");
    expect(projected.connections[0]!.source).not.toHaveProperty("evidenceLocator");
    expect(projected.connections[0]!.route[0]).not.toHaveProperty("shellCommand");
  });

  it("rejects a compiler result with a missing required style branch through the preview boundary", () => {
    const built = buildComposableDagPublicationPlan({
      architectureIr: cnnGoldIr(),
      intent: defaultFigureIntent(),
      layoutSeed: "projection-test",
    });
    if (built.status !== "ready") throw new Error("test fixture must produce a publication plan");
    delete built.publicationPlan.visualSpec.componentStyles.terminal;

    expect(() => projectPublicComposableDagPublicationPlan(built.publicationPlan)).toThrow(/safe preview/i);
  });
});
