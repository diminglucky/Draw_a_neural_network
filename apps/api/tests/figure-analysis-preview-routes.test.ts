import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/security.js";
import { InMemoryFoundationStore } from "../src/store.js";

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function createAuthorizedApp(email: string) {
  const store = new InMemoryFoundationStore();
  const app = buildApp({
    store,
    sessionSecret: "figure-analysis-preview-route-session-secret",
    admin: { email: "admin@example.com", passwordHash: await hashPassword("admin-password") },
  });
  apps.push(app);
  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email,
      password: "password-123",
      device: {
        name: "Research PC",
        publicKey: `key-${email}`,
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
    payload: { email, password: "password-123", deviceId: registered.json().device.id },
  });
  expect(login.statusCode).toBe(200);
  return {
    app,
    store,
    userId: registered.json().user.id as string,
    deviceId: registered.json().device.id as string,
    authorization: `Bearer ${login.json().accessToken as string}`,
  };
}

function sourcePayload(code: string, sourceId: string) {
  const bytes = Buffer.from(code, "utf8");
  return {
    sourceId,
    name: "preview.py",
    mimeType: "text/x-python",
    data: bytes.toString("base64"),
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

const linearSource = [
  "class N(nn.Module):",
  " def __init__(self):",
  "  self.conv = nn.Conv2d(3,16,3)",
  " def forward(self,x):",
  "  return self.conv(x)",
].join("\n");

const dynamicSource = [
  "class N(nn.Module):",
  " def forward(self,x):",
  "  if flag:",
  "   return x",
  "  return x",
].join("\n");

async function createAnalysis(
  app: ReturnType<typeof buildApp>,
  authorization: string,
  source: string,
  sourceId: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/figure-analyses",
    headers: { authorization, "accept-figure-version": "3", "idempotency-key": `preview-${sourceId}` },
    payload: { source: sourcePayload(source, sourceId) },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; status: string };
}

describe("owner-scoped versioned figure analysis preview route", () => {
  it("rejects a mismatched preview version with the established validation-error shape and both supported versions", async () => {
    const { app, authorization } = await createAuthorizedApp("preview-version@example.com");

    const response = await app.inject({
      method: "GET",
      url: "/api/figure-analyses/analysis-missing/preview",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { field: "Accept-Figure-Version", reason: "unsupported_version", supported: [3, 4] },
    });
  });

  it("requires an authenticated owner", async () => {
    const { app } = await createAuthorizedApp("preview-auth@example.com");

    const response = await app.inject({
      method: "GET",
      url: "/api/figure-analyses/analysis-missing/preview",
      headers: { "accept-figure-version": "3" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns a safe deterministic publication preview for the owner", async () => {
    const { app, authorization, store, userId } = await createAuthorizedApp("preview-ready@example.com");
    const analysis = await createAnalysis(app, authorization, linearSource, "preview-ready-source");

    const first = await app.inject({
      method: "GET",
      url: `/api/figure-analyses/${analysis.id}/preview`,
      headers: { authorization, "accept-figure-version": "3" },
    });
    const second = await app.inject({
      method: "GET",
      url: `/api/figure-analyses/${analysis.id}/preview`,
      headers: { authorization, "accept-figure-version": "3" },
    });

    expect(first.statusCode).toBe(200);
    expect(first.headers["figure-version"]).toBe("3");
    expect(first.json()).toMatchObject({
      version: 3,
      kind: "publication_plan",
      publicationPlan: { version: 1, compilerVersion: "composable-dag-v1" },
      visualQa: { status: "pass" },
    });
    expect(first.body).toBe(second.body);
    expect(first.body).not.toMatch(/evidenceIndex|sourceSha256|sourceRecordId|sourceMappings|locator|excerpt|provider|worker|command/i);
    expect(await store.listJobs()).toHaveLength(0);
    const audit = (await store.listAuditRecords()).find((record) => record.action === "figure.analysis.preview.read");
    expect(audit).toMatchObject({
      actorId: userId,
      targetId: analysis.id,
      metadata: {
        analysisId: analysis.id,
        kind: "publication_plan",
        version: 3,
        qaStatus: "pass",
      },
    });
    expect(JSON.stringify(audit?.metadata)).not.toMatch(/evidence|source|provider|worker|command|path/i);
  });

  it("returns the PVP public DTO with Figure-Version 4 for a v4 request", async () => {
    const { app, authorization } = await createAuthorizedApp("preview-v4@example.com");
    const analysis = await createAnalysis(app, authorization, linearSource, "preview-v4-source");

    const response = await app.inject({
      method: "GET",
      url: `/api/figure-analyses/${analysis.id}/preview`,
      headers: { authorization, "accept-figure-version": "4" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["figure-version"]).toBe("4");
    expect(response.json()).toMatchObject({
      version: 4,
      kind: "publication_visual_preview",
      publicationPreview: {
        schemaVersion: 1,
        plan: { identity: { planId: expect.stringMatching(/^pvp:/), canonicalHash: expect.stringMatching(/^[a-f0-9]{64}$/) } },
        graph: { version: 1, graphId: expect.any(String), detail: "architecture" },
      },
    });
  });

  it("returns a watermarked candidate without preview side effects", async () => {
    const { app, authorization, store } = await createAuthorizedApp("preview-candidate@example.com");
    const analysis = await createAnalysis(app, authorization, dynamicSource, "preview-candidate-source");

    expect(analysis.status).toBe("candidate_structure");
    const v3 = await app.inject({
      method: "GET",
      url: `/api/figure-analyses/${analysis.id}/preview`,
      headers: { authorization, "accept-figure-version": "3" },
    });

    const v4 = await app.inject({
      method: "GET",
      url: `/api/figure-analyses/${analysis.id}/preview`,
      headers: { authorization, "accept-figure-version": "4" },
    });

    expect(v3.statusCode).toBe(200);
    expect(v3.json()).toMatchObject({ version: 3, kind: "candidate_structure", watermark: "STRUCTURE_PENDING_CONFIRMATION" });
    expect(v4.statusCode).toBe(200);
    expect(v4.json()).toMatchObject({ version: 4, kind: "candidate_structure", watermark: "STRUCTURE_PENDING_CONFIRMATION" });
    expect(v3.json()).not.toHaveProperty("architectureIR");
    expect(v3.json()).not.toHaveProperty("evidenceGraph");
    expect(v3.json()).not.toHaveProperty("sourceRef");
    expect(v3.json()).not.toHaveProperty("publicationPlan");
    expect(v4.json()).not.toHaveProperty("publicationPreview");
    expect(await store.listJobs()).toHaveLength(0);
  });

  it("returns the same safe not-found response for missing and foreign analyses", async () => {
    const owner = await createAuthorizedApp("preview-owner@example.com");
    const foreign = await createAuthorizedApp("preview-foreign@example.com");
    const analysis = await createAnalysis(owner.app, owner.authorization, linearSource, "preview-owner-source");

    const missing = await owner.app.inject({
      method: "GET",
      url: "/api/figure-analyses/missing-analysis/preview",
      headers: { authorization: owner.authorization, "accept-figure-version": "3" },
    });
    const inaccessible = await foreign.app.inject({
      method: "GET",
      url: `/api/figure-analyses/${analysis.id}/preview`,
      headers: { authorization: foreign.authorization, "accept-figure-version": "3" },
    });

    expect(missing.statusCode).toBe(404);
    expect(inaccessible.statusCode).toBe(404);
    expect(missing.json().error).toMatchObject({ code: "NOT_FOUND" });
    expect(inaccessible.json().error).toMatchObject({
      code: missing.json().error.code,
      message: missing.json().error.message,
      details: missing.json().error.details,
    });
  });
});
