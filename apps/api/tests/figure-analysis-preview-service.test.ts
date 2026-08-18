import { describe, expect, it } from "vitest";
import type { FigureAnalysisRecord } from "../src/figure-analysis.js";
import { buildComposableDagPublicationPlan } from "../src/composable-dag-publication-plan.js";
import { runComposableDagVisualQa } from "../src/composable-dag-visual-qa.js";
import { defaultFigureIntent } from "../src/figure-intent.js";
import { cnnGoldIr } from "./fixtures/figure-component-gold-ir.js";
import {
  FigureAnalysisPreviewServiceImpl,
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

function serviceFor(records: FigureAnalysisRecord[]) {
  const byOwner = new Map(records.map((record) => [`${record.userId}:${record.id}`, record]));
  let compileCalls = 0;
  let qaCalls = 0;
  const service = new FigureAnalysisPreviewServiceImpl({
    store: {
      getFigureAnalysis: async (userId, id) => byOwner.get(`${userId}:${id}`) ?? null,
    },
    compilePublicationPlan: (input) => {
      compileCalls += 1;
      return buildComposableDagPublicationPlan(input);
    },
    runVisualQa: (plan) => {
      qaCalls += 1;
      return runComposableDagVisualQa(plan);
    },
  });
  return { service, calls: () => ({ compileCalls, qaCalls }) };
}

describe("FigureAnalysisPreviewService", () => {
  it("returns a watermarked candidate without compiling or running QA", async () => {
    const candidate = analysisRecord({
      id: "analysis-candidate",
      status: "candidate_structure",
      blockingQuestion,
      unresolved: [blockingQuestion as never],
    });
    const { service, calls } = serviceFor([candidate]);

    const preview = await service.preview("user-1", "analysis-candidate");

    expect(preview).toMatchObject({
      version: 3,
      kind: "candidate_structure",
      watermark: "STRUCTURE_PENDING_CONFIRMATION",
      blockingQuestion,
    });
    expect(calls()).toEqual({ compileCalls: 0, qaCalls: 0 });
  });

  it("compiles a ready analysis through the v3 publication and QA boundaries", async () => {
    const { service, calls } = serviceFor([analysisRecord()]);

    const preview = await service.preview("user-1", "analysis-ready");

    expect(preview).toMatchObject({ version: 3, kind: "publication_plan", visualQa: { status: "pass" } });
    expect(calls()).toEqual({ compileCalls: 1, qaCalls: 1 });
    expect(JSON.stringify(preview)).not.toMatch(/evidenceIndex|sourceSha256|sourceRecordId|excerptDigest|locator/);
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
    const { service, calls } = serviceFor([record]);

    await expect(service.preview("user-1", "analysis-ready")).rejects.toThrow(/preview/i);
    expect(calls()).toEqual({ compileCalls: 0, qaCalls: 0 });
  });

  it("returns deterministic, caller-isolated ready projections", async () => {
    const { service } = serviceFor([analysisRecord()]);

    const first = await service.preview("user-1", "analysis-ready");
    const second = await service.preview("user-1", "analysis-ready");

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    if (first.kind === "publication_plan") first.publicationPlan.components[0]!.id = "changed";
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
});
