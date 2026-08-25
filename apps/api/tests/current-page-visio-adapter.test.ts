import { describe, expect, it } from "vitest";
import { CurrentPageVisioAdapter, type SelectedPageWorkerTransport } from "../src/current-page-visio-adapter.js";
import { createSelectedPageSealedPlan } from "../src/visio-universal-protocol.js";

describe("CurrentPageVisioAdapter", () => {
  it("sends only the sealed v3 command sequence and returns independently bound readback", async () => {
    const binding = { jobId: "job-1", tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", documentFingerprint: "a".repeat(64), pageFingerprint: "b".repeat(64), expectedRevision: 4, ownershipNamespace: "agent-region-1" };
    const secret = "selected-page-adapter-test-secret";
    const sealedNativeIntent = createSelectedPageSealedPlan({ ...binding, planId: "plan-1", canonicalPlanBytes: Buffer.from("{}"), expiresAt: "2030-01-01T00:00:00.000Z" }, secret);
    const transport = new RecordingTransport(binding);
    const adapter = new CurrentPageVisioAdapter(transport);

    const result = await adapter.draw({ binding, sealedNativeIntent, sealedPlanSecret: secret, now: new Date("2026-01-01T00:00:00.000Z"), requestIdFactory: (suffix) => `request-${suffix}` });

    expect(transport.commands.map((command) => command.command)).toEqual(["attachSelectedPage", "applyOwnedRegion", "saveSelectedDocument", "readSelectedPage", "closeSession"]);
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") throw new Error("expected selected-page draw success");
    expect(result.readback.documentId).toBe(binding.documentId);
  });
});

class RecordingTransport implements SelectedPageWorkerTransport {
  readonly commands: Array<any> = [];
  constructor(private readonly binding: any) {}
  async execute(command: any): Promise<unknown> {
    this.commands.push(command);
    return command.command === "readSelectedPage"
      ? { protocolVersion: 3, requestId: command.requestId, status: "succeeded", selectedPage: this.binding, readback: { valid: true, documentId: this.binding.documentId, pageId: this.binding.pageId, documentFingerprint: this.binding.documentFingerprint, pageFingerprint: this.binding.pageFingerprint, expectedRevision: this.binding.expectedRevision, ownershipNamespace: this.binding.ownershipNamespace, userOwnedShapeCount: 1, agentOwnedShapes: [], unclassifiedShapeCount: 0 } }
      : { protocolVersion: 3, requestId: command.requestId, status: "succeeded", selectedPage: this.binding };
  }
}
