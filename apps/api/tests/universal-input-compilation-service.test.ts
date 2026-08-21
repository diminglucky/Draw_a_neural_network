import { describe, expect, it } from "vitest";
import { compileUniversalInputToPublicationPreview } from "../src/universal-input-compilation-service.js";

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
    const result = compileUniversalInputToPublicationPreview({
      kind: "static-pytorch",
      sourceId: "static-source",
      sourceSha256: "a".repeat(64),
      code: [
        'raise RuntimeError("static source must not execute")',
        "class Chain(nn.Module):",
        " def __init__(self):",
        "  self.projection = nn.Conv2d(3, 8, 1)",
        " def forward(self, x):",
        "  return self.projection(x)",
      ].join("\n"),
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
});
