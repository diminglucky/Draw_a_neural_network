import { describe, expect, it } from "vitest";
import { CurrentPageSelectionCapture } from "../src/current-page-selection-capture.js";

describe("CurrentPageSelectionCapture", () => {
  it("sends only a binding-free read-only capture request and maps a Worker target to a lease capture", async () => {
    const commands: unknown[] = [];
    const capture = new CurrentPageSelectionCapture({
      execute: async (command) => {
        commands.push(command);
        return { protocolVersion: 3, requestId: command.requestId, status: "succeeded", capturedTarget: { documentId: "document-1", pageId: "page-1", documentFingerprint: "a".repeat(64), pageFingerprint: "b".repeat(64), expectedRevision: 0 } };
      },
    }, () => "capture-1");

    await expect(capture.capture({ tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", workflowId: "workflow-1" })).resolves.toMatchObject({ status: "captured", target: { documentId: "document-1" } });
    expect(commands).toEqual([{ protocolVersion: 3, requestId: "capture-1", command: "captureSelectedPage" }]);
  });

  it("returns waiting when the Worker has no user-selected existing page", async () => {
    const capture = new CurrentPageSelectionCapture({ execute: async (command) => ({ protocolVersion: 3, requestId: command.requestId, status: "failed", error: "waiting_for_selected_page" }) }, () => "capture-2");
    await expect(capture.capture({ tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", workflowId: "workflow-1" })).resolves.toEqual({ status: "waiting_for_selected_page" });
  });
});
