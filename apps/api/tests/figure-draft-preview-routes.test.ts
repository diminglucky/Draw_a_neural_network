import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { FigureDraftPreviewService } from "../src/figure-draft-preview-service.js";
import { FigureDraftService } from "../src/figure-draft-service.js";
import { GrammarRegistry } from "../src/grammar-registry.js";
import { InMemoryFoundationStore } from "../src/store.js";
import { readyVgg16FigureAnalysis } from "./fixtures/ready-vgg16-figure-analysis.js";

const SESSION_SECRET = "figure-draft-preview-route-session-secret";

async function registerAndLogin(app: ReturnType<typeof buildApp>, email: string) {
  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password-123", device: { name: "Research PC", publicKey: `key-${email}`, fingerprintHash: `fingerprint-${email}`, clientVersion: "0.1.0", osVersion: "Windows 11" } },
  });
  expect(registered.statusCode).toBe(201);
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "password-123", deviceId: registered.json().device.id } });
  expect(login.statusCode).toBe(200);
  return { userId: registered.json().user.id as string, headers: { authorization: `Bearer ${login.json().accessToken as string}` } };
}

describe("figure draft preview route", () => {
  const apps = new Set<ReturnType<typeof buildApp>>();

  afterEach(async () => {
    for (const app of apps) await app.close();
    apps.clear();
  });

  it("requires an authenticated owner and returns only a preview-safe compiled artifact", async () => {
    const store = new InMemoryFoundationStore();
    const drafts = new FigureDraftService({ store, createDraftId: () => "draft-vgg", now: () => "2026-08-14T09:00:00.000Z" });
    const app = buildApp({
      sessionSecret: SESSION_SECRET,
      store,
      figureDraftService: drafts,
      figureDraftPreviewService: new FigureDraftPreviewService({ figureDraftService: drafts }),
    });
    apps.add(app);
    const owner = await registerAndLogin(app, "preview-owner@example.com");
    const other = await registerAndLogin(app, "preview-other@example.com");
    await drafts.createFromAnalysis(owner.userId, "conversation-1", readyVgg16FigureAnalysis());

    const unauthenticated = await app.inject({ method: "GET", url: "/api/figure-drafts/draft-vgg/preview" });
    const response = await app.inject({ method: "GET", url: "/api/figure-drafts/draft-vgg/preview", headers: owner.headers });
    const inaccessible = await app.inject({ method: "GET", url: "/api/figure-drafts/draft-vgg/preview", headers: other.headers });

    expect(unauthenticated.statusCode).toBe(401);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      draft: { id: "draft-vgg", revision: 1 },
      grammar: { id: "cnn-classifier" },
      plan: { target: "preview", renderIntent: { density: "standard", printMode: "color" } },
      qa: { blocking: [], warnings: [] },
    });
    expect(JSON.stringify(response.json())).not.toMatch(/providerApiKey|authorization|outputPath|visioCommand|rawAttachment|locator|excerpt/i);
    expect(inaccessible.statusCode).toBe(404);

    const audit = (await store.listAuditRecords()).find((record) => record.action === "figure-draft.preview.read");
    expect(audit).toMatchObject({ actorId: owner.userId, targetId: "draft-vgg", metadata: { grammarId: "cnn-classifier", target: "preview" } });
    expect(audit?.metadata).not.toHaveProperty("plan");
    expect(audit?.metadata).not.toHaveProperty("semanticModel");
    expect(audit?.metadata).not.toHaveProperty("sourceMappings");
    expect(JSON.stringify(audit?.metadata)).not.toMatch(/provider|locator|excerpt/i);
  });

  it("fails closed without a compiled artifact when no grammar can be selected", async () => {
    const store = new InMemoryFoundationStore();
    const drafts = new FigureDraftService({ store, createDraftId: () => "draft-vgg", now: () => "2026-08-14T09:00:00.000Z" });
    const preview = new FigureDraftPreviewService({
      figureDraftService: drafts,
      grammarRegistry: new GrammarRegistry([{
        id: "cnn-classifier",
        version: 1,
        evaluate: () => ({ grammarId: "cnn-classifier", score: 0.69, reasons: ["CNN topology is below the automatic-selection threshold"], blockers: [] }),
      }]),
    });
    const app = buildApp({ sessionSecret: SESSION_SECRET, store, figureDraftService: drafts, figureDraftPreviewService: preview });
    apps.add(app);
    const owner = await registerAndLogin(app, "selection-owner@example.com");
    await drafts.createFromAnalysis(owner.userId, "conversation-1", readyVgg16FigureAnalysis());

    const response = await app.inject({ method: "GET", url: "/api/figure-drafts/draft-vgg/preview", headers: owner.headers });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatchObject({
      code: "FIGURE_PREVIEW_SELECTION_REQUIRED",
      details: {
        candidates: [{ grammarId: "cnn-classifier", score: 0.69, reasons: ["CNN topology is below the automatic-selection threshold"], blockers: [] }],
        blockers: [],
      },
    });
    expect(JSON.stringify(response.json())).not.toMatch(/plan|semanticModel|sourceMappings|provider|locator|excerpt/i);
    expect((await store.listAuditRecords()).some((record) => record.action === "figure-draft.preview.read")).toBe(false);
  });
});
