import { describe, expect, it, vi } from "vitest";
import { createLocalDeterministicAgentProvider, type AnalysisProposalInput } from "../src/adapters.js";
import { ApiErrorCode } from "../src/domain.js";

async function loadPublicationFigureAgent() {
  return import("../src/publication-figure-agent.js");
}

function baseInput(message: string) {
  return {
    userId: "user-1",
    conversationId: "conv-1",
    message,
    attachments: [],
    draftRef: null,
  };
}

function evidenceFact() {
  return {
    id: "fact-message",
    subject: "request",
    predicate: "architecture",
    value: "input to output",
    confidence: 0.9,
    source: { sourceId: "source-text-1", kind: "text" as const, locator: null, excerpt: null },
  };
}

function clearProposal() {
  const sourceEvidence = [{ type: "text" as const, value: "request", locator: null, excerpt: null }];
  const nodes = [
    { id: "input", kind: "input", label: "Input", stage: 0, confidence: 0.95, sourceEvidence },
    { id: "conv", kind: "conv", label: "Conv2d", stage: 1, confidence: 0.9, sourceEvidence },
    { id: "pool", kind: "pool", label: "MaxPool2d", stage: 2, confidence: 0.9, sourceEvidence },
    { id: "dense", kind: "dense", label: "Linear", stage: 3, confidence: 0.9, sourceEvidence },
    { id: "output", kind: "output", label: "Output", stage: 4, confidence: 0.95, sourceEvidence },
  ];
  return {
    provider: "local-deterministic" as const,
    responseText: "Clear CNN proposal.",
    summary: "A linear CNN structure was identified.",
    overallConfidence: 0.9,
    taskIntentSuggestion: {},
    evidence: [evidenceFact()],
    networkCandidate: {
      figure: { id: "cnn", title: "CNN", description: null },
      nodes,
      edges: nodes.slice(0, -1).map((node, index) => ({
        source: node.id,
        target: nodes[index + 1]!.id,
        kind: "flow",
        confidence: 0.9,
        sourceEvidence,
      })),
      groups: [],
    },
    unresolved: [],
    figureIntentSuggestion: {},
    warnings: [],
  };
}

function ambiguousProposal() {
  const sourceEvidence = [{ type: "text" as const, value: "request", locator: null, excerpt: null }];
  return {
    provider: "local-deterministic" as const,
    responseText: "Ambiguous merge needs confirmation.",
    summary: "Two merge interpretations remain.",
    overallConfidence: 0.5,
    taskIntentSuggestion: {},
    evidence: [evidenceFact()],
    networkCandidate: {
      figure: { id: "encoder-decoder", title: "Encoder decoder", description: null },
      nodes: [
        { id: "input-a", kind: "input", label: "Input A", stage: 0, confidence: 0.9, sourceEvidence },
        { id: "input-b", kind: "input", label: "Input B", stage: 0, confidence: 0.9, sourceEvidence },
        { id: "merge-1", kind: "add", label: "Merge", stage: 1, confidence: 0.5, sourceEvidence },
        { id: "output", kind: "output", label: "Output", stage: 2, confidence: 0.9, sourceEvidence },
      ],
      edges: [
        { source: "input-a", target: "merge-1", kind: "flow", confidence: 0.9, sourceEvidence },
        { source: "input-b", target: "merge-1", kind: "flow", confidence: 0.9, sourceEvidence },
        { source: "merge-1", target: "output", kind: "flow", confidence: 0.9, sourceEvidence },
      ],
      groups: [],
    },
    unresolved: [
      {
        id: "unresolved-merge",
        question: "Is merge-1 Add or Concat?",
        severity: "blocking" as const,
        candidateValues: ["add", "concat"],
        evidenceIds: ["fact-message"],
      },
      {
        id: "unresolved-direction",
        question: "Which direction does the second branch flow?",
        severity: "blocking" as const,
        candidateValues: ["into merge-1", "out of merge-1"],
        evidenceIds: ["fact-message"],
      },
    ],
    figureIntentSuggestion: {},
    warnings: ["Merge operation is unresolved."],
  };
}

