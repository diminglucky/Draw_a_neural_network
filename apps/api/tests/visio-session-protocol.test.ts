import { describe, expect, it } from "vitest";
import {
  SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
  VISIO_SESSION_PROTOCOL_VERSION,
  parseVisioSessionCommand,
  parseSelectedPageCaptureCommand,
  parseSelectedPageCaptureResponse,
  parseSelectedPageVisioSessionCommand,
  parseSelectedPageVisioSessionResponse,
} from "../src/visio-session-protocol.js";
import { createSelectedPageSealedPlan } from "../src/visio-universal-protocol.js";

const binding = {
  jobId: "job-1",
  tenantId: "tenant-1",
  userId: "user-1",
  deviceId: "device-1",
  workflowId: "workflow-1",
  documentId: "document-1",
  pageId: "page-1",
  documentFingerprint: "a".repeat(64),
  pageFingerprint: "b".repeat(64),
  expectedRevision: 4,
  ownershipNamespace: "agent-region-1",
};
const sealedPlanSecret = "selected-page-session-test-secret";

function sealedNativeIntent() {
  return createSelectedPageSealedPlan({
    ...binding,
    planId: "plan-1",
    canonicalPlanBytes: Buffer.from('{"plan":"selected-page"}', "utf8"),
    expiresAt: "2030-08-24T12:00:00.000Z",
  }, sealedPlanSecret);
}

function attachCommand(requestId = "request-1") {
  return {
    protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
    requestId,
    command: "attachSelectedPage" as const,
    binding,
  };
}

