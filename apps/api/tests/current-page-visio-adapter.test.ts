import { describe, expect, it } from "vitest";
import { CurrentPageVisioAdapter, type SelectedPageWorkerTransport } from "../src/current-page-visio-adapter.js";
import { createSelectedPageSealedPlan } from "../src/visio-universal-protocol.js";

const binding = { jobId: "job-1", tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", documentFingerprint: "a".repeat(64), pageFingerprint: "b".repeat(64), expectedRevision: 4, ownershipNamespace: "agent-region-1" };
const secret = "selected-page-adapter-test-secret";
const sealedNativeIntent = createSelectedPageSealedPlan({ ...binding, planId: "plan-1", canonicalPlanBytes: Buffer.from("{}"), expiresAt: "2030-01-01T00:00:00.000Z" }, secret);

describe("CurrentPageVisioAdapter", () => {
  it("reads before and after save with unique request IDs, then returns the post-save readback", async () => {
    const transport = new RecordingTransport();
    const result = await draw(transport);

    expect(transport.commands.map((command) => command.command)).toEqual([
      "attachSelectedPage",
      "applyOwnedRegion",
      "readSelectedPage",
      "saveSelectedDocument",
      "readSelectedPage",
      "closeSession",
    ]);
    expect(transport.commands.map((command) => command.requestId)).toEqual([
      "request-attach",
      "request-apply",
      "request-read-before-save",
      "request-save",
      "request-read-after-save",
      "request-close",
    ]);
    expect(result).toEqual({ status: "succeeded", readback: readback() });
  });

  it("does not save after a failed pre-save read", async () => {
    const transport = new RecordingTransport({ "read-before-save": failure("pre-save read failed") });

    await expect(draw(transport)).resolves.toEqual({ status: "failed", error: "pre-save read failed" });
    expect(transport.commands.map((command) => command.command)).toEqual(["attachSelectedPage", "applyOwnedRegion", "readSelectedPage", "closeSession"]);
  });

  it("fails when post-save readback does not match the pre-save readback", async () => {
    const transport = new RecordingTransport({ "read-after-save": success(readback({ userOwnedShapeCount: 2 })) });

    await expect(draw(transport)).resolves.toMatchObject({ status: "failed", error: expect.stringMatching(/readback.*match/i) });
    expect(transport.commands.map((command) => command.command)).toEqual([
      "attachSelectedPage", "applyOwnedRegion", "readSelectedPage", "saveSelectedDocument", "readSelectedPage", "closeSession",
    ]);
  });

  it("does not read after a failed save", async () => {
    const transport = new RecordingTransport({ save: failure("save failed") });

    await expect(draw(transport)).resolves.toEqual({ status: "failed", error: "save failed" });
    expect(transport.commands.map((command) => command.command)).toEqual(["attachSelectedPage", "applyOwnedRegion", "readSelectedPage", "saveSelectedDocument", "closeSession"]);
  });

  it("fails after a failed post-save read", async () => {
    const transport = new RecordingTransport({ "read-after-save": failure("post-save read failed") });

    await expect(draw(transport)).resolves.toEqual({ status: "failed", error: "post-save read failed" });
    expect(transport.commands.map((command) => command.command)).toEqual([
      "attachSelectedPage", "applyOwnedRegion", "readSelectedPage", "saveSelectedDocument", "readSelectedPage", "closeSession",
    ]);
  });

  it.each([
    ["pre-save read failure", { "read-before-save": failure("pre-save read failed") }],
    ["save failure", { save: failure("save failed") }],
    ["post-save read failure", { "read-after-save": failure("post-save read failed") }],
    ["readback mismatch", { "read-after-save": success(readback({ userOwnedShapeCount: 2 })) }],
    ["normal close failure", { close: failure("close failed") }],
  ])("sends close exactly once after attach on %s", async (_scenario, overrides) => {
    const transport = new RecordingTransport(overrides);

    await draw(transport);

    expect(transport.commands.filter((command) => command.command === "closeSession")).toHaveLength(1);
  });

  it("returns failure when the normal close command fails", async () => {
    const transport = new RecordingTransport({ close: failure("close failed") });

    await expect(draw(transport)).resolves.toEqual({ status: "failed", error: "close failed" });
    expect(transport.commands.filter((command) => command.command === "closeSession")).toHaveLength(1);
  });
});

type Response = { status: "succeeded"; readback?: ReturnType<typeof readback> } | { status: "failed"; error: string };

class RecordingTransport implements SelectedPageWorkerTransport {
  readonly commands: Array<any> = [];

  constructor(private readonly overrides: Partial<Record<"read-before-save" | "read-after-save" | "save" | "close", Response>> = {}) {}

  async execute(command: any): Promise<unknown> {
    this.commands.push(command);
    const response = this.overrides[command.requestId.replace("request-", "") as keyof typeof this.overrides]
      ?? (command.command === "readSelectedPage" ? success(readback()) : success());
    return response.status === "failed"
      ? { protocolVersion: 3, requestId: command.requestId, status: "failed", error: response.error }
      : { protocolVersion: 3, requestId: command.requestId, status: "succeeded", selectedPage: binding, ...(response.readback ? { readback: response.readback } : {}) };
  }
}

function readback(overrides: Partial<{ userOwnedShapeCount: number }> = {}) {
  return {
    valid: true as const,
    documentId: binding.documentId,
    pageId: binding.pageId,
    documentFingerprint: binding.documentFingerprint,
    pageFingerprint: binding.pageFingerprint,
    expectedRevision: binding.expectedRevision,
    ownershipNamespace: binding.ownershipNamespace,
    userOwnedShapeCount: 1,
    agentOwnedShapes: [],
    unclassifiedShapeCount: 0 as const,
    ...overrides,
  };
}

function success(readbackValue?: ReturnType<typeof readback>): Response { return { status: "succeeded", ...(readbackValue ? { readback: readbackValue } : {}) }; }
function failure(error: string): Response { return { status: "failed", error }; }

function draw(transport: SelectedPageWorkerTransport) {
  return new CurrentPageVisioAdapter(transport).draw({ binding, sealedNativeIntent, sealedPlanSecret: secret, now: new Date("2026-01-01T00:00:00.000Z"), requestIdFactory: (suffix) => `request-${suffix}` });
}
