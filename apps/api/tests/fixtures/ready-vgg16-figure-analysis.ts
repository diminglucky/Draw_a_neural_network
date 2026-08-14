import type { FigureAnalysisResult } from "../../src/publication-figure-agent.js";
import { vgg16CanonicalIr } from "./vgg16-canonical-ir.js";

export function readyVgg16FigureAnalysis(): FigureAnalysisResult {
  return {
    status: "ready_for_preview",
    taskIntent: {
      action: "create_figure",
      sourceMode: "code",
      requestedArtifact: "paper_overview",
      referencesDraftId: null,
      userConstraints: { orientation: "landscape", density: "standard", printMode: "color", requiresNativeVisio: false },
    },
    evidence: ["input", "conv", "pool", "classifier", "output"].map((name) => ({
      id: `fact-${name}`,
      subject: name,
      predicate: "architecture_fact",
      value: name,
      confidence: 0.95,
      source: { sourceId: "source-model", kind: "code" as const, name: "model.py" },
    })),
    canonicalNetworkIR: vgg16CanonicalIr(),
    blockingQuestions: [],
    warnings: [],
    readyForVisio: false,
  };
}

export function vgg16AnalysisNeedsConfirmation(): FigureAnalysisResult {
  return {
    ...readyVgg16FigureAnalysis(),
    status: "needs_confirmation",
    blockingQuestions: [{ id: "pool-kind", question: "Is the transition max pooling or average pooling?", candidateValues: ["max", "average"] }],
  };
}
