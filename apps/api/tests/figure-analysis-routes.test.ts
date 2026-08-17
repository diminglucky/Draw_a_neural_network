import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/security.js";
import { InMemoryFoundationStore } from "../src/store.js";

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function createAuthorizedApp(email = `user-${Date.now()}-${Math.random()}@example.com`, agentService?: { chat: ReturnType<typeof vi.fn> }) {
  const store = new InMemoryFoundationStore();
  const app = buildApp({
    store,
    sessionSecret: "test-session-secret-test-session-secret",
    admin: { email: "admin@example.com", passwordHash: await hashPassword("admin-password") },
    agentService,
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
        publicKey: `public-key-${email}`,
        fingerprintHash: `fingerprint-${email}`,
        clientVersion: "0.1.0",
        osVersion: "Windows 11",
      },
    },
  });
  const deviceId = registered.json().device.id;
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: "password-123", deviceId },
  });
  return { app, store, authorization: `Bearer ${login.json().accessToken}` };
}

function sourcePayload(code: string, sourceId = "source-tiny") {
  const bytes = Buffer.from(code, "utf8");
  return {
    sourceId,
    name: "tiny.py",
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

describe("authenticated figure analysis routes", () => {
  it("requires the explicit v3 request header", async () => {
    const { app, authorization } = await createAuthorizedApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/figure-analyses",
      headers: { authorization, "idempotency-key": "route-version-1" },
      payload: { source: sourcePayload(linearSource) },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("requires an authenticated owner", async () => {
    const { app } = await createAuthorizedApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/figure-analyses",
      headers: { "accept-figure-version": "3", "idempotency-key": "route-auth-1" },
      payload: { source: sourcePayload(linearSource) },
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns a safe v3 ready analysis for a linear source", async () => {
    const { app, authorization } = await createAuthorizedApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/figure-analyses",
      headers: { authorization, "accept-figure-version": "3", "idempotency-key": "route-linear-1" },
      payload: { source: sourcePayload(linearSource) },
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(response.headers["figure-version"]).toBe("3");
    expect(body).toMatchObject({
      kind: "pytorch-source",
      status: "ready_for_preview",
      source: { sourceId: "source-tiny", name: "tiny.py", mimeType: "text/x-python", bytes: Buffer.byteLength(linearSource) },
      architectureIR: { version: 3, graphId: "pytorch:source-tiny", unresolved: [] },
      blockingQuestion: null,
      capabilityVersion: "pytorch-static-linear-v0",
    });
    expect(body).not.toHaveProperty("code");
    expect(body).not.toHaveProperty("evidenceGraph");
    expect(body).not.toHaveProperty("sourceRef");
    expect(JSON.stringify(body)).not.toContain(Buffer.from(linearSource, "utf8").toString("base64"));
  });

  it("returns one candidate question for dynamic source without preview fields", async () => {
    const { app, authorization } = await createAuthorizedApp();
    const code = [
      "class N(nn.Module):",
      " def forward(self,x):",
      "  if flag:",
      "   return x",
      "  return x",
    ].join("\n");
    const response = await app.inject({
      method: "POST",
      url: "/api/figure-analyses",
      headers: { authorization, "accept-figure-version": "3", "idempotency-key": "route-dynamic-1" },
      payload: { source: sourcePayload(code, "source-dynamic") },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "candidate_structure",
      blockingQuestion: { code: "dynamic-control-flow", locator: { kind: "code", startLine: 3 } },
      architectureIR: { unresolved: [expect.objectContaining({ severity: "blocking" })] },
    });
    expect(response.json()).not.toHaveProperty("planSnapshot");
    expect(response.json()).not.toHaveProperty("previewArtifact");
  });

  it("replays exact idempotent requests and rejects a changed source", async () => {
    const { app, authorization } = await createAuthorizedApp();
    const headers = { authorization, "accept-figure-version": "3", "idempotency-key": "route-idempotency-1" };
    const first = await app.inject({ method: "POST", url: "/api/figure-analyses", headers, payload: { source: sourcePayload(linearSource) } });
    const second = await app.inject({ method: "POST", url: "/api/figure-analyses", headers, payload: { source: sourcePayload(linearSource) } });
    const changed = await app.inject({ method: "POST", url: "/api/figure-analyses", headers, payload: { source: sourcePayload(`${linearSource}\n# changed`) } });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.details.requestHashMatches).toBe(false);
  });

  it("enforces owner scope on reads and keeps audit data safe", async () => {
    const { app, store, authorization } = await createAuthorizedApp("owner-one@example.com");
    const secretCode = `${linearSource}\n# outputPath: C:\\sensitive\\figure.vsdx\n# api-key: provider-secret`;
    const created = await app.inject({
      method: "POST",
      url: "/api/figure-analyses",
      headers: { authorization, "accept-figure-version": "3", "idempotency-key": "route-owner-1" },
      payload: { source: sourcePayload(secretCode) },
    });
    const other = await createAuthorizedApp("owner-two@example.com");
    const forbiddenRead = await other.app.inject({
      method: "GET",
      url: `/api/figure-analyses/${created.json().id}`,
      headers: { authorization: other.authorization, "accept-figure-version": "3" },
    });
    const ownerRead = await app.inject({
      method: "GET",
      url: `/api/figure-analyses/${created.json().id}`,
      headers: { authorization, "accept-figure-version": "3" },
    });

    expect(forbiddenRead.statusCode).toBe(404);
    expect(ownerRead.statusCode).toBe(200);
    expect(ownerRead.headers["figure-version"]).toBe("3");
    const audits = JSON.stringify(await store.listAuditRecords());
    expect(JSON.stringify(ownerRead.json())).not.toContain("outputPath");
    expect(JSON.stringify(ownerRead.json())).not.toContain("provider-secret");
    expect(audits).not.toContain(secretCode);
  });

  it("does not invoke the legacy Agent service", async () => {
    const agent = { chat: vi.fn().mockRejectedValue(new Error("legacy Agent must not be called")) };
    const { app, authorization } = await createAuthorizedApp("no-agent@example.com", agent);
    const response = await app.inject({
      method: "POST",
      url: "/api/figure-analyses",
      headers: { authorization, "accept-figure-version": "3", "idempotency-key": "route-no-agent-1" },
      payload: { source: sourcePayload(linearSource) },
    });

    expect(response.statusCode).toBe(201);
    expect(agent.chat).not.toHaveBeenCalled();
  });
});
