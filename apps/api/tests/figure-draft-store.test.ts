import { describe, expect, it } from "vitest";
import type { FigureDraftRevisionPayload } from "../src/figure-draft-payload.js";
import { InMemoryFoundationStore } from "../src/store.js";

function safeRevisionPayload(): FigureDraftRevisionPayload {
  return {
    taskIntent: {
      action: "analyze_network",
      sourceMode: "code",
      requestedArtifact: "structure_only",
      referencesDraftId: null,
      userConstraints: {
        orientation: "auto",
        density: "standard",
        printMode: "auto",
        requiresNativeVisio: false,
      },
    },
    evidence: [{
      id: "fact-input",
      subject: "input",
      predicate: "declares",
      value: "input tensor",
      confidence: 0.9,
      source: { sourceId: "source-1", kind: "code", name: "model.py" },
    }],
    canonicalNetworkIR: {
      version: 2,
      figure: { id: "figure-1", title: "CNN", description: null },
      tensors: [],
      nodes: [{
        id: "input",
        op: "input",
        inputTensorIds: [],
        outputTensorIds: [],
        confidence: 0.9,
        sourceEvidenceIds: ["fact-input"],
        repeats: null,
      }],
      edges: [],
      groups: [],
      unresolved: [],
    },
    blockingQuestions: [],
    resolvedConfirmations: [],
    warnings: [],
    readyForVisio: false,
  };
}

describe("figure draft store", () => {
  it("creates an immutable first revision, isolates owners, and rejects a stale append", async () => {
    const store = new InMemoryFoundationStore();
    const revisionPayload = safeRevisionPayload();
    const created = await store.createFigureDraft({ id: "draft-1", userId: "user-1", conversationId: "conv-1", status: "ready_for_preview", createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" }, revisionPayload);
    expect(created.revision.revision).toBe(1);
    expect(await store.getFigureDraft("user-2", "draft-1")).toBeNull();
    expect(await store.getFigureDraftRevision("user-2", "draft-1", 1)).toBeNull();
    const appended = await store.appendFigureDraftRevision({ userId: "user-1", draftId: "draft-1", expectedRevision: 1, status: "needs_confirmation", payload: { ...revisionPayload, blockingQuestions: [{ id: "merge", question: "Add or Concat?", candidateValues: ["add", "concat"] }] }, createdAt: "2026-08-14T00:01:00.000Z" });
    expect(appended.conflict).toBe(false);
    expect(appended.revision?.revision).toBe(2);
    expect((await store.getFigureDraftRevision("user-1", "draft-1", 1))?.payload).toEqual(revisionPayload);
    await expect(store.appendFigureDraftRevision({ userId: "user-1", draftId: "draft-1", expectedRevision: 1, status: "ready_for_preview", payload: revisionPayload, createdAt: "2026-08-14T00:02:00.000Z" })).resolves.toMatchObject({ conflict: true, revision: null });
  });

  it.each([
    ["provider API key", { providerApiKey: "sk-secret" }],
    ["authorization header", { authorization: "Bearer secret" }],
    ["request headers", { headers: { authorization: "Bearer secret" } }],
    ["raw attachment bytes", { rawAttachmentBytes: "AAECAwQ=" }],
    ["evidence locator", { evidence: safeRevisionPayload().evidence.map((fact) => ({ ...fact, source: { ...fact.source, locator: "model.py:99" } })) }],
    ["evidence excerpt", { evidence: safeRevisionPayload().evidence.map((fact) => ({ ...fact, source: { ...fact.source, excerpt: "secret source" } })) }],
    ["FigurePlan", { figurePlan: { version: 1 } }],
    ["coordinates", { coordinates: { x: 10, y: 20 } }],
    ["primitives", { primitives: [{ id: "shape-1" }] }],
    ["output path", { outputPath: "C:\\secret\\figure.vsdx" }],
    ["Visio command", { visioCommand: "CreateObject('Visio.Application')" }],
    ["arbitrary resolved fields", { resolvedConfirmations: [{ questionId: "merge", value: "add", reason: "model said so" }] }],
    ["oversized canonical text", {
      canonicalNetworkIR: {
        ...safeRevisionPayload().canonicalNetworkIR,
        figure: { ...safeRevisionPayload().canonicalNetworkIR.figure, title: "x".repeat(1_000_001) },
      },
    }],
  ])("rejects a direct Store write containing %s without creating state", async (_label, forbidden) => {
    const store = new InMemoryFoundationStore();
    const payload = { ...safeRevisionPayload(), ...forbidden };

    await expect(store.createFigureDraft({
      id: "draft-unsafe",
      userId: "user-1",
      conversationId: "conv-1",
      status: "ready_for_preview",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    }, payload as FigureDraftRevisionPayload)).rejects.toThrow(/payload|forbidden|unrecognized|invalid/i);

    await expect(store.getFigureDraft("user-1", "draft-unsafe")).resolves.toBeNull();
    await expect(store.getFigureDraftRevision("user-1", "draft-unsafe", 1)).resolves.toBeNull();
  });

  it("rejects an unsafe append before advancing the current revision", async () => {
    const store = new InMemoryFoundationStore();
    await store.createFigureDraft({
      id: "draft-1",
      userId: "user-1",
      conversationId: "conv-1",
      status: "ready_for_preview",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    }, safeRevisionPayload());

    await expect(store.appendFigureDraftRevision({
      userId: "user-1",
      draftId: "draft-1",
      expectedRevision: 1,
      status: "ready_for_preview",
      payload: { ...safeRevisionPayload(), figurePlan: { version: 1 } } as unknown as FigureDraftRevisionPayload,
      createdAt: "2026-08-14T00:01:00.000Z",
    })).rejects.toThrow(/payload|forbidden|unrecognized|invalid/i);

    await expect(store.getFigureDraft("user-1", "draft-1")).resolves.toMatchObject({ currentRevision: 1 });
    await expect(store.getFigureDraftRevision("user-1", "draft-1", 2)).resolves.toBeNull();
  });

  it("rejects an out-of-phase ready_for_visio status at runtime", async () => {
    const store = new InMemoryFoundationStore();

    await expect(store.createFigureDraft({
      id: "draft-unsafe-status",
      userId: "user-1",
      conversationId: "conv-1",
      status: "ready_for_visio" as never,
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    }, safeRevisionPayload())).rejects.toThrow(/payload|status|invalid/i);

    await expect(store.getFigureDraft("user-1", "draft-unsafe-status")).resolves.toBeNull();
  });

  it("revalidates stored payloads when reading revisions", async () => {
    const store = new InMemoryFoundationStore();
    await store.createFigureDraft({
      id: "draft-1",
      userId: "user-1",
      conversationId: "conv-1",
      status: "ready_for_preview",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
    }, safeRevisionPayload());
    const internals = store as unknown as {
      figureDraftRevisions: Map<string, { payload: unknown }>;
    };
    const corrupted = internals.figureDraftRevisions.get("draft-1:1");
    if (!corrupted) throw new Error("test fixture failed to create revision 1");
    corrupted.payload = { ...safeRevisionPayload(), requestHeaders: { authorization: "Bearer secret" } };

    await expect(store.getFigureDraftRevision("user-1", "draft-1", 1)).rejects.toThrow(/payload|forbidden|unrecognized|invalid/i);
  });
});
