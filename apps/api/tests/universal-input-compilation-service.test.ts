import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { InterpreterProposal } from "../src/architecture-interpretation-contract.js";
import { compileArchitectureDescriptionWithInterpreter, compileUniversalInputToPublicationPreview } from "../src/universal-input-compilation-service.js";

const options = {
  detail: "architecture" as const,
  updateIdentity: {
    ownerId: "owner-1",
    deviceId: "device-1",
    workflowId: "workflow-1",
    documentId: "document-1",
    pageId: "page-1",
    expectedRevision: 1,
  },
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function completeUnknownOperatorPrompt(): string {
  return JSON.stringify({
    graphId: "unknown-operator-prompt",
    topology: "complete",
    nodes: [
      { nodeId: "input", kind: "input", label: "Image", inputPorts: [], outputPorts: [{ portId: "out" }] },
      { nodeId: "mixer", kind: "operator", label: "Spectral Mixer", operation: "spectral_mixer", inputPorts: [{ portId: "in" }], outputPorts: [{ portId: "out" }] },
      { nodeId: "output", kind: "output", label: "Prediction", inputPorts: [{ portId: "in" }], outputPorts: [] },
    ],
    edges: [
      { edgeId: "input-mixer", sourcePortId: "input:out", targetPortId: "mixer:in" },
      { edgeId: "mixer-output", sourcePortId: "mixer:out", targetPortId: "output:in" },
    ],
  });
}

function architectureDescriptionInput(proposal: unknown = architectureDescriptionProposal()) {
  return {
    kind: "architecture-description" as const,
    request: {
      requestId: "description-request",
      evidence: [{
        evidenceId: "e-description",
        sourceId: "public-description",
        sourceHash: sha256("public description"),
        locator: "section:architecture",
        excerptDigest: sha256("custom spectral mixer"),
      }],
      detail: "architecture" as const,
      maxNodes: 8,
      maxEdges: 8,
    },
    proposal,
  };
}

function architectureDescriptionProposal(): InterpreterProposal {
  return {
    version: 1,
    nodes: [
      { nodeId: "input", kind: "input", label: "Image", inputPortIds: [], outputPortIds: ["input:out"], evidenceIds: ["e-description"] },
      { nodeId: "spectral", kind: "operator", label: "Spectral mixer", operation: "spectral_mixer", inputPortIds: ["spectral:in"], outputPortIds: ["spectral:out"], evidenceIds: ["e-description"] },
      { nodeId: "output", kind: "output", label: "Prediction", inputPortIds: ["output:in"], outputPortIds: [], evidenceIds: ["e-description"] },
    ],
    ports: [
      { portId: "input:out", nodeId: "input", direction: "output", evidenceIds: ["e-description"] },
      { portId: "spectral:in", nodeId: "spectral", direction: "input", evidenceIds: ["e-description"] },
      { portId: "spectral:out", nodeId: "spectral", direction: "output", evidenceIds: ["e-description"] },
      { portId: "output:in", nodeId: "output", direction: "input", evidenceIds: ["e-description"] },
    ],
    edges: [
      { edgeId: "input-spectral", sourcePortId: "input:out", targetPortId: "spectral:in", evidenceIds: ["e-description"] },
      { edgeId: "spectral-output", sourcePortId: "spectral:out", targetPortId: "output:in", evidenceIds: ["e-description"] },
    ],
    unresolved: [],
  };
}

describe("compileUniversalInputToPublicationPreview", () => {
  it("compiles a complete typed declaration containing an unknown operator through the formal shared preview path", () => {
    const result = compileUniversalInputToPublicationPreview({
      kind: "typed-prompt",
      sourceId: "prompt-source",
      prompt: completeUnknownOperatorPrompt(),
    }, options);

    expect(result.kind).toBe("formal");
    expect(result.ugs.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: "mixer", kind: "custom_operator", operationKnowledge: "custom" }),
    ]));
    expect(result.graph.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "custom_operator", sourceNodeIds: ["mixer"] }),
    ]));
    expect(result.pvp.eligibility.kind).toBe("formal");
    expect(result.exportEligible).toBe(false);
  });

  it("compiles a provable static PyTorch path without executing the submitted source", () => {
    const code = [
      'raise RuntimeError("static source must not execute")',
      "class Chain(nn.Module):",
      " def __init__(self):",
      "  self.projection = nn.Conv2d(3, 8, 1)",
      " def forward(self, x):",
      "  return self.projection(x)",
    ].join("\n");
    const result = compileUniversalInputToPublicationPreview({
      kind: "static-pytorch",
      sourceId: "static-source",
      sourceSha256: sha256(code),
      code,
    }, options);

    expect(result.kind).toBe("formal");
    expect(result.pvp.eligibility.kind).toBe("formal");
  });

  it("keeps ambiguous prompt topology candidate-only and export-ineligible", () => {
    const result = compileUniversalInputToPublicationPreview({
      kind: "typed-prompt",
      sourceId: "ambiguous-prompt-source",
      prompt: JSON.stringify({
        graphId: "ambiguous-prompt",
        topology: "ambiguous",
        nodes: [{ nodeId: "input", kind: "input", label: "Input", inputPorts: [], outputPorts: [{ portId: "out" }] }],
        edges: [],
      }),
    }, options);

    expect(result.kind).toBe("candidate");
    expect(result.exportEligible).toBe(false);
    expect(result.pvp.eligibility.kind).toBe("candidate");
  });

  it("compiles only an explicitly evidenced unfamiliar architecture proposal and carries safe lineage hashes", () => {
    const result = compileUniversalInputToPublicationPreview(architectureDescriptionInput(), options);

    expect(result.kind).toBe("formal");
    expect(result.ugs.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: "spectral", kind: "custom_operator" }),
    ]));
    expect(result.interpretation).toMatchObject({
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      proposalHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      evidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      errorCategory: "none",
    });
    expect(result).not.toHaveProperty("rawSource");
    expect(result).not.toHaveProperty("imageBytes");
  });

  it("keeps an unavailable or invalid interpreter result clarification-only without creating native or renderer intent", () => {
    const unavailable = compileUniversalInputToPublicationPreview({ ...architectureDescriptionInput(), proposal: undefined }, options);
    const invalid = compileUniversalInputToPublicationPreview({ ...architectureDescriptionInput(), proposal: { ...architectureDescriptionProposal(), comCommand: "x" } }, options);

    expect(unavailable.kind).toBe("candidate");
    expect(unavailable.ugs.unresolved).toEqual([expect.objectContaining({ scope: "topology", severity: "blocking" })]);
    expect(invalid.kind).toBe("candidate");
    expect(invalid.ugs.nodes).toEqual([expect.objectContaining({ kind: "container" })]);
    expect(unavailable.interpretation).toMatchObject({ errorCategory: "unavailable" });
    expect(invalid.interpretation).toMatchObject({ errorCategory: "invalid" });
    expect(invalid).not.toHaveProperty("snapshot");
    expect(invalid).not.toHaveProperty("nativeIntent");
    expect(invalid).not.toHaveProperty("worker");
  });

  it("runs an architecture interpreter through the bounded asynchronous path and retains timeout as a clarification", async () => {
    const formal = await compileArchitectureDescriptionWithInterpreter({
      request: architectureDescriptionInput().request,
      interpreter: { propose: async () => architectureDescriptionProposal() },
    }, options);
    const timedOut = await compileArchitectureDescriptionWithInterpreter({
      request: architectureDescriptionInput().request,
      interpreter: { propose: async () => new Promise(() => {}) },
      timeoutMilliseconds: 1,
    }, options);

    expect(formal).toMatchObject({ kind: "formal", interpretation: { errorCategory: "none" } });
    expect(timedOut).toMatchObject({ kind: "candidate", interpretation: { errorCategory: "timeout" } });
    expect(timedOut.ugs.unresolved).toEqual([expect.objectContaining({ id: "description-request:interpreter-unavailable" })]);
  });
});