describe("PublicationFigureAgent", () => {
  it("marks a clear code-derived CNN ready for preview after structure validation", async () => {
    const { PublicationFigureAgent } = await loadPublicationFigureAgent();
    const agent = new PublicationFigureAgent({ provider: createLocalDeterministicAgentProvider() });

    const result = await agent.analyze(baseInput("Analyze this CNN with Conv2d, MaxPool2d and Linear."));

    expect(result).toMatchObject({
      status: "ready_for_preview",
      readyForVisio: false,
      taskIntent: { action: "analyze_network" },
      canonicalNetworkIR: { version: 2 },
      blockingQuestions: [],
    });
  });

  it("creates stable source metadata before calling the provider", async () => {
    const { PublicationFigureAgent } = await loadPublicationFigureAgent();
    const buildAnalysisProposal = vi.fn(async (_input: AnalysisProposalInput) => clearProposal());
    const agent = new PublicationFigureAgent({ provider: { buildAnalysisProposal } });

    await agent.analyze({
      ...baseInput("Analyze the supplied model."),
      attachments: [
        { kind: "code", name: "model.py", mimeType: "text/x-python", data: "nn.Conv2d(3, 16, 3)" },
        { kind: "image", name: "sketch.png", mimeType: "image/png", data: "aW1hZ2U=" },
      ],
    });

    expect(buildAnalysisProposal).toHaveBeenCalledTimes(1);
    expect(buildAnalysisProposal.mock.calls[0]![0]).toMatchObject({
      taskIntent: { action: "analyze_network", sourceMode: "mixed" },
      evidenceSources: [
        { id: "source-text-1", kind: "text", name: "User request" },
        { id: "source-attachment-1", kind: "code", name: "model.py" },
        { id: "source-attachment-2", kind: "image", name: "sketch.png" },
      ],
    });
  });

  it("returns only the first blocking question and never marks an ambiguous merge ready", async () => {
    const { PublicationFigureAgent } = await loadPublicationFigureAgent();
    const agent = new PublicationFigureAgent({
      provider: { async buildAnalysisProposal() { return ambiguousProposal(); } },
    });

    const result = await agent.analyze(baseInput("Draw from this sketch."));

    expect(result.status).toBe("needs_confirmation");
    expect(result.blockingQuestions).toEqual([{
      id: "unresolved-merge",
      question: "Is merge-1 Add or Concat?",
      candidateValues: ["add", "concat"],
    }]);
    expect(result.canonicalNetworkIR.version).toBe(2);
    expect(result.readyForVisio).toBe(false);
  });

  it("derives one Add or Concat confirmation from a low-confidence merge without provider unresolved items", async () => {
    const { PublicationFigureAgent } = await loadPublicationFigureAgent();
    const agent = new PublicationFigureAgent({
      provider: {
        async buildAnalysisProposal() {
          return { ...ambiguousProposal(), unresolved: [] };
        },
      },
    });

    const result = await agent.analyze(baseInput("Draw this encoder decoder."));

    expect(result).toMatchObject({
      status: "needs_confirmation",
      readyForVisio: false,
      blockingQuestions: [{
        id: "derived-node-3-merge-kind",
        question: "Is this merge an Add or Concat operation?",
        candidateValues: ["add", "concat"],
      }],
    });
    expect(result.blockingQuestions).toHaveLength(1);
  });

  it("converts an invalid provider candidate into a safe validation failure", async () => {
    const { PublicationFigureAgent } = await loadPublicationFigureAgent();
    const invalidCandidateAgent = new PublicationFigureAgent({
      provider: {
        async buildAnalysisProposal() {
          const proposal = clearProposal();
          return {
            ...proposal,
            networkCandidate: {
              figure: { id: "invalid", title: "Invalid", description: null },
              nodes: [{ id: "only", kind: "arbitrary-provider-op", label: "Unknown", stage: 0, confidence: 0.9, sourceEvidence: [] }],
              edges: [],
              groups: [],
            },
          };
        },
      },
    });

    await expect(invalidCandidateAgent.analyze(baseInput("Analyze model"))).rejects.toMatchObject({
      code: ApiErrorCode.VALIDATION_FAILED,
      statusCode: 502,
      details: { figureAnalysisCode: ApiErrorCode.FIGURE_ANALYSIS_INVALID },
    });
  });
});
