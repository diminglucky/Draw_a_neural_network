import { describe, expect, it } from "vitest";
import { answerDrawingRunClarification, cancelDrawingRun, listDrawingRuns, renderDrawingRunStatusList, startDrawingRun, submitDrawingRunReceipt } from "./drawing-run-client.js";

function response(body, ok = true, status = 200) {
  return { ok, status, async json() { return body; } };
}

describe("Drawing Run client status", () => {
  it("lists owner-scoped runs through the authenticated status route", async () => {
    const requests = [];
    const runs = [{ runId: "run-1", revision: 2, status: "analyzing", allowedActions: ["cancel"], clarification: null, preview: null }];
    await expect(listDrawingRuns({ token: "token", apiBase: "http://api", fetchImpl: async (url, init) => { requests.push({ url, init }); return response({ runs }); } })).resolves.toEqual(runs);
    expect(requests[0]).toMatchObject({ url: "http://api/api/drawing-runs", init: { method: "GET", headers: { Authorization: "Bearer token" } } });
  });

  it("sends revision-bound cancellation and clarification commands", async () => {
    const requests = [];
    const fetchImpl = async (url, init) => { requests.push({ url, init }); return response({ status: "awaiting_clarification" }); };
    await cancelDrawingRun("run-1", 3, { token: "token", apiBase: "http://api", randomUUIDFactory: () => "cancel-key", fetchImpl });
    await answerDrawingRunClarification("run-1", 4, "clarification:1", "confirm add", { token: "token", apiBase: "http://api", randomUUIDFactory: () => "answer-key", fetchImpl });
    expect(requests[0].init.headers["Idempotency-Key"]).toBe("cancel-key");
    expect(JSON.parse(requests[0].init.body)).toEqual({ expectedRevision: 3 });
    expect(JSON.parse(requests[1].init.body)).toEqual({ expectedRevision: 4, clarificationId: "clarification:1", answer: "confirm add" });
  });

  it("starts a run and uploads a private PyTorch receipt without exposing source text", async () => {
    const requests = [];
    const fetchImpl = async (url, init) => {
      requests.push({ url, init });
      return requests.length === 1
        ? response({ runId: "run-1", revision: 0, status: "received" })
        : response({ runId: "run-1", revision: 1, status: "input_accepted" });
    };
    const intent = { action: "analyze_network", requestedDetail: "architecture", target: "browser_preview", sourceKinds: ["pytorch_source"] };
    await startDrawingRun(intent, { token: "token", apiBase: "http://api", randomUUIDFactory: () => "start-key", fetchImpl });
    await submitDrawingRunReceipt("run-1", 0, "class Net(nn.Module): pass", { token: "token", apiBase: "http://api", randomUUIDFactory: () => "input-key", sha256Impl: async () => "a".repeat(64), fetchImpl });
    expect(requests[0].init.headers["Idempotency-Key"]).toBe("start-key");
    expect(JSON.parse(requests[1].init.body).receipts[0]).toMatchObject({ kind: "pytorch_source", retention: "owner_revision", sha256: "a".repeat(64) });
    expect(JSON.stringify(requests[1].init.body)).not.toContain("class Net");
  });

  it("escapes public status text and exposes only safe actions", () => {
    const html = renderDrawingRunStatusList([{ runId: '<script>', revision: 1, status: "awaiting_clarification", allowedActions: ["cancel"], clarification: { id: "q-1", prompt: "<img>" }, preview: null }]);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img&gt;");
    expect(html).toContain("data-drawing-run-answer");
    expect(html).toContain("data-drawing-run-cancel");
    expect(html).not.toContain("ownerId");
  });
});
