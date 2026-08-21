import { describe, expect, it } from "vitest";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { compilePromptToUniversalGraphSpec } from "../src/prompt-universal-graph-spec.js";
import { compilePublicationVisualPlan } from "../src/publication-visual-plan-compiler.js";
import { compilePublicationVisualPlanToNativeIntent } from "../src/publication-visual-plan-native-intent.js";
import { promotePublicationVisualPlanAfterTrustedReview } from "../src/publication-visual-plan-qa-promotion.js";
import { compileStaticPyTorchSourceToUniversalGraphSpec } from "../src/static-pytorch-universal-graph-spec.js";

const updateIdentity = { ownerId: "owner-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 };

function compilePlan(ugs: ReturnType<typeof compilePromptToUniversalGraphSpec>) {
  const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
  return compilePublicationVisualPlan({ ugs, graph, updateIdentity });
}

function approvedNativeIntent(ugs: ReturnType<typeof compilePromptToUniversalGraphSpec>) {
  const pending = compilePlan(ugs);
  const promoted = promotePublicationVisualPlanAfterTrustedReview({
    plan: pending,
    review: { authority: "trusted-human", reviewerId: "reviewer-1", reviewedAt: "2026-08-21T00:00:00.000Z", approval: "approved", expectedPlanHash: pending.identity.canonicalHash },
  });
  return compilePublicationVisualPlanToNativeIntent(promoted.plan);
}

function formalPrompt() {
  return JSON.stringify({
    graphId: "prompt-chain",
    topology: "complete",
    nodes: [
      { nodeId: "input", kind: "input", label: "Input", inputPorts: [], outputPorts: [{ portId: "out" }] },
      { nodeId: "block", kind: "operator", label: "Novel Block", operation: "novel_mixer", inputPorts: [{ portId: "in" }], outputPorts: [{ portId: "out" }] },
      { nodeId: "output", kind: "output", label: "Output", inputPorts: [{ portId: "in" }], outputPorts: [] },
    ],
    edges: [
      { edgeId: "input-block", sourcePortId: "input:out", targetPortId: "block:in" },
      { edgeId: "block-output", sourcePortId: "block:out", targetPortId: "output:in" },
    ],
  });
}

describe("input adapter publication chain", () => {
  it("carries a formal prompt declaration with an unseen operator to approved native intent", () => {
    const ugs = compilePromptToUniversalGraphSpec({ sourceId: "prompt-chain-source", prompt: formalPrompt() });
    const intent = approvedNativeIntent(ugs);

    expect(ugs.nodes.find((node) => node.nodeId === "block")).toMatchObject({ kind: "custom_operator", operationKnowledge: "custom" });
    expect(intent.primitives).toHaveLength(3);
    expect(intent.connectors).toHaveLength(2);
  });

  it("carries a provable static PyTorch path to approved native intent without executing source", () => {
    const sideEffectKey = "__inputAdapterPublicationChainExecuted";
    const globals = globalThis as Record<string, unknown>;
    globals[sideEffectKey] = false;

    try {
      const ugs = compileStaticPyTorchSourceToUniversalGraphSpec({
        sourceId: "static-chain-source",
        sourceSha256: "c".repeat(64),
        code: [
          "globalThis.__inputAdapterPublicationChainExecuted = true",
          "class Chain(nn.Module):",
          " def __init__(self):",
          "  self.conv = nn.Conv2d(3, 16, 3)",
          " def forward(self, x):",
          "  return self.conv(x)",
        ].join("\n"),
      });
      const intent = approvedNativeIntent(ugs);

      expect(globals[sideEffectKey]).toBe(false);
      expect(intent.primitives).toHaveLength(3);
      expect(intent.connectors).toHaveLength(2);
    } finally {
      delete globals[sideEffectKey];
    }
  });

  it("blocks ambiguous prompt and dynamic static source before native intent", () => {
    const ambiguousPrompt = compilePromptToUniversalGraphSpec({
      sourceId: "ambiguous-prompt-source",
      prompt: JSON.stringify({ graphId: "ambiguous-prompt", topology: "ambiguous", nodes: [{ nodeId: "input", kind: "input", label: "Input", inputPorts: [], outputPorts: [{ portId: "out" }] }], edges: [] }),
    });
    const dynamicSource = compileStaticPyTorchSourceToUniversalGraphSpec({
      sourceId: "dynamic-static-source",
      sourceSha256: "d".repeat(64),
      code: ["class Dynamic(nn.Module):", " def forward(self, x):", "  if x.sum() > 0:", "   return x", "  return -x"].join("\n"),
    });

    expect(() => compilePublicationVisualPlanToNativeIntent(compilePlan(ambiguousPrompt))).toThrow(/formal/i);
    expect(() => compilePublicationVisualPlanToNativeIntent(compilePlan(dynamicSource))).toThrow(/formal/i);
  });
});
