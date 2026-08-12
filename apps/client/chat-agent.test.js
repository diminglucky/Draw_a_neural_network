import { describe, expect, it } from "vitest";
import {
  AGENT_LIMITS,
  buildAgentRequestHeaders,
  buildAgentPayload,
  buildVisioExportRequestHeaders,
  cancelVisioExportJob,
  createIdempotencyKey,
  escapeHtml,
  exportDiagramToVisio,
  getVisioExportJob,
  isAgentAuthorized,
  isVisioJobCancellable,
  renderVisioError,
  submitVisioExport,
  validateAttachment,
  validateMessage,
  waitForVisioExport,
} from "../../chat-agent.js";

describe("Agent Chat client contracts", () => {
  it("accepts supported code and image attachments and rejects unsupported types", () => {
    expect(validateAttachment({ name: "model.py", type: "text/x-python", size: 12, kind: "code" })).toEqual({ ok: true, kind: "code" });
    expect(validateAttachment({ name: "notes.md", type: "text/markdown", size: 12, kind: "code" })).toEqual({ ok: true, kind: "code" });
    expect(validateAttachment({ name: "diagram.webp", type: "image/webp", size: 12, kind: "image" })).toEqual({ ok: true, kind: "image" });
    expect(validateAttachment({ name: "script.exe", type: "application/octet-stream", size: 12 })).toMatchObject({ ok: false });
  });

  it("enforces attachment count, code characters, and image byte limits", () => {
    expect(validateAttachment({ name: "big.py", type: "text/x-python", size: AGENT_LIMITS.codeChars + 1, kind: "code", textLength: AGENT_LIMITS.codeChars + 1 })).toMatchObject({ ok: false });
    expect(validateAttachment({ name: "big.png", type: "image/png", size: AGENT_LIMITS.imageBytes + 1, kind: "image" })).toMatchObject({ ok: false });
    expect(validateMessage("x".repeat(AGENT_LIMITS.messageChars + 1))).toMatchObject({ ok: false });
  });

  it("builds the API payload without provider credentials", () => {
    const payload = buildAgentPayload("draw a CNN", [
      { name: "model.py", mimeType: "text/x-python", kind: "code", data: "YWJj", textLength: 3 },
      { name: "sketch.png", mimeType: "image/png", kind: "image", data: "aW1n", size: 3 },
    ], "conversation-1");
    expect(payload).toEqual({
      conversationId: "conversation-1",
      message: "draw a CNN",
      attachments: [
        { name: "model.py", mimeType: "text/x-python", kind: "code", data: "YWJj" },
        { name: "sketch.png", mimeType: "image/png", kind: "image", data: "aW1n" },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain("apiKey");
  });

  it("creates a bounded idempotency key and sends it with the bearer request", () => {
    const key = createIdempotencyKey(() => "fixed-agent-key");
    const headers = buildAgentRequestHeaders("bearer-token", key);

    expect(key).toBe("fixed-agent-key");
    expect(headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer bearer-token",
      "Idempotency-Key": "fixed-agent-key",
    });
    expect(JSON.stringify(headers)).not.toContain("apiKey");
  });

  it("submits a validated Agent diagram as a queued Visio Job", async () => {
    let request;
    const result = await submitVisioExport({ nodes: [], edges: [] }, {
      apiBase: "http://127.0.0.1:4180",
      token: "bearer-token",
      idempotencyKey: "visio-export-1",
      fetchImpl: async (url, init) => {
        request = { url, init };
        return {
          ok: true,
          status: 202,
          async json() {
            return {
              id: "job-1",
              type: "visio-export",
              status: "queued",
              pollUrl: "/api/jobs/job-1",
            };
          },
        };
      },
    });

    expect(request.url).toBe("http://127.0.0.1:4180/api/visio/export");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toEqual(buildVisioExportRequestHeaders("bearer-token", "visio-export-1"));
    expect(JSON.parse(request.init.body)).toEqual({ diagram: { nodes: [], edges: [] } });
    expect(result).toMatchObject({ id: "job-1", status: "queued", pollUrl: "/api/jobs/job-1" });
  });

  it("polls a user-owned Visio Job until it succeeds with bounded backoff", async () => {
    const requests = [];
    const delays = [];
    const states = [
      { id: "job-2", type: "visio-export", status: "queued" },
      { id: "job-2", type: "visio-export", status: "running" },
      { id: "job-2", type: "visio-export", status: "succeeded", output: { path: "C:\\exports\\job-2.vsdx", readback: { valid: true, shapeCount: 2, connectorCount: 1 } } },
    ];
    const result = await waitForVisioExport("job-2", {
      apiBase: "http://127.0.0.1:4180",
      token: "bearer-token",
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return { ok: true, status: 200, async json() { return states.shift(); } };
      },
      sleepImpl: async (delay) => delays.push(delay),
      maxWaitMs: 1_000,
    });

    expect(result.status).toBe("succeeded");
    expect(requests).toHaveLength(3);
    expect(requests.every(({ init }) => init.headers.Authorization === "Bearer bearer-token")).toBe(true);
    expect(delays).toEqual([100, 250]);
  });

  it("stops polling immediately when a Visio Job reaches a terminal failure", async () => {
    let calls = 0;
    const result = await waitForVisioExport("job-failed", {
      token: "bearer-token",
      fetchImpl: async () => {
        calls += 1;
        return { ok: true, status: 200, async json() { return { id: "job-failed", type: "visio-export", status: "failed", errorCode: "VISIO_EXECUTION_FAILED" }; } };
      },
      sleepImpl: async () => { throw new Error("sleep must not be called after a terminal state"); },
    });

    expect(result).toMatchObject({ id: "job-failed", status: "failed" });
    expect(calls).toBe(1);
  });

  it("gets and cancels only cancellable Visio Job states", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, async json() { return { id: "job-3", type: "visio-export", status: "cancelled" }; } };
    };

    await expect(getVisioExportJob("job-3", { apiBase: "http://127.0.0.1:4180", token: "bearer-token", fetchImpl })).resolves.toMatchObject({ id: "job-3" });
    await expect(cancelVisioExportJob("job-3", { apiBase: "http://127.0.0.1:4180", token: "bearer-token", status: "running", fetchImpl })).resolves.toMatchObject({ status: "cancelled" });
    await expect(cancelVisioExportJob("job-3", { token: "bearer-token", status: "succeeded", fetchImpl })).rejects.toThrow("Job cannot be cancelled");

    expect(calls[0]).toMatchObject({ url: "http://127.0.0.1:4180/api/jobs/job-3", init: { method: "GET" } });
    expect(calls[1]).toMatchObject({ url: "http://127.0.0.1:4180/api/jobs/job-3/cancel", init: { method: "POST" } });
    expect(isVisioJobCancellable("queued")).toBe(true);
    expect(isVisioJobCancellable("running")).toBe(true);
    expect(isVisioJobCancellable("expired")).toBe(false);
    expect(isVisioJobCancellable("succeeded")).toBe(false);
  });

  it("renders API error messages as text instead of HTML", () => {
    const node = { hidden: true, textContent: "" };
    renderVisioError(node, `<img src=x onerror="bad()">`);
    expect(node.textContent).toBe(`<img src=x onerror="bad()">`);
    expect(node.hidden).toBe(false);
  });

  it("surfaces an explicit Visio export error from the API", async () => {
    await expect(exportDiagramToVisio({ nodes: [], edges: [] }, {
      token: "bearer-token",
      idempotencyKey: "visio-export-2",
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        async json() { return { error: { code: "VISIO_EXECUTOR_NOT_CONFIGURED", message: "Visio Worker is not configured" } }; },
      }),
    })).rejects.toThrow("Visio Worker is not configured");
  });

  it("escapes assistant text before it is inserted into the UI", () => {
    expect(escapeHtml(`<img src=x onerror="bad()"> & 'quoted'`)).toBe("&lt;img src=x onerror=&quot;bad()&quot;&gt; &amp; &#39;quoted&#39;");
  });

  it("locks sending unless both the gate and token authorize the request", () => {
    expect(isAgentAuthorized({ gateState: "authorized", token: "bearer" })).toBe(true);
    expect(isAgentAuthorized({ gateState: "locked", token: "bearer" })).toBe(false);
    expect(isAgentAuthorized({ gateState: "authorized", token: "" })).toBe(false);
  });
});