describe("selected-current-page Visio session protocol", () => {
  it("permits a read-only selection capture with no client-supplied target and requires a Worker-captured target on success", () => {
    const command = parseSelectedPageCaptureCommand({
      protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
      requestId: "request-capture",
      command: "captureSelectedPage",
    });
    expect(command.command).toBe("captureSelectedPage");
    expect(() => parseSelectedPageCaptureCommand({ ...command, binding })).toThrow(/unrecognized|binding/i);

    expect(parseSelectedPageCaptureResponse({
      protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
      requestId: "request-capture",
      status: "succeeded",
      capturedTarget: {
        documentId: binding.documentId,
        pageId: binding.pageId,
        documentFingerprint: binding.documentFingerprint,
        pageFingerprint: binding.pageFingerprint,
        expectedRevision: 0,
      },
    }, command)).toMatchObject({ status: "succeeded", requestId: "request-capture" });
    expect(() => parseSelectedPageCaptureResponse({
      protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
      requestId: "request-capture",
      status: "succeeded",
    }, command)).toThrow(/capturedTarget/i);
  });

  it("retains the legacy v2 parser without allowing it to masquerade as v3", () => {
    expect(parseVisioSessionCommand({
      protocolVersion: VISIO_SESSION_PROTOCOL_VERSION,
      requestId: "request-v2",
      command: "open",
      session: { tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", workflowId: "workflow-1" },
      outputPath: "C:\\exports\\legacy.vsdx",
    }).protocolVersion).toBe(2);
    expect(() => parseSelectedPageVisioSessionCommand({
      protocolVersion: VISIO_SESSION_PROTOCOL_VERSION,
      requestId: "request-v2",
      command: "open",
      session: { tenantId: "tenant-1", userId: "user-1", deviceId: "device-1", workflowId: "workflow-1" },
      outputPath: "C:\\exports\\legacy.vsdx",
    })).toThrow(/command|attachSelectedPage|applyOwnedRegion/i);
  });

  it("accepts only an attach command bound to one existing selected document and page", () => {
    expect(parseSelectedPageVisioSessionCommand({
      protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
      requestId: "request-1",
      command: "attachSelectedPage",
      binding,
    })).toMatchObject({ command: "attachSelectedPage", binding });
  });

  it("rejects an attach without fingerprints or an expected revision", () => {
    const { pageFingerprint: _pageFingerprint, ...withoutFingerprint } = binding;
    expect(() => parseSelectedPageVisioSessionCommand({
      protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
      requestId: "request-1",
      command: "attachSelectedPage",
      binding: withoutFingerprint,
    })).toThrow(/pageFingerprint/i);
    expect(() => parseSelectedPageVisioSessionCommand({
      protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
      requestId: "request-1",
      command: "attachSelectedPage",
      binding: { ...binding, expectedRevision: -1 },
    })).toThrow(/expectedRevision/i);
  });

  it("rejects output paths, document/page creation, and legacy open commands from v3", () => {
    for (const unsafe of [
      { command: "attachSelectedPage", outputPath: "C:\\exports\\replacement.vsdx" },
      { command: "attachSelectedPage", createDocument: true },
      { command: "attachSelectedPage", createPage: true },
      { command: "open", outputPath: "C:\\exports\\replacement.vsdx" },
    ]) {
      expect(() => parseSelectedPageVisioSessionCommand({
        protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
        requestId: "request-1",
        binding,
        ...unsafe,
      })).toThrow(/unrecognized|command|outputPath|create/i);
    }
  });

  it("requires sealed native intent and matching ownership when applying an owned region", () => {
    expect(() => parseSelectedPageVisioSessionCommand({
      protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
      requestId: "request-1",
      command: "applyOwnedRegion",
      binding,
      ownershipNamespace: binding.ownershipNamespace,
    })).toThrow(/sealedNativeIntent/i);

    expect(() => parseSelectedPageVisioSessionCommand({
      protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
      requestId: "request-1",
      command: "applyOwnedRegion",
      binding,
      ownershipNamespace: "other-region",
      sealedNativeIntent: sealedNativeIntent(),
    })).toThrow(/ownershipNamespace/i);
  });

  it("cryptographically verifies the sealed native intent before accepting applyOwnedRegion", () => {
    const valid = sealedNativeIntent();
    const command = {
      protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
      requestId: "request-verified-apply",
      command: "applyOwnedRegion",
      binding,
      ownershipNamespace: binding.ownershipNamespace,
      sealedNativeIntent: valid,
    };
    const trust = { binding, sealedPlanSecret, now: new Date("2026-08-24T12:00:00.000Z") };

    expect(() => parseSelectedPageVisioSessionCommand(command, trust)).not.toThrow();
    expect(() => parseSelectedPageVisioSessionCommand({
      ...command,
      sealedNativeIntent: { ...valid, signature: "forged-signature" },
    }, trust)).toThrow(/signature|sealed|intent/i);
  });

  it("rejects a selected-page response that cannot prove its binding and ownership separation", () => {
    expect(() => parseSelectedPageVisioSessionResponse({
      protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
      requestId: "request-1",
      status: "succeeded",
      selectedPage: { ...binding, pageId: "different-page" },
    }, binding, attachCommand())).toThrow(/pageId|binding/i);

    expect(() => parseSelectedPageVisioSessionResponse({
      protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
      requestId: "request-1",
      status: "succeeded",
      selectedPage: binding,
      readback: {
        valid: true,
        documentId: binding.documentId,
        pageId: binding.pageId,
        documentFingerprint: binding.documentFingerprint,
        pageFingerprint: binding.pageFingerprint,
        expectedRevision: binding.expectedRevision,
        ownershipNamespace: binding.ownershipNamespace,
        userOwnedShapeCount: 2,
        agentOwnedShapes: [{ nativeShapeId: "shape-1", ownershipNamespace: "other-region", sourceMappingSemanticIds: ["semantic-1"] }],
        unclassifiedShapeCount: 0,
      },
    }, binding, attachCommand())).toThrow(/namespace/i);
  });

  it("requires readback evidence for a successful response to readSelectedPage", () => {
    const readCommand = {
      protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
      requestId: "request-read",
      command: "readSelectedPage" as const,
      binding,
    };

    expect(() => parseSelectedPageVisioSessionResponse({
      protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
      requestId: "request-read",
      status: "succeeded",
      selectedPage: binding,
    }, binding, readCommand)).toThrow(/readback|readSelectedPage/i);
  });
});
