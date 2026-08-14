import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { FigureDraftService } from "../src/figure-draft-service.js";
import type { FigureDraftRevisionPayload } from "../src/figure-draft-payload.js";
import type { FigureAnalysisResult } from "../src/publication-figure-agent.js";
import { InMemoryFoundationStore } from "../src/store.js";

const TEST_SESSION_SECRET = "figure-draft-route-session-secret-figure-draft-route";

function analysis(): FigureAnalysisResult {
  return {
    status: "needs_confirmation" as const,
    taskIntent: {
      action: "analyze_network" as const,
      sourceMode: "code" as const,
      requestedArtifact: "structure_only" as const,
      referencesDraftId: null,
      userConstraints: {
        orientation: "auto" as const,
        density: "standard" as const,
        printMode: "auto" as const,
        requiresNativeVisio: false,
      },
    },
    evidence: [{
      id: "fact-merge",
      subject: "merge",
      predicate: "operation",
      value: "two branches join",
      confidence: 0.5,
      source: {
        sourceId: "source-text-1",
        kind: "text" as const,
        name: "User request",
      },
    }],
    canonicalNetworkIR: {
      version: 2 as const,
      figure: { id: "figure-1", title: "Residual block", description: null },
      tensors: [{
        id: "activation-1",
        name: "activation",
        shape: [1],
        axes: ["batch"],
        semanticRole: "activation" as const,
        dtype: null,
        producerNodeId: "input",
        consumerNodeIds: ["output"],
      }],
      nodes: [
        {
          id: "input",
          op: "input" as const,
          inputTensorIds: [],
          outputTensorIds: ["activation-1"],
          confidence: 0.9,
          sourceEvidenceIds: ["fact-merge"],
          repeats: null,
        },
        {
          id: "output",
          op: "output" as const,
          inputTensorIds: ["activation-1"],
          outputTensorIds: [],
          confidence: 0.9,
          sourceEvidenceIds: ["fact-merge"],
          repeats: null,
        },
      ],
      edges: [{
        id: "edge-input-output",
        sourceNodeId: "input",
        targetNodeId: "output",
        relation: "data" as const,
        tensorIds: ["activation-1"],
        confidence: 0.9,
        evidenceIds: ["fact-merge"],
      }],
      groups: [],
      unresolved: [],
    },
    blockingQuestions: [{
      id: "merge-kind",
      question: "Is this merge Add or Concat?",
      candidateValues: ["add", "concat"],
    }],
    warnings: ["Merge semantics require confirmation."],
    readyForVisio: false as const,
  };
}

async function registerAndLogin(app: ReturnType<typeof buildApp>, email: string) {
  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email,
      password: "password-123",
      device: {
        name: "Research PC",
        publicKey: `public-key-${email}`,
        fingerprintHash: `fingerprint-${email}`,
        clientVersion: "0.1.0",
        osVersion: "Windows 11",
      },
    },
  });
  expect(registered.statusCode).toBe(201);

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      email,
      password: "password-123",
      deviceId: registered.json().device.id,
    },
  });
  expect(login.statusCode).toBe(200);
  return {
    userId: registered.json().user.id as string,
    headers: { authorization: `Bearer ${login.json().accessToken as string}` },
  };
}

