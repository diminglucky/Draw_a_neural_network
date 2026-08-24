import type { FigureAnalysisResult } from "../../src/publication-figure-agent.js";
import { parseCanonicalNetworkIR } from "../../src/network-ir-v2.js";

export function structuralCnnCanonicalIr() {
  return parseCanonicalNetworkIR({
    version: 2,
    figure: { id: "structural-cnn", title: "Spatial classifier topology", description: null },
    tensors: [
      { id: "input-activation", name: "input", shape: [96, 96, 3], axes: ["height", "width", "channel"], semanticRole: "activation", dtype: "float32", producerNodeId: "input", consumerNodeIds: ["conv-1"] },
      { id: "conv-1-activation", name: "stage one", shape: [96, 96, 24], axes: ["height", "width", "channel"], semanticRole: "activation", dtype: "float32", producerNodeId: "conv-1", consumerNodeIds: ["pool-1"] },
      { id: "pool-1-activation", name: "reduced stage", shape: [48, 48, 24], axes: ["height", "width", "channel"], semanticRole: "activation", dtype: "float32", producerNodeId: "pool-1", consumerNodeIds: ["conv-2"] },
      { id: "conv-2-activation", name: "stage two", shape: [48, 48, 48], axes: ["height", "width", "channel"], semanticRole: "activation", dtype: "float32", producerNodeId: "conv-2", consumerNodeIds: ["classifier"] },
      { id: "logits", name: "logits", shape: [4], axes: ["feature"], semanticRole: "logits", dtype: "float32", producerNodeId: "classifier", consumerNodeIds: ["output"] },
    ],
    nodes: [
      { id: "input", op: "input", inputTensorIds: [], outputTensorIds: ["input-activation"], confidence: 1, sourceEvidenceIds: ["fact-input"], repeats: null },
      { id: "conv-1", op: "conv2d", inputTensorIds: ["input-activation"], outputTensorIds: ["conv-1-activation"], confidence: 0.95, sourceEvidenceIds: ["fact-conv"], repeats: { count: 1, unitNodeIds: ["conv-1"] } },
      { id: "pool-1", op: "pool", inputTensorIds: ["conv-1-activation"], outputTensorIds: ["pool-1-activation"], confidence: 0.95, sourceEvidenceIds: ["fact-pool"], repeats: null },
      { id: "conv-2", op: "conv2d", inputTensorIds: ["pool-1-activation"], outputTensorIds: ["conv-2-activation"], confidence: 0.95, sourceEvidenceIds: ["fact-conv"], repeats: { count: 2, unitNodeIds: ["conv-2"] } },
      { id: "classifier", op: "classifier", inputTensorIds: ["conv-2-activation"], outputTensorIds: ["logits"], confidence: 0.95, sourceEvidenceIds: ["fact-classifier"], repeats: null },
      { id: "output", op: "output", inputTensorIds: ["logits"], outputTensorIds: [], confidence: 1, sourceEvidenceIds: ["fact-output"], repeats: null },
    ],
    edges: [
      { id: "edge-input-conv-1", sourceNodeId: "input", targetNodeId: "conv-1", relation: "data", tensorIds: ["input-activation"], confidence: 1, evidenceIds: ["fact-input"] },
      { id: "edge-conv-1-pool-1", sourceNodeId: "conv-1", targetNodeId: "pool-1", relation: "data", tensorIds: ["conv-1-activation"], confidence: 0.95, evidenceIds: ["fact-pool"] },
      { id: "edge-pool-1-conv-2", sourceNodeId: "pool-1", targetNodeId: "conv-2", relation: "data", tensorIds: ["pool-1-activation"], confidence: 0.95, evidenceIds: ["fact-conv"] },
      { id: "edge-conv-2-classifier", sourceNodeId: "conv-2", targetNodeId: "classifier", relation: "data", tensorIds: ["conv-2-activation"], confidence: 0.95, evidenceIds: ["fact-classifier"] },
      { id: "edge-classifier-output", sourceNodeId: "classifier", targetNodeId: "output", relation: "data", tensorIds: ["logits"], confidence: 1, evidenceIds: ["fact-output"] },
    ],
    groups: [
      { id: "group-conv-1", label: "spatial stage one", nodeIds: ["conv-1"], confidence: 0.95, sourceEvidenceIds: ["fact-conv"] },
      { id: "group-conv-2", label: "spatial stage two", nodeIds: ["conv-2"], confidence: 0.95, sourceEvidenceIds: ["fact-conv"] },
    ],
    unresolved: [],
  });
}

export function readyStructuralCnnFigureAnalysis(): FigureAnalysisResult {
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
      source: { sourceId: "source-structural-model", kind: "code" as const, name: "model.py" },
    })),
    canonicalNetworkIR: structuralCnnCanonicalIr(),
    blockingQuestions: [],
    warnings: [],
    readyForVisio: false,
  };
}

export function structuralCnnAnalysisNeedsConfirmation(): FigureAnalysisResult {
  return {
    ...readyStructuralCnnFigureAnalysis(),
    status: "needs_confirmation",
    blockingQuestions: [{ id: "scale-transition", question: "Which operation performs this spatial scale transition?", candidateValues: ["pool", "stride"] }],
  };
}
