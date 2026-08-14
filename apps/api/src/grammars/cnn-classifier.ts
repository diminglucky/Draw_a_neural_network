import type { FigureIntent } from "../figure-intent.js";
import { parseFigureSemanticModel, type FigureSemanticModel, type FigureSourceMapping } from "../figure-semantic-model.js";
import type { FigureGrammar, GrammarScore } from "../grammar-registry.js";
import { parsePublicationFigurePlanV2, type PublicationFigurePlanV2 } from "../publication-figure-plan-v2.js";
import { parseCanonicalNetworkIR, type CanonicalNetworkIR } from "../network-ir-v2.js";
import { runVisualQa } from "../visual-qa.js";

interface CompilableCnnGrammar extends FigureGrammar {
  compileSemanticModel(ir: CanonicalNetworkIR, intent: FigureIntent): FigureSemanticModel;
  compilePlan(model: FigureSemanticModel, intent: FigureIntent): PublicationFigurePlanV2;
}

export const cnnClassifierGrammar: CompilableCnnGrammar = {
  id: "cnn-classifier",
  version: 1,
  evaluate(ir, _intent): GrammarScore {
    const convolutionStages = ir.nodes.filter((node) => node.op === "conv2d" || node.op === "depthwise_conv2d");
    const tensorStages = convolutionStages.filter((node) => node.outputTensorIds.some((id) => hasSpatialTensor(ir, id)));
    const residualCount = ir.edges.filter((edge) => edge.relation === "residual").length + ir.nodes.filter((node) => node.op === "add").length;
    const hasClassifier = ir.nodes.some((node) => node.op === "classifier" || node.op === "dense");
    const hasPooling = ir.nodes.some((node) => node.op === "pool");
    const hasInput = ir.nodes.some((node) => node.op === "input");
    const reasons: string[] = [];
    if (tensorStages.length >= 2) reasons.push("multiple spatial convolution stages");
    if (hasPooling) reasons.push("downsampling stages are present");
    if (hasClassifier) reasons.push("classifier tail is present");
    if (residualCount > 0) reasons.push("residual semantics reduce linear CNN suitability");
    const score = Math.max(0, Math.min(0.96, (tensorStages.length >= 2 ? 0.55 : 0.1) + (hasPooling ? 0.15 : 0) + (hasClassifier ? 0.2 : 0) - (residualCount > 0 ? 0.55 : 0)));
    const blockers = [
      ...(tensorStages.length === 0 ? ["requires at least one spatial convolution stage"] : []),
      ...(!hasInput ? ["requires an input node"] : []),
      ...(!hasClassifier ? ["requires a classifier tail"] : []),
    ];
    return { grammarId: "cnn-classifier", score, reasons, blockers };
  },
  compileSemanticModel(ir, intent) {
    parseCanonicalNetworkIR(ir, undefined, { renderReady: true });
    const convolutionStages = ir.nodes.filter((node) => (node.op === "conv2d" || node.op === "depthwise_conv2d") && node.outputTensorIds.some((id) => hasSpatialTensor(ir, id)));
    const classifierNodes = ir.nodes.filter((node) => node.op === "flatten" || node.op === "dense" || node.op === "classifier" || node.op === "output");
    if (convolutionStages.length === 0 || classifierNodes.length === 0) throw new Error("cnn-classifier requires convolution stages and a classifier tail");
    const input = ir.nodes.find((node) => node.op === "input");
    if (!input) throw new Error("cnn-classifier requires an input node");

    const displayNodes: FigureSemanticModel["displayNodes"] = [{ id: "input-stage", role: "input", label: "Input", summary: tensorLabel(ir, input.outputTensorIds[0]), semantic: { stage: 0 } }];
    const sourceMappings: FigureSourceMapping[] = [mappingFor(ir, "input-stage", [input.id])];
    for (const [index, stage] of convolutionStages.entries()) {
      const tensorId = stage.outputTensorIds.find((id) => hasSpatialTensor(ir, id))!;
      displayNodes.push({
        id: `conv-stage-${index + 1}`,
        role: "tensor_stage",
        label: `Conv block ${index + 1}`,
        summary: tensorLabel(ir, tensorId),
        semantic: { stage: index + 1, repeatCount: stage.repeats?.count ?? 1, channels: channelCount(ir, tensorId) },
      });
      const pool = ir.nodes.find((node) => node.op === "pool" && node.inputTensorIds.includes(tensorId));
      sourceMappings.push(mappingFor(ir, `conv-stage-${index + 1}`, [stage.id, ...(pool ? [pool.id] : [])]));
    }
    displayNodes.push({ id: "classifier-head", role: "head", label: "Classifier", summary: "Flatten + fully connected prediction head", semantic: { stage: convolutionStages.length + 1 } });
    sourceMappings.push(mappingFor(ir, "classifier-head", classifierNodes.map((node) => node.id)));

    const stageIds = displayNodes.map((node) => node.id);
    const displayRelations = stageIds.slice(1).map((targetDisplayId, index) => ({
      id: `flow-${index + 1}`,
      role: index > 0 && displayNodes[index]?.role === "tensor_stage" ? "downsample" as const : "flow" as const,
      sourceDisplayId: stageIds[index]!,
      targetDisplayId,
      label: null,
      semantic: {},
    }));
    const model = {
      version: 1 as const,
      grammar: { id: "cnn-classifier" as const, version: 1 },
      regions: [
        { id: "cnn-backbone", label: "Convolutional backbone", role: "backbone", displayIds: stageIds.slice(0, -1) },
        { id: "classifier", label: "Classifier", role: "head", displayIds: ["classifier-head"] },
      ],
      displayNodes,
      displayRelations,
      sourceMappings,
      narrative: { title: ir.figure.title, summary: "Spatial resolution contracts through convolutional stages before a compact classifier head.", stageSummaries: displayNodes.map((node) => node.label) },
    };
    return parseFigureSemanticModel(model, ir, intent);
  },
  compilePlan(model, intent) {
    if (model.grammar.id !== "cnn-classifier") throw new Error("cnn-classifier can only compile its own semantic model");
    const stages = model.displayNodes.filter((node) => node.role === "input" || node.role === "tensor_stage");
    const classifier = model.displayNodes.find((node) => node.id === "classifier-head");
    if (!classifier) throw new Error("cnn-classifier semantic model requires classifier-head");
    const primitiveFor = new Map<string, string>();
    const primitiveBounds = new Map<string, { x: number; y: number; width: number; height: number }>();
    const primitives: any[] = [];
    const spacing = intent.density === "detailed" ? 170 : intent.density === "compact" ? 120 : 145;
    const baselineY = intent.orientation === "portrait" ? 220 : 150;
    for (const [index, stage] of stages.entries()) {
      const height = Math.max(110, 240 - index * 20);
      const id = `primitive-${stage.id}`;
      const bounds = { x: 35 + index * spacing, y: baselineY + (240 - height) / 2, width: 112, height };
      primitiveFor.set(stage.id, id);
      primitiveBounds.set(stage.id, bounds);
      primitives.push({ id, kind: "tensor_volume", bounds, semantic: { stage: index, repeatCount: typeof stage.semantic.repeatCount === "number" ? stage.semantic.repeatCount : 1 }, sourceDisplayId: stage.id });
    }
    const classifierBounds = { x: 35 + stages.length * spacing + 80, y: baselineY + 55, width: 135, height: 130 };
    primitiveFor.set(classifier.id, "primitive-classifier");
    primitiveBounds.set(classifier.id, classifierBounds);
    primitives.push(
      { id: "primitive-classifier", kind: "block_frame", bounds: classifierBounds, semantic: { role: "classifier" }, sourceDisplayId: classifier.id },
      { id: "annotation-track", kind: "annotation_track", bounds: { x: 20, y: baselineY + 300, width: classifierBounds.x + classifierBounds.width - 10, height: 100 }, semantic: { role: "annotation" }, sourceDisplayId: stages[0]!.id },
    );
    const ordered = [...stages.map((node) => node.id), classifier.id];
    const relations = ordered.slice(1).map((targetDisplayId, index) => ({
      id: `relation-${index + 1}`,
      kind: "flow_arrow" as const,
      sourcePrimitiveId: primitiveFor.get(ordered[index]!)!,
      targetPrimitiveId: primitiveFor.get(targetDisplayId)!,
      route: [{ x: primitiveBounds.get(ordered[index]!)!.x + primitiveBounds.get(ordered[index]!)!.width, y: baselineY + 120 }, { x: primitiveBounds.get(targetDisplayId)!.x, y: baselineY + 120 }],
      semantic: { transition: index === ordered.length - 2 ? "classifier" : "scale" },
      sourceDisplayId: ordered[index]!,
      style: { stroke: "solid" as const, tone: "dark" as const, thickness: 1 },
    }));
    const annotations = [
      { id: "title", targetId: primitiveFor.get(stages[0]!.id)!, role: "heading" as const, text: model.narrative.title, bounds: { x: 35, y: 35, width: 500, height: 28 }, fontSizePt: 14 },
      ...stages.map((stage) => ({ id: `label-${stage.id}`, targetId: primitiveFor.get(stage.id)!, role: "detail" as const, text: `${stage.label}${intent.density !== "compact" && stage.summary ? ` · ${stage.summary}` : ""}`, bounds: { x: primitiveBounds.get(stage.id)!.x, y: baselineY + 320, width: 112, height: 22 }, fontSizePt: 8 })),
      { id: "label-classifier", targetId: "primitive-classifier", role: "detail" as const, text: classifier.label, bounds: { x: classifierBounds.x, y: baselineY + 320, width: 135, height: 22 }, fontSizePt: 8 },
    ];
    const plan = parsePublicationFigurePlanV2({
      version: 2,
      target: "preview",
      renderIntent: { density: intent.density, printMode: intent.printMode },
      grammar: { id: "cnn-classifier", version: model.grammar.version },
      coordinateSpace: { unit: "figure-unit", figureUnitInches: 0.01, origin: "top-left", width: Math.max(1200, classifierBounds.x + classifierBounds.width + 80), height: intent.orientation === "portrait" ? 780 : 600 },
      regions: [{ id: "network", label: "Network architecture", role: "network", bounds: { x: 20, y: 90, width: classifierBounds.x + classifierBounds.width + 40, height: 330 } }],
      primitives,
      relations,
      annotations,
      sourceMappings: model.sourceMappings.map((mapping) => ({ mappingId: `mapping-${mapping.displayId}`, ...mapping })),
      qaContract: { minFontSizePt: 7, printMode: intent.printMode, maxPrimitiveCount: 600 },
    });
    const qa = runVisualQa(plan);
    if (qa.blocking.length > 0) throw new Error(`cnn-classifier produced a plan that failed visual QA: ${qa.blocking.map((issue) => issue.code).join(", ")}`);
    return plan;
  },
};

