import { describe, expect, it } from "vitest";
import type { FigureAnalysisResult } from "../src/publication-figure-agent.js";
import { InMemoryFoundationStore } from "../src/store.js";

async function loadServiceModule() {
  return import("../src/figure-draft-service.js");
}

function analysis(): FigureAnalysisResult {
  return {
    status: "needs_confirmation" as const,
    taskIntent: {
      action: "analyze_network" as const,
      sourceMode: "code" as const,
      requestedArtifact: "structure_only" as const,
      referencesDraftId: null,
      userConstraints: { orientation: "auto" as const, density: "standard" as const, printMode: "auto" as const, requiresNativeVisio: false },
    },
    evidence: [{
      id: "fact-merge",
      subject: "merge",
      predicate: "operation",
      value: "two branches join",
      confidence: 0.5,
      source: { sourceId: "source-text-1", kind: "text" as const, name: "User request" },
    }],
    canonicalNetworkIR: {
      version: 2 as const,
      figure: { id: "figure-1", title: "Residual block", description: null },
      tensors: [{ id: "activation-1", name: "activation", shape: [1], axes: ["batch"], semanticRole: "activation" as const, dtype: null, producerNodeId: "input", consumerNodeIds: ["output"] }],
      nodes: [
        { id: "input", op: "input", inputTensorIds: [], outputTensorIds: ["activation-1"], confidence: 0.9, sourceEvidenceIds: ["fact-merge"], repeats: null },
        { id: "output", op: "output", inputTensorIds: ["activation-1"], outputTensorIds: [], confidence: 0.9, sourceEvidenceIds: ["fact-merge"], repeats: null },
      ],
      edges: [{ id: "edge-input-output", sourceNodeId: "input", targetNodeId: "output", relation: "data" as const, tensorIds: ["activation-1"], confidence: 0.9, evidenceIds: ["fact-merge"] }],
      groups: [],
      unresolved: [],
    },
    blockingQuestions: [{ id: "merge-kind", question: "Is this merge Add or Concat?", candidateValues: ["add", "concat"] }],
    warnings: ["Merge semantics require confirmation."],
    readyForVisio: false as const,
  };
}

