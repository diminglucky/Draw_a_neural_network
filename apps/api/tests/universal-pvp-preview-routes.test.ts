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
    sessionSecret: "universal-pvp-preview-route-session-secret",
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
    authorization: `Bearer ${login.json().accessToken as string}`,
  };
}

function typedPromptInput() {
  return {
    kind: "typed-prompt",
    sourceId: "route-formal-source",
    prompt: JSON.stringify({
      graphId: "route-formal-graph",
      topology: "complete",
      nodes: [
        { nodeId: "input", kind: "input", label: "Input", inputPorts: [], outputPorts: [{ portId: "out" }] },
        { nodeId: "mixer", kind: "operator", label: "Novel Mixer", operation: "novel_mixer", inputPorts: [{ portId: "in" }], outputPorts: [{ portId: "out" }] },
        { nodeId: "output", kind: "output", label: "Output", inputPorts: [{ portId: "in" }], outputPorts: [] },
      ],
      edges: [
        { edgeId: "input-mixer", sourcePortId: "input:out", targetPortId: "mixer:in" },
        { edgeId: "mixer-output", sourcePortId: "mixer:out", targetPortId: "output:in" },
      ],
    }),
  };
}

function staticInput(code: string, sourceId: string) {
  return {
    kind: "static-pytorch",
    sourceId,
    sourceSha256: createHash("sha256").update(code, "utf8").digest("hex"),
    code,
  };
}

describe("owner-scoped v4 universal PVP preview route", () => {
  it("requires the explicit v4 request header", async () => {
    const { app, authorization } = await createAuthorizedApp("universal-preview-version@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/api/universal-figure-previews",
      headers: { authorization },
      payload: { input: typedPromptInput() },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("requires an authenticated user", async () => {
    const { app } = await createAuthorizedApp("universal-preview-auth@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/api/universal-figure-previews",
      headers: { "accept-figure-version": "4" },
      payload: { input: typedPromptInput() },
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns a safe formal preview for a typed declaration without side effects", async () => {
    const { app, authorization, store, userId } = await createAuthorizedApp("universal-preview-formal@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/api/universal-figure-previews",
      headers: { authorization, "accept-figure-version": "4" },
      payload: { input: typedPromptInput() },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["figure-version"]).toBe("4");
    expect(response.json()).toMatchObject({ schemaVersion: 1, kind: "formal", exportEligible: false });
    expect(response.json().plan.primitives).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "CustomOperator", label: "Novel Mixer" }),
    ]));
    expect(response.body).not.toMatch(/route-formal-source|sourceMappings|updateIdentity|rendererRequirements|workerControl|comControl|sourcePath|outputPath|prompt/i);
    expect(await store.listJobs()).toHaveLength(0);
    const audit = (await store.listAuditRecords()).find((record) => record.action === "universal-figure.preview.read");
    expect(audit).toMatchObject({ actorId: userId, metadata: { version: 4, inputKind: "typed-prompt", kind: "formal", exportEligible: false } });
    expect(Object.keys(audit?.metadata ?? {}).sort()).toEqual(["exportEligible", "inputKind", "kind", "planHash", "planId", "version"]);
    expect(JSON.stringify(audit?.metadata)).not.toMatch(/route-formal-source|sourceSha|sourcePath|evidence|worker|comControl|updateIdentity/i);
  });

  it("returns dynamic static PyTorch input as candidate without executing or exporting it", async () => {
    const { app, authorization, store } = await createAuthorizedApp("universal-preview-candidate@example.com");
    const code = [
      "class Dynamic(nn.Module):",
      " def forward(self, x):",
      "  if x.sum() > 0:",
      "   return x",
      "  return -x",
    ].join("\n");

    const response = await app.inject({
      method: "POST",
      url: "/api/universal-figure-previews",
      headers: { authorization, "accept-figure-version": "4" },
      payload: { input: staticInput(code, "route-dynamic-source") },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schemaVersion: 1, kind: "candidate", exportEligible: false });
    expect(response.body).not.toMatch(/class Dynamic|route-dynamic-source|sourceMappings|updateIdentity|workerControl|comControl|sourcePath|outputPath/i);
    expect(await store.listJobs()).toHaveLength(0);
  });

  it("rejects a mismatched static source digest and forbidden body controls", async () => {
    const { app, authorization } = await createAuthorizedApp("universal-preview-invalid@example.com");
    const code = "class N(nn.Module):\n def forward(self, x):\n  return x";

    const digestMismatch = await app.inject({
      method: "POST",
      url: "/api/universal-figure-previews",
      headers: { authorization, "accept-figure-version": "4" },
      payload: { input: { ...staticInput(code, "route-digest-source"), sourceSha256: "0".repeat(64) } },
    });
    const forbiddenBody = await app.inject({
      method: "POST",
      url: "/api/universal-figure-previews",
      headers: { authorization, "accept-figure-version": "4" },
      payload: { input: typedPromptInput(), updateIdentity: { ownerId: "attacker" } },
    });

    expect(digestMismatch.statusCode).toBe(400);
    expect(digestMismatch.json().error).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(forbiddenBody.statusCode).toBe(400);
    expect(forbiddenBody.json().error).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("does not reflect compiler diagnostics containing submitted prompt text", async () => {
    const { app, authorization } = await createAuthorizedApp("universal-preview-error-secret@example.com");
    const sentinel = "SENTINEL_PROMPT_MUST_NOT_LEAK";
    const invalidInput = typedPromptInput();
    invalidInput.prompt = JSON.stringify({
      graphId: "invalid-graph",
      topology: "complete",
      nodes: [],
      edges: [],
      rendererControl: sentinel,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/universal-figure-previews",
      headers: { authorization, "accept-figure-version": "4" },
      payload: { input: invalidInput },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { field: "input", reason: "invalid" },
    });
    expect(response.json().error.details).not.toHaveProperty("message");
    expect(response.body).not.toContain(sentinel);
    expect(response.body).not.toMatch(/sourceMappings|updateIdentity|lineage|rendererRequirements|workerControl|comControl|sourcePath|outputPath/i);
  });

  it("binds opaque compile identity to the authenticated principal", async () => {
    const first = await createAuthorizedApp("universal-preview-principal-a@example.com");
    const second = await createAuthorizedApp("universal-preview-principal-b@example.com");
    const code = [
      "class Chain(nn.Module):",
      " def __init__(self):",
      "  self.conv = nn.Conv2d(3, 8, 1)",
      " def forward(self, x):",
      "  return self.conv(x)",
    ].join("\n");
    const input = staticInput(code, "shared-client-source");

    const [firstResponse, secondResponse] = await Promise.all([
      first.app.inject({ method: "POST", url: "/api/universal-figure-previews", headers: { authorization: first.authorization, "accept-figure-version": "4" }, payload: { input } }),
      second.app.inject({ method: "POST", url: "/api/universal-figure-previews", headers: { authorization: second.authorization, "accept-figure-version": "4" }, payload: { input } }),
    ]);

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(firstResponse.json().plan.identity.planId).not.toBe(secondResponse.json().plan.identity.planId);
    expect(firstResponse.body).not.toContain("shared-client-source");
    expect(secondResponse.body).not.toContain("shared-client-source");
  });
});