function mappingFor(ir: CanonicalNetworkIR, displayId: string, nodeIds: string[]): FigureSourceMapping {
  const nodeSet = new Set(nodeIds);
  const edges = ir.edges.filter((edge) => nodeSet.has(edge.sourceNodeId) || nodeSet.has(edge.targetNodeId));
  const nodes = ir.nodes.filter((node) => nodeSet.has(node.id));
  return {
    displayId,
    networkNodeIds: nodes.map((node) => node.id),
    tensorIds: [...new Set(nodes.flatMap((node) => [...node.inputTensorIds, ...node.outputTensorIds]))],
    edgeIds: edges.map((edge) => edge.id),
    evidenceIds: [...new Set([...nodes.flatMap((node) => node.sourceEvidenceIds), ...edges.flatMap((edge) => edge.evidenceIds)])],
  };
}

function hasSpatialTensor(ir: CanonicalNetworkIR, id: string): boolean { const tensor = ir.tensors.find((item) => item.id === id); return Boolean(tensor?.axes.includes("height") && tensor.axes.includes("width")); }
function channelCount(ir: CanonicalNetworkIR, id: string): number { const tensor = ir.tensors.find((item) => item.id === id); const index = tensor?.axes.indexOf("channel") ?? -1; const value = index >= 0 ? tensor?.shape[index] : 0; return typeof value === "number" ? value : 0; }
function tensorLabel(ir: CanonicalNetworkIR, id: string | undefined): string | null { const tensor = ir.tensors.find((item) => item.id === id); return tensor ? tensor.shape.join(" × ") : null; }