describe("FigureDraftService", () => {
  it("creates revision 1 from the public analysis boundary without persisting extra analysis fields", async () => {
    const { FigureDraftService } = await loadServiceModule();
    const store = new InMemoryFoundationStore();
    const service = new FigureDraftService({
      store,
      createDraftId: () => "draft-1",
      now: () => "2026-08-14T08:00:00.000Z",
    });
    const unsafeAnalysis = { ...analysis(), providerApiKey: "sk-must-not-persist", requestHeaders: { authorization: "Bearer no" } };

    const created = await service.createFromAnalysis("user-1", "conversation-1", unsafeAnalysis);

    expect(created.draft).toMatchObject({ id: "draft-1", userId: "user-1", conversationId: "conversation-1", status: "needs_confirmation", currentRevision: 1 });
    expect(created.revision).toMatchObject({ draftId: "draft-1", revision: 1, status: "needs_confirmation" });
    expect(JSON.stringify(created.revision.payload)).not.toContain("sk-must-not-persist");
    expect(JSON.stringify(created.revision.payload)).not.toContain("requestHeaders");
    expect((created.revision.payload as { readyForVisio: boolean }).readyForVisio).toBe(false);
  });

  it("persists a validated universal graph spec derived only from the canonical revision IR", async () => {
    const { FigureDraftService } = await loadServiceModule();
    const service = new FigureDraftService({
      store: new InMemoryFoundationStore(),
      createDraftId: () => "draft-ugs",
      now: () => "2026-08-14T08:00:00.000Z",
    });

    const created = await service.createFromAnalysis("user-1", "conversation-1", analysis());
    const payload = created.revision.payload as typeof created.revision.payload & { universalGraphSpec?: unknown };

    expect(payload.universalGraphSpec).toMatchObject({ version: 1, graphId: "figure-1", revision: 1 });
    expect(JSON.stringify(payload.universalGraphSpec)).not.toMatch(/(?:[A-Za-z]:[\\/]|\\\\|\/)/);
    expect(payload.universalGraphSpec).toMatchObject({
      evidence: [{
        evidenceId: "fact-merge",
        sourceId: "architecture-v3",
        locator: "architecture-v3:fact-merge",
      }],
    });
  });

  it("rejects a persisted UGS whose evidence locator could disclose a source path", async () => {
    const { parseFigureDraftRevisionPayload } = await import("../src/figure-draft-payload.js");
    const { adaptCanonicalNetworkIRv2 } = await import("../src/network-ir-v2-to-v3.js");
    const { projectArchitectureIrV3ToUniversalGraphSpec } = await import("../src/universal-graph-spec-adapter.js");
    const { status: _status, ...payload } = analysis();
    const universalGraphSpec = structuredClone(projectArchitectureIrV3ToUniversalGraphSpec(
      adaptCanonicalNetworkIRv2(payload.canonicalNetworkIR),
    ));
    universalGraphSpec.evidence[0]!.locator = "C:\\private\\model.py";

    expect(() => parseFigureDraftRevisionPayload({ ...payload, universalGraphSpec })).toThrow(/invalid or contains forbidden/i);
  });

  it("resolves the single permitted candidate by appending revision 2 while revision 1 remains byte-equivalent", async () => {
    const { FigureDraftService } = await loadServiceModule();
    const store = new InMemoryFoundationStore();
    const service = new FigureDraftService({
      store,
      createDraftId: () => "draft-1",
      now: () => "2026-08-14T08:00:00.000Z",
    });
    const created = await service.createFromAnalysis("user-1", "conversation-1", analysis());
    const before = JSON.stringify(created.revision.payload);

    const confirmed = await service.confirm("user-1", "draft-1", 1, { questionId: "merge-kind", value: "concat" });

    expect(confirmed).toMatchObject({ conflict: false, draft: { currentRevision: 2, status: "ready_for_preview" }, revision: { revision: 2, status: "ready_for_preview" } });
    expect((confirmed.revision?.payload as { blockingQuestions: unknown[] }).blockingQuestions).toEqual([]);
    expect((confirmed.revision?.payload as { resolvedConfirmations: unknown[] }).resolvedConfirmations).toEqual([
      { questionId: "merge-kind", value: "concat" },
    ]);
    expect(confirmed.revision?.payload).not.toHaveProperty("status");
    expect(JSON.stringify((await store.getFigureDraftRevision("user-1", "draft-1", 1))?.payload)).toBe(before);
  });

  it("reads one owner-scoped historical revision without replacing the current draft revision", async () => {
    const { FigureDraftService } = await loadServiceModule();
    const store = new InMemoryFoundationStore();
    const service = new FigureDraftService({
      store,
      createDraftId: () => "draft-history",
      now: () => "2026-08-14T08:00:00.000Z",
    });
    await service.createFromAnalysis("user-1", "conversation-1", analysis());
    await service.confirm("user-1", "draft-history", 1, { questionId: "merge-kind", value: "add" });

    await expect(service.getRevision("user-1", "draft-history", 1)).resolves.toMatchObject({
      draft: { currentRevision: 2 },
      revision: { revision: 1, status: "needs_confirmation" },
    });
    await expect(service.getRevision("user-2", "draft-history", 1)).resolves.toBeNull();
  });

  it("persists different safe confirmation records for add and concat", async () => {
    const { FigureDraftService } = await loadServiceModule();
    const createConfirmedPayload = async (value: "add" | "concat") => {
      const store = new InMemoryFoundationStore();
      const service = new FigureDraftService({
        store,
        createDraftId: () => `draft-${value}`,
        now: () => "2026-08-14T08:00:00.000Z",
      });
      await service.createFromAnalysis("user-1", "conversation-1", analysis());
      const result = await service.confirm("user-1", `draft-${value}`, 1, { questionId: "merge-kind", value });
      return result.revision?.payload;
    };

    await expect(createConfirmedPayload("add")).resolves.toMatchObject({
      resolvedConfirmations: [{ questionId: "merge-kind", value: "add" }],
    });
    await expect(createConfirmedPayload("concat")).resolves.toMatchObject({
      resolvedConfirmations: [{ questionId: "merge-kind", value: "concat" }],
    });
  });

  it("rejects an answer outside the blocking question candidates and reports a stale confirmation as a CAS conflict", async () => {
    const { FigureDraftService } = await loadServiceModule();
    const store = new InMemoryFoundationStore();
    const service = new FigureDraftService({
      store,
      createDraftId: () => "draft-1",
      now: () => "2026-08-14T08:00:00.000Z",
    });
    await service.createFromAnalysis("user-1", "conversation-1", analysis());

    await expect(service.confirm("user-1", "draft-1", 1, { questionId: "merge-kind", value: "residual" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await service.confirm("user-1", "draft-1", 1, { questionId: "merge-kind", value: "add" });
    await expect(service.confirm("user-1", "draft-1", 1, { questionId: "merge-kind", value: "add" })).resolves.toMatchObject({ conflict: true, draft: null, revision: null });
  });

  it.each([
    ["null", null],
    ["missing fields", {}],
    ["non-string questionId", { questionId: 1, value: "add" }],
    ["non-string value", { questionId: "merge-kind", value: null }],
    ["unknown fields", { questionId: "merge-kind", value: "add", headers: { authorization: "Bearer secret" } }],
  ])("rejects a %s confirmation as VALIDATION_FAILED 400", async (_label, answer) => {
    const { FigureDraftService } = await loadServiceModule();
    const store = new InMemoryFoundationStore();
    const service = new FigureDraftService({
      store,
      createDraftId: () => "draft-1",
      now: () => "2026-08-14T08:00:00.000Z",
    });
    await service.createFromAnalysis("user-1", "conversation-1", analysis());

    await expect(service.confirm("user-1", "draft-1", 1, answer as never)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      statusCode: 400,
    });
    await expect(store.getFigureDraft("user-1", "draft-1")).resolves.toMatchObject({ currentRevision: 1 });
  });

  it.each([
    ["nested taskIntent secret", (value: FigureAnalysisResult) => ({
      ...value,
      taskIntent: {
        ...value.taskIntent,
        userConstraints: { ...value.taskIntent.userConstraints, providerApiKey: "sk-secret" },
      },
    })],
    ["unsafe warning", (value: FigureAnalysisResult) => ({ ...value, warnings: ["authorization: Bearer secret"] })],
    ["Visio command in question", (value: FigureAnalysisResult) => ({
      ...value,
      blockingQuestions: [{
        ...value.blockingQuestions[0]!,
        question: "Run CreateObject('Visio.Application')?",
      }],
    })],
  ])("rejects %s before creating a draft", async (_label, mutate) => {
    const { FigureDraftService } = await loadServiceModule();
    const store = new InMemoryFoundationStore();
    const service = new FigureDraftService({
      store,
      createDraftId: () => "draft-unsafe",
      now: () => "2026-08-14T08:00:00.000Z",
    });

    await expect(service.createFromAnalysis("user-1", "conversation-1", mutate(analysis()) as FigureAnalysisResult)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      statusCode: 400,
    });
    await expect(store.getFigureDraft("user-1", "draft-unsafe")).resolves.toBeNull();
  });
});
