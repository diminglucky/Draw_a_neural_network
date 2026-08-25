import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApiErrorCode } from "../src/domain.js";
import { CurrentPageVisioAdapter } from "../src/current-page-visio-adapter.js";
import { CurrentPageSelectionCapture } from "../src/current-page-selection-capture.js";
import { buildSelectedPageVisioSessionCommands, buildVisioWorkerArguments, normalizeVisioDiagram, VisioWorkerClient } from "../src/visio-worker-client.js";
import { createSelectedPageSealedPlan } from "../src/visio-universal-protocol.js";
import { completeVisioReadback } from "./fixtures/visio-readback.js";

const fixtureDiagram = {
  figure: { title: "CNN", stages: ["Input", "Output"] },
  nodes: [
    { id: "input", type: "tensor", label: "Input", stage: 0, x: 100, y: 100, w: 100, h: 100 },
    { id: "output", type: "output", label: "Output", stage: 1, x: 700, y: 100, w: 100, h: 100 },
  ],
  edges: [{ id: "edge-1", source: "input", target: "output", type: "signal", route: { points: [{ x: 200, y: 150 }, { x: 700, y: 150 }] } }],
};

const outputRoot = path.join(process.cwd(), ".tmp-visio-client-test");
const aliasOutputRoot = path.join(process.env.TEMP ?? process.cwd(), "synapse-visio-client-alias-test");

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition was not met before timeout");
}

