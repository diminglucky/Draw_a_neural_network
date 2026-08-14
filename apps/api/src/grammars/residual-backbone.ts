import type { FigureIntent } from "../figure-intent.js";
import { parseFigureSemanticModel, type FigureSemanticModel, type FigureSourceMapping } from "../figure-semantic-model.js";
import type { FigureGrammar, GrammarScore } from "../grammar-registry.js";
import { parsePublicationFigurePlanV2, type PublicationFigurePlanV2 } from "../publication-figure-plan-v2.js";
import { parseCanonicalNetworkIR, type CanonicalNetworkIR } from "../network-ir-v2.js";
import { runVisualQa } from "../visual-qa.js";

interface CompilableResidualGrammar extends FigureGrammar {
  compileSemanticModel(ir: CanonicalNetworkIR, intent: FigureIntent): FigureSemanticModel;
  compilePlan(model: FigureSemanticModel, intent: FigureIntent): PublicationFigurePlanV2;
}

export const residualBackboneGrammar: CompilableResidualGrammar = {
  id: "residual-backbone",
  version: 1,
  evaluate(ir, _intent): GrammarScore {
    const residualEdges = ir.edges.filter((edge) => edge.relation === "residual");
    const addNodes = ir.nodes.filter((node) => node.op === "add");
    const complete = residualEdges.filter((edge) => addNodes.some((node) => node.id === edge.targetNodeId));
    const unresolvable = complete.filter((edge) => {
      const add = addNodes.find((node) => node.id === edge.targetNodeId)!;
      return !ir.nodes.some((node) => node.op !== "input" && node.outputTensorIds.some((tensorId) => add.inputTensorIds.includes(tensorId)));
    });
    const hasInput = ir.nodes.some((node) => node.op === "input");
    const hasOutputHead = ir.nodes.some((node) => node.op === "classifier" || node.op === "output");
    const score = complete.length === 0 ? 0.1 : Math.min(0.97, 0.75 + Math.min(0.2, complete.length * 0.05));
    return {
      grammarId: "residual-backbone",
      score,
      reasons: complete.length > 0 ? [`${complete.length} residual shortcuts terminate at Add nodes`] : [],
      blockers: [
        ...(complete.length === 0 ? ["requires residual edges that terminate at Add nodes"] : []),
        ...unresolvable.map((edge) => `Residual Add "${edge.targetNodeId}" requires a non-input main path producer`),
        ...(!hasInput ? ["requires an input node"] : []),
        ...(!hasOutputHead ? ["requires a classifier or output head"] : []),
      ],
    };
  },
  compileSemanticModel(ir, intent) {
    parseCanonicalNetworkIR(ir, undefined, { renderReady: true });
    const input = ir.nodes.find((node) => node.op === "input");
    const addNodes = ir.nodes.filter((node) => node.op === "add" && ir.edges.some((edge) => edge.targetNodeId === node.id && edge.relation === "residual"));
    if (!input || addNodes.length === 0) throw new Error("residual-backbone requires input and Add nodes");
    const displayNodes: FigureSemanticModel["displayNodes"] = [{ id: "input-stage", role: "input", label: "Stem", summary: "Input and initial feature extraction", semantic: { stage: 0 } }];
    const inputRelated = [input.id, ...ir.nodes.filter((node) => node.op === "conv2d" && node.inputTensorIds.some((tensorId) => input.outputTensorIds.includes(tensorId))).map((node) => node.id)];
    const sourceMappings: FigureSourceMapping[] = [mappingFor(ir, "input-stage", inputRelated)];
    for (const [index, add] of addNodes.entries()) {
      const block = ir.nodes.find((node) => node.outputTensorIds.some((tensorId) => add.inputTensorIds.includes(tensorId)) && node.op !== "input");
      const residual = ir.edges.find((edge) => edge.targetNodeId === add.id && edge.relation === "residual");
      if (!block || !residual) throw new Error(`Add node "${add.id}" is not a resolvable residual stage`);
      const tensor = ir.tensors.find((item) => item.id === add.outputTensorIds[0]);
      displayNodes.push({ id: `residual-stage-${index + 1}`, role: "operator_block", label: `Residual stage ${index + 1}`, summary: tensor ? tensor.shape.join(" × ") : null, semantic: { stage: index + 1, repeatCount: block.repeats?.count ?? 1 } });
      sourceMappings.push(mappingFor(ir, `residual-stage-${index + 1}`, [block.id, add.id]));
    }
    const classifier = ir.nodes.find((node) => node.op === "classifier") ?? ir.nodes.find((node) => node.op === "output");
    if (!classifier) throw new Error("residual-backbone requires a classifier or output node");
    const classifierNodeIds = [classifier.id, ...ir.nodes.filter((node) => node.op === "output" && node.id !== classifier.id).map((node) => node.id)];
    displayNodes.push({ id: "classifier-head", role: "head", label: "Classifier", summary: "Global representation to class scores", semantic: { stage: addNodes.length + 1 } });
    sourceMappings.push(mappingFor(ir, "classifier-head", classifierNodeIds));
    const stageIds = displayNodes.map((node) => node.id);
    const displayRelations: FigureSemanticModel["displayRelations"] = [];
    for (let index = 1; index < stageIds.length; index += 1) displayRelations.push({ id: `flow-${index}`, role: "flow", sourceDisplayId: stageIds[index - 1]!, targetDisplayId: stageIds[index]!, label: null, semantic: {} });
    for (const [index] of addNodes.entries()) displayRelations.push({ id: `residual-${index + 1}`, role: "residual", sourceDisplayId: stageIds[index]!, targetDisplayId: stageIds[index + 1]!, label: null, semantic: { shortcut: true } });
    return parseFigureSemanticModel({
      version: 1,
      grammar: { id: "residual-backbone", version: 1 },
      regions: [{ id: "backbone", label: "Residual backbone", role: "backbone", displayIds: stageIds.slice(0, -1) }, { id: "classifier", label: "Classifier", role: "head", displayIds: ["classifier-head"] }],
      displayNodes,
      displayRelations,
      sourceMappings,
      narrative: { title: ir.figure.title, summary: "Residual stages retain a main flow and explicit shortcut merges.", stageSummaries: displayNodes.map((node) => node.label) },
    }, ir, intent);
  },
  compilePlan(model, intent) {
    if (model.grammar.id !== "residual-backbone") throw new Error("residual-backbone can only compile its own semantic model");
    const stages = model.displayNodes.filter((node) => node.id !== "classifier-head");
    const classifier = model.displayNodes.find((node) => node.id === "classifier-head");
    if (!classifier) throw new Error("residual-backbone semantic model requires classifier-head");
    const primitiveFor = new Map<string, string>();
    const primitiveBounds = new Map<string, { x: number; y: number; width: number; height: number }>();
    const primitives: any[] = [];
    const spacing = intent.density === "detailed" ? 190 : intent.density === "compact" ? 140 : 170;
    const baselineY = intent.orientation === "portrait" ? 240 : 190;
    for (const [index, stage] of stages.entries()) {
      const id = `primitive-${stage.id}`;
      const bounds = { x: 45 + index * spacing, y: baselineY, width: index === 0 ? 115 : 125, height: index === 0 ? 160 : 130 };
      primitiveFor.set(stage.id, id);
      primitiveBounds.set(stage.id, bounds);
      primitives.push({ id, kind: index === 0 ? "tensor_volume" : "block_frame", bounds, semantic: { stage: index, repeatCount: typeof stage.semantic.repeatCount === "number" ? stage.semantic.repeatCount : 1 }, sourceDisplayId: stage.id });
      if (index > 0) primitives.push({ id: `shortcut-${index}`, kind: "residual_skip", bounds: { x: bounds.x, y: baselineY - 100, width: bounds.width, height: 22 }, semantic: { stage: index }, sourceDisplayId: stage.id });
    }
    const classifierBounds = { x: 45 + stages.length * spacing + 70, y: baselineY + 15, width: 135, height: 100 };
    primitiveFor.set(classifier.id, "primitive-classifier");
    primitiveBounds.set(classifier.id, classifierBounds);
    primitives.push(
      { id: "primitive-classifier", kind: "block_frame", bounds: classifierBounds, semantic: { role: "classifier" }, sourceDisplayId: classifier.id },
      { id: "annotation-track", kind: "annotation_track", bounds: { x: 20, y: baselineY + 260, width: classifierBounds.x + classifierBounds.width - 10, height: 100 }, semantic: { role: "annotation" }, sourceDisplayId: stages[0]!.id },
    );
    const ordered = [...stages.map((node) => node.id), classifier.id];
    const relations: any[] = [];
    for (let index = 1; index < ordered.length; index += 1) relations.push({ id: `flow-${index}`, kind: "flow_arrow", sourcePrimitiveId: primitiveFor.get(ordered[index - 1]!)!, targetPrimitiveId: primitiveFor.get(ordered[index])!, route: [{ x: primitiveBounds.get(ordered[index - 1]!)!.x + primitiveBounds.get(ordered[index - 1]!)!.width, y: baselineY + 65 }, { x: primitiveBounds.get(ordered[index])!.x, y: baselineY + 65 }], semantic: {}, sourceDisplayId: ordered[index - 1]!, style: { stroke: "solid", tone: "dark", thickness: 1 } });
    for (let index = 1; index < stages.length; index += 1) relations.push({ id: `shortcut-relation-${index}`, kind: "residual_skip", sourcePrimitiveId: primitiveFor.get(stages[index - 1]!.id)!, targetPrimitiveId: primitiveFor.get(stages[index]!.id)!, route: [{ x: primitiveBounds.get(stages[index - 1]!.id)!.x + primitiveBounds.get(stages[index - 1]!.id)!.width, y: baselineY }, { x: primitiveBounds.get(stages[index]!.id)!.x, y: baselineY }], semantic: { shortcut: true }, sourceDisplayId: stages[index]!.id, style: { stroke: "dashed", tone: "mid", thickness: 1 } });
    const annotations = [
      { id: "title", targetId: primitiveFor.get(stages[0]!.id)!, role: "heading", text: model.narrative.title, bounds: { x: 45, y: 35, width: 500, height: 28 }, fontSizePt: 14 },
      ...stages.map((stage) => ({ id: `label-${stage.id}`, targetId: primitiveFor.get(stage.id)!, role: "detail", text: `${stage.label}${stage.semantic.repeatCount ? ` ×${stage.semantic.repeatCount}` : ""}`, bounds: { x: primitiveBounds.get(stage.id)!.x, y: baselineY + 280, width: Math.min(145, spacing - 8), height: 22 }, fontSizePt: 8 })),
      { id: "label-classifier", targetId: "primitive-classifier", role: "detail", text: classifier.label, bounds: { x: classifierBounds.x, y: baselineY + 280, width: 135, height: 22 }, fontSizePt: 8 },
    ];
    const plan = parsePublicationFigurePlanV2({
      version: 2,
      target: "preview",
      renderIntent: { density: intent.density, printMode: intent.printMode },
      grammar: { id: "residual-backbone", version: model.grammar.version },
      coordinateSpace: { unit: "figure-unit", figureUnitInches: 0.01, origin: "top-left", width: Math.max(1200, classifierBounds.x + classifierBounds.width + 80), height: intent.orientation === "portrait" ? 820 : 600 },
      regions: [{ id: "network", label: "Residual architecture", role: "network", bounds: { x: 20, y: 70, width: classifierBounds.x + classifierBounds.width + 40, height: 350 } }],
      primitives,
      relations,
      annotations,
      sourceMappings: model.sourceMappings.map((mapping) => ({ mappingId: `mapping-${mapping.displayId}`, ...mapping })),
      qaContract: { minFontSizePt: 7, printMode: intent.printMode, maxPrimitiveCount: 600 },
    });
    const qa = runVisualQa(plan);
    if (qa.blocking.length > 0) throw new Error(`residual-backbone produced a plan that failed visual QA: ${qa.blocking.map((issue) => issue.code).join(", ")}`);
    return plan;
  },
};

function mappingFor(ir: CanonicalNetworkIR, displayId: string, nodeIds: string[]): FigureSourceMapping {
  const nodeSet = new Set(nodeIds);
  const nodes = ir.nodes.filter((node) => nodeSet.has(node.id));
  const edges = ir.edges.filter((edge) => nodeSet.has(edge.sourceNodeId) || nodeSet.has(edge.targetNodeId));
  return { displayId, networkNodeIds: nodes.map((node) => node.id), tensorIds: [...new Set(nodes.flatMap((node) => [...node.inputTensorIds, ...node.outputTensorIds]))], edgeIds: edges.map((edge) => edge.id), evidenceIds: [...new Set([...nodes.flatMap((node) => node.sourceEvidenceIds), ...edges.flatMap((edge) => edge.evidenceIds)])] };
}
