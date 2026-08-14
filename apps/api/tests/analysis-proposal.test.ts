import { describe, expect, it, vi } from "vitest";
import { parseAnalysisProposal, proposalEvidenceBundle } from "../src/analysis-proposal.js";
import { createOpenAIResponsesAgentProvider } from "../src/adapters.js";

function validCandidate() {
  return {
    figure: { id: "figure-1", title: "Classifier", description: null },
    nodes: [
      { id: "input", kind: "input", label: "Input", stage: 0, confidence: 0.9, sourceEvidence: [] },
      { id: "output", kind: "output", label: "Output", stage: 1, confidence: 0.9, sourceEvidence: [] },
    ],
    edges: [{ source: "input", target: "output", kind: "flow", skip: false, confidence: 0.9, sourceEvidence: [] }],
    groups: [],
  };
}

function validProviderProposal() {
  return {
    provider: "openai-responses",
    responseText: "A two-node classifier was identified.",
    summary: "Analysis proposal ready for deterministic validation.",
    overallConfidence: 0.8,
    taskIntentSuggestion: {},
    evidence: [{
      id: "fact-message",
      subject: "request",
      predicate: "architecture",
      value: "two-node classifier",
      confidence: 0.8,
      source: { sourceId: "source-message", kind: "text", locator: null, excerpt: null },
    }],
    networkCandidate: validCandidate(),
    unresolved: [],
    figureIntentSuggestion: {},
    warnings: [],
  };
}

function baseProviderInput() {
  return {
    userId: "user-1",
    conversationId: "proposal-1",
    message: "Analyze input to output.",
    attachments: [],
    taskIntent: {
      action: "analyze_network" as const,
      sourceMode: "text" as const,
      requestedArtifact: "structure_only" as const,
      referencesDraftId: null,
      userConstraints: { orientation: "auto" as const, density: "standard" as const, printMode: "auto" as const, requiresNativeVisio: false },
    },
    evidenceSources: [{ id: "source-message", kind: "text" as const, name: "User request" }],
  };
}

describe("analysis proposal", () => {
  it("rejects provider output that attempts to specify figure geometry or Visio execution", () => {
    expect(() => parseAnalysisProposal({
      ...validProviderProposal(),
      primitiveIds: ["illegal"],
    })).toThrow(/primitiveIds|unrecognized/i);

    expect(() => parseAnalysisProposal({
      ...validProviderProposal(),
      networkCandidate: { ...validCandidate(), x: 42 },
    })).toThrow(/geometry|x/i);
  });

  it("rejects scalar and arbitrary network candidates before later IR parsing", () => {
    expect(() => parseAnalysisProposal({
      ...validProviderProposal(),
      networkCandidate: "input -> output",
    })).toThrow(/object|candidate/i);

    expect(() => parseAnalysisProposal({
      ...validProviderProposal(),
      networkCandidate: { ...validCandidate(), svgContent: "<svg />" },
    })).toThrow(/unrecognized|svgContent/i);
  });

  it("rejects unsafe provider-controlled text across proposal fields", () => {
    expect(() => parseAnalysisProposal({
      ...validProviderProposal(),
      responseText: "data:text/plain;base64,AAAA",
    })).toThrow(/forbidden|payload|transport/i);

    expect(() => parseAnalysisProposal({
      ...validProviderProposal(),
      evidence: [{
        ...validProviderProposal().evidence[0],
        source: { ...validProviderProposal().evidence[0].source, locator: "C:\\output\\figure.vsdx" },
      }],
      warnings: ["Run shellCommand: powershell -c whoami"],
      figureIntentSuggestion: { purpose: "<svg onload=alert(1)>" },
    })).toThrow(/forbidden|payload|command|path/i);
  });

  it("builds an evidence bundle only when proposal evidence matches supplied sources", () => {
    const proposal = parseAnalysisProposal(validProviderProposal());
    expect(proposalEvidenceBundle(proposal, baseProviderInput().evidenceSources)).toMatchObject({
      version: 1,
      sources: [{ id: "source-message" }],
      facts: [{ id: "fact-message" }],
    });
  });

  it("requests a strict analysis proposal schema and omits legacy drawing fields", async () => {
    let requestBody: any;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? "{}"));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(validProviderProposal()) }] }],
        }),
      };
    });
    const provider = createOpenAIResponsesAgentProvider({ apiKey: "test", fetchImpl });

    await provider.buildAnalysisProposal(baseProviderInput());

    expect(requestBody.store).toBe(false);
    expect(requestBody.tools).toBeUndefined();
    expect(requestBody.text.format.name).toBe("analysis_proposal");
    expect(JSON.stringify(requestBody.text.format.schema)).not.toContain("visualRole");
    expect(JSON.stringify(requestBody.text.format.schema)).not.toContain("outputPath");
    expect(JSON.stringify(requestBody.instructions)).toMatch(/Do not return.*COM/i);
  });
});