describe("figure draft routes", () => {
  const apps = new Set<ReturnType<typeof buildApp>>();

  afterEach(async () => {
    for (const app of apps) await app.close();
    apps.clear();
  });

  it("requires an authenticated device session before reading a draft", async () => {
    const app = buildApp({ sessionSecret: TEST_SESSION_SECRET });
    apps.add(app);

    const response = await app.inject({ method: "GET", url: "/api/figure-drafts/draft-1" });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_TOKEN");
  });

  it("returns only the owner-safe current and historical draft projections", async () => {
    const store = new InMemoryFoundationStore();
    const app = buildApp({ sessionSecret: TEST_SESSION_SECRET, store });
    apps.add(app);
    const owner = await registerAndLogin(app, "owner@example.com");
    const other = await registerAndLogin(app, "other@example.com");
    const drafts = new FigureDraftService({
      store,
      createDraftId: () => "draft-1",
      now: () => "2026-08-14T08:00:00.000Z",
    });
    const unsafeAnalysis: FigureAnalysisResult & { providerApiKey: string; requestHeaders: Record<string, string> } = {
      ...analysis(),
      providerApiKey: "sk-never-reflect-this",
      requestHeaders: { authorization: "Bearer never-reflect-this" },
    };
    const created = await drafts.createFromAnalysis(owner.userId, "conversation-1", unsafeAnalysis);
    const safePayload = structuredClone(created.revision.payload) as FigureDraftRevisionPayload;
    await store.appendFigureDraftRevision({
      userId: owner.userId,
      draftId: "draft-1",
      expectedRevision: 1,
      status: "needs_confirmation",
      payload: safePayload,
      createdAt: "2026-08-14T08:01:00.000Z",
    });

    const current = await app.inject({
      method: "GET",
      url: "/api/figure-drafts/draft-1",
      headers: owner.headers,
    });
    const historical = await app.inject({
      method: "GET",
      url: "/api/figure-drafts/draft-1/revisions/1",
      headers: owner.headers,
    });
    const inaccessible = await app.inject({
      method: "GET",
      url: "/api/figure-drafts/draft-1",
      headers: other.headers,
    });

    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({
      draft: {
        id: "draft-1",
        conversationId: "conversation-1",
        status: "needs_confirmation",
        currentRevision: 2,
      },
      revision: {
        revision: 2,
        status: "needs_confirmation",
        analysis: {
          readyForVisio: false,
          blockingQuestions: [{ id: "merge-kind", candidateValues: ["add", "concat"] }],
        },
      },
    });
    expect(JSON.stringify(current.json())).not.toContain("sk-never-reflect-this");
    expect(JSON.stringify(current.json())).not.toContain("requestHeaders");
    expect(JSON.stringify(current.json())).not.toContain("private://attachment/1");
    expect(JSON.stringify(current.json())).not.toContain("private user attachment excerpt");
    expect(JSON.stringify(current.json())).not.toContain("base64 private attachment");
    expect(historical.statusCode).toBe(200);
    expect(historical.json().revision.revision).toBe(1);
    expect(inaccessible.statusCode).toBe(404);
    expect(inaccessible.json().error.code).toBe("NOT_FOUND");
  });

  it("confirms exactly one candidate, appends revision 2, and rejects a stale revision", async () => {
    const store = new InMemoryFoundationStore();
    const app = buildApp({ sessionSecret: TEST_SESSION_SECRET, store });
    apps.add(app);
    const owner = await registerAndLogin(app, "confirm@example.com");
    const drafts = new FigureDraftService({
      store,
      createDraftId: () => "draft-2",
      now: () => "2026-08-14T08:00:00.000Z",
    });
    await drafts.createFromAnalysis(owner.userId, "conversation-2", analysis());

    const confirmed = await app.inject({
      method: "POST",
      url: "/api/figure-drafts/draft-2/confirm",
      headers: owner.headers,
      payload: {
        expectedRevision: 1,
        answer: { questionId: "merge-kind", value: "concat" },
      },
    });
    const stale = await app.inject({
      method: "POST",
      url: "/api/figure-drafts/draft-2/confirm",
      headers: owner.headers,
      payload: {
        expectedRevision: 1,
        answer: { questionId: "merge-kind", value: "add" },
      },
    });
    const revisionOne = await app.inject({
      method: "GET",
      url: "/api/figure-drafts/draft-2/revisions/1",
      headers: owner.headers,
    });

    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({
      draft: { id: "draft-2", status: "ready_for_preview", currentRevision: 2 },
      revision: { revision: 2, status: "ready_for_preview", analysis: { blockingQuestions: [] } },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("FIGURE_DRAFT_REVISION_CONFLICT");
    expect(revisionOne.statusCode).toBe(200);
    expect(revisionOne.json().revision.analysis.blockingQuestions).toHaveLength(1);

    const confirmationAudit = (await store.listAuditRecords()).find((record) => record.action === "figure-draft.confirmed");
    expect(confirmationAudit).toMatchObject({
      actorId: owner.userId,
      targetType: "figure-draft",
      targetId: "draft-2",
      metadata: {
        draftId: "draft-2",
        revision: 2,
        status: "ready_for_preview",
        blockingQuestionCount: 0,
        warningCount: 1,
      },
    });
    expect(JSON.stringify(confirmationAudit?.metadata)).not.toContain("concat");
  });
});