async function readSessionTrace(): Promise<Array<Record<string, unknown>>> {
  const tracePath = path.join(outputRoot, "session-trace.jsonl");
  try {
    const contents = await readFile(tracePath, "utf8");
    return contents.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

afterEach(async () => {
  await rm(outputRoot, { recursive: true, force: true });
  await rm(aliasOutputRoot, { recursive: true, force: true });
});

describe("VisioWorkerClient", () => {
  it("uses a dedicated Worker channel to capture the current page before any drawing binding exists", async () => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-v3-session-fake.mjs");
    const client = new VisioWorkerClient({ workerPath: process.execPath, workerArgs: [workerScript], outputRoot, mode: "live", timeoutMs: 10_000 });

    const result = await new CurrentPageSelectionCapture(client.createSelectedPageCaptureTransport(), () => "request-capture").capture({ tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", workflowId: "workflow-1" });

    expect(result).toMatchObject({ status: "captured", target: { documentId: "document-captured", pageId: "page-captured", expectedRevision: 0 } });
    await waitFor(async () => (await readSessionTrace()).some((entry) => entry.event === "eof"));
    expect((await readSessionTrace()).filter((entry) => typeof entry.command === "string").map((entry) => entry.command)).toEqual(["captureSelectedPage"]);
  });

  it("builds only the sealed selected-page command sequence and rejects a mismatched binding", () => {
    const binding = {
      jobId: "job-1",
      tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", workflowId: "workflow-1",
      documentId: "document-1", pageId: "page-1", documentFingerprint: "a".repeat(64), pageFingerprint: "b".repeat(64),
      expectedRevision: 4, ownershipNamespace: "agent-region-1",
    };
    const sealedPlanSecret = "selected-page-worker-client-test-secret";
    const sealedNativeIntent = createSelectedPageSealedPlan({
      ...binding,
      planId: "plan-1",
      canonicalPlanBytes: Buffer.from('{"plan":"selected-page"}', "utf8"),
      expiresAt: "2030-08-24T12:00:00.000Z",
    }, sealedPlanSecret);
    const commands = buildSelectedPageVisioSessionCommands({
      requestIdFactory: (suffix) => `request-${suffix}`,
      binding,
      sealedNativeIntent,
      sealedPlanSecret,
      now: new Date("2026-08-24T12:00:00.000Z"),
    });
    expect(commands.map((command) => command.command)).toEqual(["attachSelectedPage", "applyOwnedRegion", "saveSelectedDocument", "readSelectedPage", "closeSession"]);
    expect(JSON.stringify(commands)).not.toMatch(/outputPath|createDocument|createPage|open/i);
    expect(() => buildSelectedPageVisioSessionCommands({
      requestIdFactory: (suffix) => `request-${suffix}`,
      binding,
      sealedNativeIntent: { ...sealedNativeIntent, pageId: "other-page" },
      sealedPlanSecret,
      now: new Date("2026-08-24T12:00:00.000Z"),
    })).toThrow(/pageId|binding/i);
  });

  it("keeps every selected-page command in one Worker process and releases it after the verified readback", async () => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-v3-session-fake.mjs");
    const client = new VisioWorkerClient({
      workerPath: process.execPath,
      workerArgs: [workerScript],
      outputRoot,
      mode: "live",
      visible: true,
      timeoutMs: 10_000,
    });
    const binding = {
      jobId: "job-v3-transport-1",
      tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", workflowId: "workflow-1",
      documentId: "document-1", pageId: "page-1", documentFingerprint: "a".repeat(64), pageFingerprint: "b".repeat(64),
      expectedRevision: 4, ownershipNamespace: "agent-region-1",
    };
    const secret = "selected-page-v3-transport-test-secret";
    const sealedNativeIntent = createSelectedPageSealedPlan({
      ...binding,
      planId: "plan-v3-1",
      canonicalPlanBytes: Buffer.from('{"version":"pvp-native-intent-1"}', "utf8"),
      expiresAt: "2030-08-24T12:00:00.000Z",
    }, secret);

    const result = await new CurrentPageVisioAdapter(client.createSelectedPageTransport()).draw({
      binding,
      sealedNativeIntent,
      sealedPlanSecret: secret,
      now: new Date("2026-08-24T12:00:00.000Z"),
      requestIdFactory: (suffix) => `request-v3-${suffix}`,
    });

    expect(result.status).toBe("succeeded");
    await waitFor(async () => (await readSessionTrace()).some((entry) => entry.event === "eof"));
    const trace = await readSessionTrace();
    expect(trace.filter((entry) => typeof entry.command === "string").map((entry) => entry.command)).toEqual([
      "attachSelectedPage", "applyOwnedRegion", "saveSelectedDocument", "readSelectedPage", "closeSession",
    ]);
    expect(new Set(trace.filter((entry) => typeof entry.command === "string").map((entry) => entry.pid))).toEqual(new Set([trace[0]?.pid]));
  });

  it("releases the selected-page Worker without applying when Visio is waiting for a user-selected page", async () => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-v3-session-fake.mjs");
    const client = new VisioWorkerClient({
      workerPath: process.execPath,
      workerArgs: [workerScript, "--waiting-for-selected-page"],
      outputRoot,
      mode: "live",
      visible: true,
      timeoutMs: 10_000,
    });
    const binding = {
      jobId: "job-v3-waiting-1",
      tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", workflowId: "workflow-1",
      documentId: "document-1", pageId: "page-1", documentFingerprint: "a".repeat(64), pageFingerprint: "b".repeat(64),
      expectedRevision: 4, ownershipNamespace: "agent-region-1",
    };
    const secret = "selected-page-v3-waiting-test-secret";
    const sealedNativeIntent = createSelectedPageSealedPlan({
      ...binding,
      planId: "plan-v3-waiting-1",
      canonicalPlanBytes: Buffer.from('{"version":"pvp-native-intent-1"}', "utf8"),
      expiresAt: "2030-08-24T12:00:00.000Z",
    }, secret);

    await expect(new CurrentPageVisioAdapter(client.createSelectedPageTransport()).draw({
      binding,
      sealedNativeIntent,
      sealedPlanSecret: secret,
      now: new Date("2026-08-24T12:00:00.000Z"),
      requestIdFactory: (suffix) => `request-v3-waiting-${suffix}`,
    })).resolves.toEqual({ status: "waiting_for_selected_page" });

    await waitFor(async () => (await readSessionTrace()).some((entry) => entry.event === "eof"));
    expect((await readSessionTrace()).filter((entry) => typeof entry.command === "string").map((entry) => entry.command)).toEqual(["attachSelectedPage"]);
  });

  it("fails closed and releases the selected-page Worker when attach times out", async () => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-v3-session-fake.mjs");
    const client = new VisioWorkerClient({
      workerPath: process.execPath,
      workerArgs: [workerScript, "--hang-on-attach"],
      outputRoot,
      mode: "live",
      visible: true,
      timeoutMs: 50,
    });
    const binding = {
      jobId: "job-v3-timeout-1",
      tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", workflowId: "workflow-1",
      documentId: "document-1", pageId: "page-1", documentFingerprint: "a".repeat(64), pageFingerprint: "b".repeat(64),
      expectedRevision: 4, ownershipNamespace: "agent-region-1",
    };
    const secret = "selected-page-v3-timeout-test-secret";
    const sealedNativeIntent = createSelectedPageSealedPlan({
      ...binding,
      planId: "plan-v3-timeout-1",
      canonicalPlanBytes: Buffer.from('{"version":"pvp-native-intent-1"}', "utf8"),
      expiresAt: "2030-08-24T12:00:00.000Z",
    }, secret);

    await expect(new CurrentPageVisioAdapter(client.createSelectedPageTransport()).draw({
      binding,
      sealedNativeIntent,
      sealedPlanSecret: secret,
      now: new Date("2026-08-24T12:00:00.000Z"),
      requestIdFactory: (suffix) => `request-v3-timeout-${suffix}`,
    })).rejects.toMatchObject({ code: ApiErrorCode.VISIO_EXECUTION_FAILED, statusCode: 504, message: "Selected-page Worker command timed out" });

    await waitFor(async () => (await readSessionTrace()).some((entry) => entry.event === "eof"));
    expect((await readSessionTrace()).filter((entry) => typeof entry.command === "string").map((entry) => entry.command)).toEqual(["attachSelectedPage"]);
  });

  it("passes live visibility and attach flags to the Worker process", () => {
    expect(buildVisioWorkerArguments({
      workerArgs: ["--diagnostic"],
      mode: "live",
      outputRoot: "C:\\exports",
      visible: true,
      attachToRunning: true,
    })).toEqual([
      "--diagnostic",
      "--mode", "live",
      "--output-root", "C:\\exports",
      "--visible",
      "--attach-to-running",
    ]);
  });

  it("preserves a validated Figure Plan for the Worker while retaining legacy nodes", () => {
    const diagram = {
      ...fixtureDiagram,
      figurePlan: {
        version: 1,
        coordinateSpace: { unit: "figure-unit", figureUnitInches: 0.01, origin: "top-left", width: 1200, height: 800 },
        primitiveGroups: [{
          id: "block-1",
          kind: "feature-map-prism",
          primitiveIds: ["block-1.front", "block-1.top", "block-1.side"],
          bounds: { x: 35, y: 250, width: 70, height: 300 },
          extrusionDepthFu: 24,
          skewXFu: 18,
          skewYFu: -14,
          semantic: { sourceNodeId: "block-1", stage: 1, visualRole: "feature-map-stack", layerRole: "convolution-relu", repeatCount: 2, channelCount: 64, tensorShape: [224, 224, 64] },
        }],
      },
    };
    const normalized = normalizeVisioDiagram(diagram);
    expect(normalized.nodes).toHaveLength(2);
    expect(normalized.figurePlan?.primitiveGroups[0]).toMatchObject({
      id: "block-1",
      primitiveIds: ["block-1.front", "block-1.top", "block-1.side"],
    });
  });

  it("projects strict v2 Worker Figure Plans without a compatibility version and retains labels", () => {
    const normalized = normalizeVisioDiagram({
      ...fixtureDiagram,
      figurePlan: {
        coordinateSpace: { unit: "figure-unit", figureUnitInches: 0.01, origin: "top-left", width: 1200, height: 800 },
        primitiveGroups: [{
          id: "block-1",
          kind: "feature-map-prism",
          primitiveIds: ["block-1.front", "block-1.top", "block-1.side"],
          bounds: { x: 35, y: 250, width: 70, height: 300 },
          extrusionDepthFu: 24,
          skewXFu: 18,
          skewYFu: -14,
          semantic: { sourceNodeId: "block-1", stage: 1, visualRole: "feature-map-stack", layerRole: "convolution-relu", repeatCount: 2, channelCount: 64, tensorShape: [224, 224, 64] },
        }],
        connectors: [],
        labels: [{ id: "block-1.label", groupId: "block-1", text: "Conv 1", x: 35, y: 210, width: 100, height: 20, fontSizePt: 10 }],
      },
    });

    expect(Object.keys(normalized.figurePlan ?? {}).sort()).toEqual(["connectors", "coordinateSpace", "labels", "primitiveGroups"]);
    expect(normalized.figurePlan?.labels).toEqual([{ id: "block-1.label", groupId: "block-1", text: "Conv 1", x: 35, y: 210, width: 100, height: 20, fontSizePt: 10 }]);
  });

  it("maps a successful Worker response to an export result", async () => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-fake.mjs");
    const client = new VisioWorkerClient({
      workerPath: process.execPath,
      workerArgs: [workerScript],
      outputRoot,
      mode: "mock",
      timeoutMs: 10_000,
    });

    const result = await client.executeDiagram({ jobId: "job-client-1", diagram: fixtureDiagram });

    expect(result.path).toMatch(/job-client-1\.vsdx$/);
    expect(result.readback).toEqual(completeVisioReadback({
      shapeCount: 3,
      connectorCount: 2,
      expectedPrimitiveIds: ["block-1.front", "block-1.side", "block-1.top"],
      actualPrimitiveIds: ["block-1.front", "block-1.side", "block-1.top"],
      expectedConnectorIds: ["edge-block-1-pool-1"],
      actualConnectorIds: ["edge-block-1-pool-1"],
    }));
  });

  it("accepts a Worker long path when Node produced an equivalent Windows short path", async () => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-fake-long-path.mjs");
    const client = new VisioWorkerClient({
      workerPath: process.execPath,
      workerArgs: [workerScript],
      outputRoot: aliasOutputRoot,
      mode: "mock",
      timeoutMs: 10_000,
    });

    await expect(client.executeDiagram({ jobId: "job-client-alias-1", diagram: fixtureDiagram })).resolves.toMatchObject({
      path: expect.stringMatching(/job-client-alias-1\.vsdx$/),
      readback: { valid: true, shapeCount: 1, connectorCount: 0 },
    });
  });

  it("aborts a running Worker when the signal is cancelled", async () => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-fake-hang.mjs");
    const client = new VisioWorkerClient({
      workerPath: process.execPath,
      workerArgs: [workerScript],
      outputRoot,
      mode: "mock",
      timeoutMs: 10_000,
    });
    const controller = new AbortController();
    const startedAt = Date.now();
    const result = client.executeDiagram({ jobId: "job-client-abort-1", diagram: fixtureDiagram }, { signal: controller.signal });

    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();

    await expect(result).rejects.toMatchObject({
      code: ApiErrorCode.VISIO_EXECUTION_FAILED,
      details: { reason: "cancelled", jobId: "job-client-abort-1" },
    });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("keeps one visible live Worker session through applyDiff until explicit close", async () => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-v2-session-fake.mjs");
    const client = new VisioWorkerClient({
      workerPath: process.execPath,
      workerArgs: [workerScript],
      outputRoot,
      mode: "live",
      visible: true,
      timeoutMs: 10_000,
    });
    const session = { userId: "user-1", deviceId: "device-1", workflowId: "workflow-1" };

    await client.executeDiagram({ jobId: "job-first", diagram: fixtureDiagram, ...session, operation: "apply" });
    expect((await readSessionTrace()).map((entry) => entry.command)).toEqual(["open", "apply", "save"]);

    await client.executeDiagram({ jobId: "job-revision", diagram: fixtureDiagram, ...session, operation: "applyDiff" });
    expect((await readSessionTrace()).map((entry) => entry.command)).toEqual(["open", "apply", "save", "applyDiff", "save"]);

    await client.closeSession(session);
    await waitFor(async () => (await readSessionTrace()).some((entry) => entry.event === "eof"));
    expect((await readSessionTrace()).flatMap((entry) => typeof entry.command === "string" ? [entry.command] : [])).toEqual(["open", "apply", "save", "applyDiff", "save", "close"]);
  });

  it("rejects an initial applyDiff before starting a visible Worker session", async () => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-v2-session-fake.mjs");
    const client = new VisioWorkerClient({ workerPath: process.execPath, workerArgs: [workerScript], outputRoot, mode: "live", visible: true, timeoutMs: 10_000 });
    const session = { userId: "user-state", deviceId: "device-state", workflowId: "workflow-state" };

    await expect(client.executeDiagram({ jobId: "job-illegal-diff", diagram: fixtureDiagram, ...session, operation: "applyDiff" }))
      .rejects.toMatchObject({ code: ApiErrorCode.VALIDATION_FAILED, message: "The first visible Visio operation must be apply" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await readSessionTrace()).filter((entry) => typeof entry.command === "string")).toEqual([]);
  });

  it("rejects a second apply without discarding the existing visible baseline", async () => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-v2-session-fake.mjs");
    const client = new VisioWorkerClient({ workerPath: process.execPath, workerArgs: [workerScript], outputRoot, mode: "live", visible: true, timeoutMs: 10_000 });
    const session = { userId: "user-baseline", deviceId: "device-baseline", workflowId: "workflow-baseline" };

    await client.executeDiagram({ jobId: "job-baseline", diagram: fixtureDiagram, ...session, operation: "apply" });
    await expect(client.executeDiagram({ jobId: "job-illegal-apply", diagram: fixtureDiagram, ...session, operation: "apply" }))
      .rejects.toMatchObject({ code: ApiErrorCode.VALIDATION_FAILED, message: "A visible Visio revision must use applyDiff" });
    await client.executeDiagram({ jobId: "job-valid-diff", diagram: fixtureDiagram, ...session, operation: "applyDiff" });

    expect((await readSessionTrace()).flatMap((entry) => typeof entry.command === "string" ? [entry.command] : [])).toEqual([
      "open", "apply", "save", "applyDiff", "save",
    ]);
    await client.closeSession(session);
  });

  it("invalidates a pre-aborted visible session and lets the next server Job create a fresh child", async () => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-v2-session-fake.mjs");
    const client = new VisioWorkerClient({ workerPath: process.execPath, workerArgs: [workerScript], outputRoot, mode: "live", visible: true, timeoutMs: 10_000 });
    const session = { userId: "user-abort", deviceId: "device-abort", workflowId: "workflow-abort" };
    const cancelled = new AbortController();
    cancelled.abort();

    await expect(client.executeDiagram({ jobId: "job-pre-aborted", diagram: fixtureDiagram, ...session, operation: "apply" }, { signal: cancelled.signal }))
      .rejects.toMatchObject({ code: ApiErrorCode.VISIO_EXECUTION_FAILED, details: { reason: "cancelled" } });
    await expect(client.executeDiagram({ jobId: "job-after-abort", diagram: fixtureDiagram, ...session, operation: "apply" }))
      .resolves.toMatchObject({ readback: { valid: true } });
    expect((await readSessionTrace()).flatMap((entry) => typeof entry.command === "string" ? [entry.command] : [])).toEqual(["open", "apply", "save"]);
    await client.closeSession(session);
  });

  it.each([
    ["hangs after a successful close response", ["--hang-after-close"], 504, /did not exit after close/i],
    ["exits nonzero after a successful close response", ["--exit-nonzero-after-close"], 502, /ended unexpectedly/i],
    ["emits malformed JSON after a successful close response", ["--malformed-after-close"], 502, /invalid session response/i],
  ])("fails closed when the Worker %s", async (_scenario, workerArgs, statusCode, message) => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-v2-session-fake.mjs");
    const client = new VisioWorkerClient({ workerPath: process.execPath, workerArgs: [workerScript, ...workerArgs], outputRoot, mode: "live", visible: true, timeoutMs: 1_000 });
    const session = { userId: `user-close-${statusCode}`, deviceId: `device-close-${statusCode}`, workflowId: `workflow-close-${statusCode}` };

    await client.executeDiagram({ jobId: `job-close-${statusCode}`, diagram: fixtureDiagram, ...session, operation: "apply" });
    await expect(client.closeSession(session)).rejects.toMatchObject({ code: ApiErrorCode.VISIO_EXECUTION_FAILED, statusCode, message: expect.stringMatching(message) });
  });

  it("rejects a v2 apply success without a native readback", async () => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-v2-session-fake.mjs");
    const client = new VisioWorkerClient({
      workerPath: process.execPath,
      workerArgs: [workerScript, "--missing-readback"],
      outputRoot,
      mode: "live",
      visible: true,
      timeoutMs: 10_000,
    });

    await expect(client.executeDiagram({
      jobId: "job-missing-readback",
      diagram: fixtureDiagram,
      userId: "user-1",
      deviceId: "device-1",
      workflowId: "workflow-missing-readback",
      operation: "apply",
    })).rejects.toMatchObject({
      code: ApiErrorCode.VISIO_EXECUTION_FAILED,
      message: "Visio Worker returned no valid native readback",
    });
  });

  it("rejects an invalid visible-session workflow identity before creating an output path", async () => {
    const workerScript = path.join(process.cwd(), "apps/api/tests/fixtures/visio-worker-v2-session-fake.mjs");
    const client = new VisioWorkerClient({ workerPath: process.execPath, workerArgs: [workerScript], outputRoot, mode: "live", visible: true });

    await expect(client.executeDiagram({ jobId: "job-invalid-workflow", diagram: fixtureDiagram, userId: "user-1", deviceId: "device-1", workflowId: "../escape", operation: "apply" })).rejects.toMatchObject({
      code: ApiErrorCode.VALIDATION_FAILED,
    });
  });
});
