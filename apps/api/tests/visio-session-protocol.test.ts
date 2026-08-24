import { describe, expect, it } from "vitest";
import {
  SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
  VISIO_SESSION_PROTOCOL_VERSION,
  parseVisioSessionCommand,
  parseSelectedPageVisioSessionCommand,
  parseSelectedPageVisioSessionResponse,
} from "../src/visio-session-protocol.js";

const binding = {
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

describe("selected-current-page Visio session protocol", () => {
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
      sealedNativeIntent: {
        intentId: "intent-1",
        planId: "plan-1",
        planHash: "c".repeat(64),
        documentId: binding.documentId,
        pageId: binding.pageId,
        expectedRevision: binding.expectedRevision,
        ownershipNamespace: binding.ownershipNamespace,
        signature: "signed-intent",
      },
    })).toThrow(/ownershipNamespace/i);
  });

  it("rejects a selected-page response that cannot prove its binding and ownership separation", () => {
    expect(() => parseSelectedPageVisioSessionResponse({
      protocolVersion: SELECTED_PAGE_VISIO_SESSION_PROTOCOL_VERSION,
      requestId: "request-1",
      status: "succeeded",
      selectedPage: { ...binding, pageId: "different-page" },
    }, binding)).toThrow(/pageId|binding/i);

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
    }, binding)).toThrow(/namespace/i);
  });
});
