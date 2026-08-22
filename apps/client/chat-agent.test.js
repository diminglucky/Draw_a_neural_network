import { describe, expect, it, vi } from "vitest";
import {
  AGENT_LIMITS,
  buildAgentRequestHeaders,
  buildAgentPayload,
  buildVisioExportRequestHeaders,
  cancelVisioExportJob,
  confirmAgentCanvasMutation,
  createIdempotencyKey,
  escapeHtml,
  exportDiagramToVisio,
  getFigureDraftPreview,
  getPublicationVisualPreview,
  getVisioExportJob,
  isAgentAuthorized,
  isVisioJobCancellable,
  openVisioPath,
  renderVisioError,
  renderFigureDraftCard,
  submitVisioExport,
  validateAttachment,
  validateMessage,
  waitForVisioExport,
} from "../../chat-agent.js";

function publicationVisualResponse(kind = "formal", qaStatus = "pending") {
  const candidate = kind === "candidate";
  return {
    kind,
    exportEligible: !candidate && qaStatus === "passed",
    draft: { id: "draft-pvp", revision: 7 },
    pvp: {
      identity: { schemaVersion: 1, planId: "pvp:chat", canonicalHash: "b".repeat(64) },
      eligibility: { kind, formalReasons: candidate ? [] : ["topology-complete"], blockingReasons: candidate ? ["topology-candidate"] : [], qaStatus },
      lineage: {},
      coordinateSpace: { id: "pvp-du-1", origin: "top_left", axes: "x_right_y_down", unit: "du", duPerInch: 1000, page: { x: 0, y: 0, width: 600, height: 300 }, safeMargins: { x: 25, y: 25, width: 550, height: 250 } },
      regions: [], primitiveGroups: [],
      primitives: [
        { primitiveId: "primitive:input", componentId: "input", kind: "Input", regionId: "region:main", bounds: { x: 50, y: 100, width: 100, height: 80 }, zIndex: 1, styleTokenIds: [], label: "Input" },
        { primitiveId: "primitive:output", componentId: "output", kind: "Output", regionId: "region:main", bounds: { x: 400, y: 100, width: 100, height: 80 }, zIndex: 1, styleTokenIds: [], label: "Output" },
      ],
      ports: [
        { portId: "port:in", primitiveId: "primitive:input", role: "output", anchor: { side: "right", offset: 500 }, order: 0, semanticPortId: "input:out" },
        { portId: "port:out", primitiveId: "primitive:output", role: "input", anchor: { side: "left", offset: 500 }, order: 0, semanticPortId: "output:in" },
      ],
      connectors: [{ connectorId: "connector:flow", sourcePortId: "port:in", targetPortId: "port:out", relation: "data", route: [{ x: 150, y: 140 }, { x: 275, y: 140 }, { x: 275, y: 140 }, { x: 400, y: 140 }], styleTokenIds: [], zIndex: 0 }],
      annotations: [], legend: {}, styleTokens: {}, profileApplications: [], sourceMappings: [],
      rendererRequirements: { protocolVersion: "pvp-renderer-1", requiredCapabilities: ["native-text", "orthogonal-route", "shape-data"], optionalCapabilities: [] }, updateIdentity: {},
    },
  };
}

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

  it("includes only the current canvas snapshot when requested", () => {
    const canvas = {
      figure: { title: "Current" },
      paletteName: "dopamine",
      nodes: [{ id: "input", type: "tensor", x: 0, y: 0, w: 100, h: 100, label: "Input", subtitle: "", stage: 0, color: "#00e5ff" }],
      edges: [],
    };
    const payload = buildAgentPayload("modify the current diagram", [], "conversation-2", canvas);
    expect(payload.canvas).toEqual(canvas);
    expect(JSON.stringify(payload)).not.toContain("apiKey");
    expect(JSON.stringify(payload)).not.toContain("SYNAPSE_API_BASE");
  });

  it("projects unsafe canvas metadata out of the Agent payload", () => {
    const payload = buildAgentPayload("inspect the current diagram", [], "conversation-3", {
      figure: { title: "Current", apiKey: "secret", serviceConfig: { baseUrl: "https://internal" } },
      paletteName: "dopamine",
      nodes: [{ id: "input", type: "tensor", x: 0, y: 0, w: 100, h: 100, label: "Input", subtitle: "", stage: 0, color: "#00e5ff", command: "powershell" }],
      edges: [],
    });

    expect(payload.canvas).toEqual({
      figure: { title: "Current" },
      paletteName: "dopamine",
      nodes: [{ id: "input", type: "tensor", x: 0, y: 0, w: 100, h: 100, label: "Input", subtitle: "", stage: 0, color: "#00e5ff" }],
      edges: [],
    });
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(JSON.stringify(payload)).not.toContain("powershell");
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

  it("sends the configured relay API key only as a transient request header", () => {
    const headers = buildAgentRequestHeaders("bearer-token", "agent-key", "sk-user-relay");
    expect(headers["X-Synapse-Provider-Api-Key"]).toBe("sk-user-relay");
    expect(JSON.stringify(headers)).not.toContain("SYNAPSE_API_BASE");
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

  it("opens a completed .vsdx through the desktop bridge", async () => {
    const openPath = vi.fn(async (value) => value);
    await expect(openVisioPath("C:\\exports\\network.vsdx", { openPath })).resolves.toBe("C:\\exports\\network.vsdx");
    expect(openPath).toHaveBeenCalledWith("C:\\exports\\network.vsdx");
    await expect(openVisioPath("C:\\exports\\network.vsdx", null)).rejects.toThrow("桌面 Visio 打开桥接不可用");
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

  it("requires an explicit positive confirmation for Agent canvas mutation", () => {
    expect(confirmAgentCanvasMutation("replace", () => false)).toBe(false);
    expect(confirmAgentCanvasMutation("replace", () => true)).toBe(true);
    expect(confirmAgentCanvasMutation("replace", null)).toBe(false);
  });

  it("fetches an owner-scoped publication preview only with the bearer token", async () => {
    let request;
    const preview = await getFigureDraftPreview("draft/one", {
      apiBase: "http://127.0.0.1:4180",
      token: "bearer-token",
      fetchImpl: async (url, init) => {
        request = { url, init };
        return { ok: true, status: 200, async json() { return { draft: { id: "draft/one", status: "ready_for_preview" }, grammar: { id: "cnn-classifier", version: 1 }, qa: { blocking: [], warnings: [] }, plan: { coordinateSpace: { width: 1, height: 1 }, regions: [], primitives: [], relations: [], annotations: [] } }; } };
      },
    });

    expect(request).toEqual({ url: "http://127.0.0.1:4180/api/figure-drafts/draft%2Fone/preview", init: { method: "GET", headers: { Authorization: "Bearer bearer-token" } } });
    expect(preview.grammar.id).toBe("cnn-classifier");
    expect(renderFigureDraftCard({ id: "draft-1", status: "needs_confirmation", currentRevision: 1 })).not.toContain("data-agent-figure-preview");
    expect(renderFigureDraftCard({ id: "draft-1", status: "ready_for_preview", currentRevision: 1 })).toContain("data-agent-figure-preview");
  });

  it("fetches a revision-bound publication visual preview with only the v3 bearer headers", async () => {
    let request;
    const preview = await getPublicationVisualPreview("draft/one", 7, {
      apiBase: "http://127.0.0.1:4180",
      token: "bearer-token",
      fetchImpl: async (url, init) => {
        request = { url, init };
        return { ok: true, status: 200, async json() { return publicationVisualResponse(); } };
      },
    });

    expect(request).toEqual({
      url: "http://127.0.0.1:4180/api/figure-drafts/draft%2Fone/revisions/7/publication-preview",
      init: { method: "GET", headers: { Authorization: "Bearer bearer-token", "Accept-Figure-Version": "3" }, signal: undefined },
    });
    expect(preview.kind).toBe("formal");
    await expect(getPublicationVisualPreview("draft", 0, { token: "bearer-token", fetchImpl: async () => null })).rejects.toThrow(/revision/i);
    await expect(getPublicationVisualPreview("draft", 1, { token: "bearer-token", fetchImpl: async () => ({ ok: true, status: 200, async json() { return { kind: "formal", locator: "C:/private/model.py" }; } }) })).rejects.toThrow(/PVP|preview/i);
    const card = renderFigureDraftCard({ id: "draft-1", status: "ready_for_preview", currentRevision: 7 });
    expect(card).toContain("data-agent-pvp-preview");
    expect(card).toContain("data-agent-pvp-preview-panel");
    expect(card).not.toMatch(/snapshot|worker|com|export/i);
  });
});
