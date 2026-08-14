import type { FigureIntent } from "../figure-intent.js";
import { parseFigureSemanticModel, type FigureSemanticModel, type FigureSourceMapping } from "../figure-semantic-model.js";
import type { FigureGrammar, GrammarScore } from "../grammar-registry.js";
import { parseCanonicalNetworkIR, type CanonicalNetworkIR } from "../network-ir-v2.js";
import { parsePublicationFigurePlanV2, type FigureBounds, type PublicationFigurePlanV2 } from "../publication-figure-plan-v2.js";
import { runVisualQa } from "../visual-qa.js";

type CanonicalNode = CanonicalNetworkIR["nodes"][number];
type CanonicalEdge = CanonicalNetworkIR["edges"][number];

interface Tower {
  input: CanonicalNode;
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
  fusionEdge: CanonicalEdge;
}

interface MultiBranchFusionTopology {
  left: Tower;
  right: Tower;
  fusion: CanonicalNode;
  fusionOutput: CanonicalEdge;
  head: CanonicalNode;
  headOutput: CanonicalEdge;
  output: CanonicalNode;
  mode: "cross_attention" | "binary_fusion";
}

interface Analysis {
  topology: MultiBranchFusionTopology | null;
  blockers: string[];
  reasons: string[];
}

interface CompilableMultiBranchFusionGrammar extends FigureGrammar {
  compileSemanticModel(ir: CanonicalNetworkIR, intent: FigureIntent): FigureSemanticModel;
  compilePlan(model: FigureSemanticModel, intent: FigureIntent): PublicationFigurePlanV2;
}

export const multiBranchFusionGrammar: CompilableMultiBranchFusionGrammar = {
  id: "multi-branch-fusion",
  version: 1,
  evaluate(ir, _intent): GrammarScore {
    const analysis = analyze(ir);
    return {
      grammarId: "multi-branch-fusion",
      score: analysis.topology ? 0.93 : 0.1,
      reasons: analysis.reasons,
      blockers: analysis.blockers,
    };
  },
  compileSemanticModel(ir, intent) {
    parseCanonicalNetworkIR(ir, undefined, { renderReady: true });
    const analysis = analyze(ir);
    if (!analysis.topology || analysis.blockers.length > 0) throw new Error(`multi-branch-fusion requires verified topology: ${analysis.blockers.join("; ")}`);
    const topology = analysis.topology;
    const relationRole = topology.mode === "cross_attention" ? "attention" as const : "flow" as const;
    const fusionLabel = topology.mode === "cross_attention" ? "Cross-attention fusion" : `${topology.fusion.op === "concat" ? "Concatenation" : "Addition"} fusion`;
    const displayNodes: FigureSemanticModel["displayNodes"] = [
      { id: "left-tower", role: "token", label: "Left token tower", summary: tensorLabel(ir, topology.left.fusionEdge.tensorIds[0]), semantic: { representation: "token_feature", tower: "left" } },
      { id: "right-tower", role: "token", label: "Right token tower", summary: tensorLabel(ir, topology.right.fusionEdge.tensorIds[0]), semantic: { representation: "token_feature", tower: "right" } },
      { id: "fusion", role: "operator_block", label: fusionLabel, summary: tensorLabel(ir, topology.fusionOutput.tensorIds[0]), semantic: { fusion: topology.mode } },
      { id: "prediction-head", role: "head", label: "Prediction head", summary: tensorLabel(ir, topology.headOutput.tensorIds[0]), semantic: {} },
      { id: "output-stage", role: "output", label: "Output", summary: tensorLabel(ir, topology.output.inputTensorIds[0]), semantic: {} },
    ];
    const sourceMappings: FigureSourceMapping[] = [
      mappingFor(ir, "left-tower", [...topology.left.nodes.map((node) => node.id)], [...topology.left.edges, topology.left.fusionEdge]),
      mappingFor(ir, "right-tower", [...topology.right.nodes.map((node) => node.id)], [...topology.right.edges, topology.right.fusionEdge]),
      mappingFor(ir, "fusion", [topology.fusion.id], [topology.left.fusionEdge, topology.right.fusionEdge, topology.fusionOutput]),
      mappingFor(ir, "prediction-head", [topology.head.id], [topology.fusionOutput, topology.headOutput]),
      mappingFor(ir, "output-stage", [topology.output.id], [topology.headOutput]),
    ];
    return parseFigureSemanticModel({
      version: 1,
      grammar: { id: "multi-branch-fusion", version: 1 },
      regions: [
        { id: "left-tower", label: "Left tower", role: "tower", displayIds: ["left-tower"] },
        { id: "right-tower", label: "Right tower", role: "tower", displayIds: ["right-tower"] },
        { id: "fusion", label: "Fusion", role: "fusion", displayIds: ["fusion"] },
        { id: "head", label: "Head", role: "head", displayIds: ["prediction-head", "output-stage"] },
      ],
      displayNodes,
      displayRelations: [
        { id: "left-fusion", role: relationRole, sourceDisplayId: "left-tower", targetDisplayId: "fusion", label: topology.mode === "cross_attention" ? "Cross-attention" : null, semantic: { tower: "left" } },
        { id: "right-fusion", role: relationRole, sourceDisplayId: "right-tower", targetDisplayId: "fusion", label: topology.mode === "cross_attention" ? "Cross-attention" : null, semantic: { tower: "right" } },
        { id: "fusion-head", role: "flow", sourceDisplayId: "fusion", targetDisplayId: "prediction-head", label: null, semantic: {} },
        { id: "head-output", role: "flow", sourceDisplayId: "prediction-head", targetDisplayId: "output-stage", label: null, semantic: {} },
      ],
      sourceMappings,
      narrative: {
        title: ir.figure.title,
        summary: "Two verified token-feature towers converge exactly once through an evidence-backed fusion operation before a compact prediction head.",
        stageSummaries: displayNodes.map((node) => node.label),
      },
    }, ir, intent);
  },
  compilePlan(model, intent) {
    if (model.grammar.id !== "multi-branch-fusion") throw new Error("multi-branch-fusion can only compile its own semantic model");
    const left = required(model, "left-tower");
    const right = required(model, "right-tower");
    const fusion = required(model, "fusion");
    const head = required(model, "prediction-head");
    const output = required(model, "output-stage");
    const bounds = new Map<string, FigureBounds>([
      [left.id, { x: 45, y: 135, width: 160, height: 100 }],
      [right.id, { x: 45, y: 425, width: 160, height: 100 }],
      [fusion.id, { x: 430, y: 255, width: 220, height: 150 }],
      [head.id, { x: 770, y: 285, width: 160, height: 90 }],
      [output.id, { x: 1050, y: 285, width: 125, height: 90 }],
    ]);
    const primitiveIds = new Map<string, string>();
    const primitives: PublicationFigurePlanV2["primitives"] = [];
    addPrimitive(primitives, primitiveIds, left, "tensor_volume", bounds.get(left.id)!, { tower: "left", representation: "token_feature" });
    addPrimitive(primitives, primitiveIds, right, "tensor_volume", bounds.get(right.id)!, { tower: "right", representation: "token_feature" });
    addPrimitive(primitives, primitiveIds, fusion, "block_frame", bounds.get(fusion.id)!, { fusion: typeof fusion.semantic.fusion === "string" ? fusion.semantic.fusion : "binary" });
    primitives.push({ id: "primitive-fusion-marker", kind: "merge_marker", bounds: { x: 375, y: 305, width: 32, height: 52 }, semantic: { role: "fusion" }, sourceDisplayId: fusion.id });
    addPrimitive(primitives, primitiveIds, head, "block_frame", bounds.get(head.id)!, { role: "head" });
    addPrimitive(primitives, primitiveIds, output, "tensor_volume", bounds.get(output.id)!, { role: "output" });
    primitives.push({ id: "annotation-track", kind: "annotation_track", bounds: { x: 25, y: 560, width: 1165, height: 100 }, semantic: { role: "annotation" }, sourceDisplayId: left.id });

    const leftBounds = bounds.get(left.id)!;
    const rightBounds = bounds.get(right.id)!;
    const fusionBounds = bounds.get(fusion.id)!;
    const headBounds = bounds.get(head.id)!;
    const outputBounds = bounds.get(output.id)!;
    const fusionTone = fusion.semantic.fusion === "cross_attention" ? "dark" as const : "mid" as const;
    const relations: PublicationFigurePlanV2["relations"] = [
      { id: "relation-left-fusion", kind: "flow_arrow", sourcePrimitiveId: primitiveIds.get(left.id)!, targetPrimitiveId: primitiveIds.get(fusion.id)!, route: [{ x: leftBounds.x + leftBounds.width, y: leftBounds.y + leftBounds.height / 2 }, { x: 325, y: leftBounds.y + leftBounds.height / 2 }, { x: 325, y: fusionBounds.y + 45 }, { x: fusionBounds.x, y: fusionBounds.y + 45 }], semantic: { role: "fusion_input", tower: "left" }, sourceDisplayId: left.id, style: { stroke: "solid", tone: fusionTone, thickness: 1.5 } },
      { id: "relation-right-fusion", kind: "flow_arrow", sourcePrimitiveId: primitiveIds.get(right.id)!, targetPrimitiveId: primitiveIds.get(fusion.id)!, route: [{ x: rightBounds.x + rightBounds.width, y: rightBounds.y + rightBounds.height / 2 }, { x: 325, y: rightBounds.y + rightBounds.height / 2 }, { x: 325, y: fusionBounds.y + fusionBounds.height - 45 }, { x: fusionBounds.x, y: fusionBounds.y + fusionBounds.height - 45 }], semantic: { role: "fusion_input", tower: "right" }, sourceDisplayId: right.id, style: { stroke: "dashed", tone: fusionTone, thickness: 1.5 } },
      { id: "relation-fusion-head", kind: "flow_arrow", sourcePrimitiveId: primitiveIds.get(fusion.id)!, targetPrimitiveId: primitiveIds.get(head.id)!, route: [{ x: fusionBounds.x + fusionBounds.width, y: fusionBounds.y + fusionBounds.height / 2 }, { x: headBounds.x, y: headBounds.y + headBounds.height / 2 }], semantic: { role: "head_input" }, sourceDisplayId: fusion.id, style: { stroke: "solid", tone: "dark", thickness: 1.5 } },
      { id: "relation-head-output", kind: "flow_arrow", sourcePrimitiveId: primitiveIds.get(head.id)!, targetPrimitiveId: primitiveIds.get(output.id)!, route: [{ x: headBounds.x + headBounds.width, y: headBounds.y + headBounds.height / 2 }, { x: outputBounds.x, y: outputBounds.y + outputBounds.height / 2 }], semantic: { role: "output" }, sourceDisplayId: head.id, style: { stroke: "solid", tone: "dark", thickness: 1.5 } },
    ];
    const annotations: PublicationFigurePlanV2["annotations"] = [
      { id: "title", targetId: primitiveIds.get(left.id)!, role: "heading", text: truncate(model.narrative.title, 64), bounds: { x: 45, y: 35, width: 640, height: 28 }, fontSizePt: 14 },
      { id: "label-left", targetId: primitiveIds.get(left.id)!, role: "detail", text: label(left, intent), bounds: { x: leftBounds.x, y: 245, width: leftBounds.width, height: 22 }, fontSizePt: 8 },
      { id: "label-right", targetId: primitiveIds.get(right.id)!, role: "detail", text: label(right, intent), bounds: { x: rightBounds.x, y: 535, width: rightBounds.width, height: 22 }, fontSizePt: 8 },
      { id: "label-fusion", targetId: primitiveIds.get(fusion.id)!, role: "detail", text: label(fusion, intent), bounds: { x: fusionBounds.x, y: 420, width: fusionBounds.width, height: 22 }, fontSizePt: 8 },
      { id: "label-head", targetId: primitiveIds.get(head.id)!, role: "detail", text: label(head, intent), bounds: { x: headBounds.x, y: 395, width: headBounds.width, height: 22 }, fontSizePt: 8 },
      { id: "label-output", targetId: primitiveIds.get(output.id)!, role: "detail", text: label(output, intent), bounds: { x: outputBounds.x, y: 395, width: outputBounds.width, height: 22 }, fontSizePt: 8 },
    ];
    const plan = parsePublicationFigurePlanV2({
      version: 2,
      target: "preview",
      renderIntent: { density: intent.density, printMode: intent.printMode },
      grammar: { id: "multi-branch-fusion", version: model.grammar.version },
      coordinateSpace: { unit: "figure-unit", figureUnitInches: 0.01, origin: "top-left", width: 1220, height: 680 },
      regions: [
        { id: "left-tower", label: "Left tower", role: "tower", bounds: { x: 25, y: 105, width: 220, height: 180 } },
        { id: "right-tower", label: "Right tower", role: "tower", bounds: { x: 25, y: 395, width: 220, height: 180 } },
        { id: "fusion", label: "Fusion", role: "fusion", bounds: { x: 350, y: 220, width: 330, height: 235 } },
        { id: "head", label: "Prediction", role: "head", bounds: { x: 735, y: 250, width: 465, height: 180 } },
      ],
      primitives,
      relations,
      annotations,
      sourceMappings: model.sourceMappings.map((mapping) => ({ mappingId: `mapping-${mapping.displayId}`, ...mapping })),
      qaContract: { minFontSizePt: 7, printMode: intent.printMode, maxPrimitiveCount: 600 },
    });
    const qa = runVisualQa(plan);
    if (qa.blocking.length > 0) throw new Error(`multi-branch-fusion produced a plan that failed visual QA: ${qa.blocking.map((issue) => issue.code).join(", ")}`);
    return plan;
  },
};

function analyze(ir: CanonicalNetworkIR): Analysis {
  const blockers: string[] = [];
  const reasons: string[] = [];
  const inputs = ir.nodes.filter((node) => node.op === "input");
  const outputs = ir.nodes.filter((node) => node.op === "output");
  if (inputs.length !== 2) blockers.push("requires exactly two input towers");
  if (outputs.length !== 1) blockers.push("requires exactly one output");
  const fusions = ir.nodes.filter((node) => node.op === "attention" || node.op === "add" || node.op === "concat");
  if (fusions.length !== 1) blockers.push("requires exactly one fusion node");
  if (blockers.length > 0) return { topology: null, blockers, reasons };

  const fusion = fusions[0]!;
  const incoming = ir.edges.filter((edge) => edge.targetNodeId === fusion.id);
  const outgoing = ir.edges.filter((edge) => edge.sourceNodeId === fusion.id);
  const mode = fusion.op === "attention" ? "cross_attention" as const : "binary_fusion" as const;
  if (fusion.inputTensorIds.length !== 2 || incoming.length !== 2) blockers.push("fusion requires exactly two verified incoming tensors");
  if (fusion.outputTensorIds.length !== 1 || outgoing.length !== 1) blockers.push("fusion requires exactly one outgoing tensor");
  if (incoming.some((edge) => edge.tensorIds.length !== 1)) blockers.push("every fusion input edge must carry exactly one tensor");
  if (mode === "cross_attention" && (incoming.some((edge) => edge.relation !== "cross_attention") || fusion.op !== "attention")) blockers.push("cross-attention fusion requires two cross_attention edges into an attention node");
  if (mode === "binary_fusion" && incoming.some((edge) => edge.relation !== "data")) blockers.push("binary fusion requires data edges");
  if (outgoing.some((edge) => edge.relation !== "data" || edge.tensorIds.length !== 1)) blockers.push("fusion output must be one data edge with one tensor");
  if (blockers.length > 0) return { topology: null, blockers, reasons };

  const first = walkTower(ir, inputs[0]!, fusion.id);
  const second = walkTower(ir, inputs[1]!, fusion.id);
  blockers.push(...first.blockers, ...second.blockers);
  if (!first.tower || !second.tower) return { topology: null, blockers: unique(blockers), reasons };
  const towerEdges = [first.tower.fusionEdge, second.tower.fusionEdge];
  if (new Set(towerEdges.map((edge) => edge.id)).size !== 2) blockers.push("each input tower must enter fusion through a distinct edge");
  for (const tower of [first.tower, second.tower]) {
    if (tower.nodes.length < 2) blockers.push("each input tower requires an embedding or encoder stage");
    if (!hasTokenFeature(ir, tower.fusionEdge.tensorIds[0])) blockers.push("each fusion input must be a token-feature representation");
  }
  if (!hasTokenFeature(ir, outgoing[0]!.tensorIds[0])) blockers.push("fusion output must be a token-feature representation");

  const tail = walkTail(ir, fusion, outgoing[0]!, outputs[0]!);
  blockers.push(...tail.blockers);
  if (!tail.head || !tail.headOutput) return { topology: null, blockers: unique(blockers), reasons };
  const covered = new Set([
    ...first.tower.nodes.map((node) => node.id),
    ...second.tower.nodes.map((node) => node.id),
    fusion.id,
    tail.head.id,
    outputs[0]!.id,
  ]);
  if (covered.size !== ir.nodes.length) blockers.push("all nodes must belong to the two towers, one fusion, one head, or one output");
  const visibleEdges = [...first.tower.edges, first.tower.fusionEdge, ...second.tower.edges, second.tower.fusionEdge, outgoing[0]!, tail.headOutput];
  if (new Set(visibleEdges.map((edge) => edge.id)).size !== ir.edges.length) blockers.push("the dual-tower topology may not include side edges, feedback, residual, or iteration relations");
  if (ir.edges.some((edge) => edge.relation === "residual" || edge.relation === "iteration")) blockers.push("residual and iteration relations are outside multi-branch-fusion");
  if (ir.nodes.some((node) => node.sourceEvidenceIds.length === 0)) blockers.push("every visible tower, fusion, head, and output node requires source evidence");
  if (visibleEdges.some((edge) => edge.evidenceIds.length === 0)) blockers.push("every visible fusion flow requires source evidence");
  if (!edgeClosed(ir, visibleEdges) || !nodeClosed(ir, covered, visibleEdges)) blockers.push("requires tensor-closed two-tower data paths without hidden side inputs");
  if (blockers.length > 0) return { topology: null, blockers: unique(blockers), reasons };
  reasons.push("two evidence-backed token-feature towers", mode === "cross_attention" ? "one verified cross-attention fusion" : "one verified binary fusion", "one linear prediction head");
  return { topology: { left: first.tower, right: second.tower, fusion, fusionOutput: outgoing[0]!, head: tail.head, headOutput: tail.headOutput, output: outputs[0]!, mode }, blockers: [], reasons };
}

function walkTower(ir: CanonicalNetworkIR, input: CanonicalNode, fusionId: string): { tower: Tower | null; blockers: string[] } {
  const blockers: string[] = [];
  const nodes = [input];
  const edges: CanonicalEdge[] = [];
  let current = input;
  const visited = new Set<string>([input.id]);
  while (true) {
    const outgoing = ir.edges.filter((edge) => edge.sourceNodeId === current.id);
    if (outgoing.length !== 1) { blockers.push(`tower "${input.id}" must have one unambiguous outgoing edge at every stage`); return { tower: null, blockers }; }
    const edge = outgoing[0]!;
    if (edge.tensorIds.length !== 1) { blockers.push(`tower "${input.id}" edges must carry exactly one tensor`); return { tower: null, blockers }; }
    if (edge.targetNodeId === fusionId) return { tower: { input, nodes, edges, fusionEdge: edge }, blockers };
    if (edge.relation !== "data") { blockers.push(`tower "${input.id}" must be a data-only spine before fusion`); return { tower: null, blockers }; }
    const next = ir.nodes.find((node) => node.id === edge.targetNodeId);
    const incoming = ir.edges.filter((candidate) => candidate.targetNodeId === edge.targetNodeId);
    if (!next || next.op === "input" || next.op === "output" || next.op === "attention" || next.op === "add" || next.op === "concat" || incoming.length !== 1 || visited.has(next.id)) {
      blockers.push(`tower "${input.id}" must be a linear encoder spine without cycles or branch operators`);
      return { tower: null, blockers };
    }
    nodes.push(next);
    edges.push(edge);
    visited.add(next.id);
    current = next;
  }
}

function walkTail(ir: CanonicalNetworkIR, fusion: CanonicalNode, fusionOutput: CanonicalEdge, output: CanonicalNode): { head: CanonicalNode | null; headOutput: CanonicalEdge | null; blockers: string[] } {
  const blockers: string[] = [];
  const head = ir.nodes.find((node) => node.id === fusionOutput.targetNodeId) ?? null;
  if (!head || (head.op !== "classifier" && head.op !== "dense")) blockers.push("fusion must continue to exactly one classifier or dense head");
  if (!head) return { head: null, headOutput: null, blockers };
  const outgoing = ir.edges.filter((edge) => edge.sourceNodeId === head.id);
  const incoming = ir.edges.filter((edge) => edge.targetNodeId === head.id);
  if (incoming.length !== 1 || outgoing.length !== 1 || outgoing[0]!.targetNodeId !== output.id || outgoing[0]!.relation !== "data" || outgoing[0]!.tensorIds.length !== 1) blockers.push("prediction head must form one data edge directly to the output");
  return { head, headOutput: outgoing[0] ?? null, blockers };
}

function edgeClosed(ir: CanonicalNetworkIR, edges: CanonicalEdge[]): boolean {
  return edges.every((edge) => edge.tensorIds.length === 1 && ir.tensors.find((tensor) => tensor.id === edge.tensorIds[0])?.producerNodeId === edge.sourceNodeId && ir.tensors.find((tensor) => tensor.id === edge.tensorIds[0])?.consumerNodeIds.includes(edge.targetNodeId));
}

function nodeClosed(ir: CanonicalNetworkIR, covered: Set<string>, edges: CanonicalEdge[]): boolean {
  return [...covered].every((nodeId) => {
    const node = ir.nodes.find((candidate) => candidate.id === nodeId)!;
    const incoming = edges.filter((edge) => edge.targetNodeId === nodeId).flatMap((edge) => edge.tensorIds);
    const outgoing = edges.filter((edge) => edge.sourceNodeId === nodeId).flatMap((edge) => edge.tensorIds);
    return same(node.inputTensorIds, incoming) && same(node.outputTensorIds, outgoing);
  });
}

function same(left: string[], right: string[]): boolean { return left.length === right.length && new Set(left).size === left.length && left.every((id) => right.includes(id)); }
function hasTokenFeature(ir: CanonicalNetworkIR, tensorId: string | undefined): boolean { const tensor = ir.tensors.find((candidate) => candidate.id === tensorId); return Boolean(tensor && tensor.axes.length === 2 && tensor.axes[0] === "token" && tensor.axes[1] === "feature"); }
function unique(values: string[]): string[] { return [...new Set(values)]; }

function mappingFor(ir: CanonicalNetworkIR, displayId: string, nodeIds: string[], edges: CanonicalEdge[]): FigureSourceMapping {
  const nodeSet = new Set(nodeIds);
  const nodes = ir.nodes.filter((node) => nodeSet.has(node.id));
  return { displayId, networkNodeIds: nodes.map((node) => node.id), tensorIds: [...new Set(nodes.flatMap((node) => [...node.inputTensorIds, ...node.outputTensorIds]))], edgeIds: edges.map((edge) => edge.id), evidenceIds: [...new Set([...nodes.flatMap((node) => node.sourceEvidenceIds), ...edges.flatMap((edge) => edge.evidenceIds)])] };
}

function addPrimitive(primitives: PublicationFigurePlanV2["primitives"], primitiveIds: Map<string, string>, node: FigureSemanticModel["displayNodes"][number], kind: "tensor_volume" | "block_frame", bounds: FigureBounds, semantic: Record<string, string | number | boolean | null>): void {
  const id = `primitive-${node.id}`;
  primitiveIds.set(node.id, id);
  primitives.push({ id, kind, bounds, semantic, sourceDisplayId: node.id });
}

function required(model: FigureSemanticModel, id: string): FigureSemanticModel["displayNodes"][number] { const node = model.displayNodes.find((candidate) => candidate.id === id); if (!node) throw new Error(`multi-branch-fusion semantic model requires ${id}`); return node; }
function tensorLabel(ir: CanonicalNetworkIR, id: string | undefined): string | null { const tensor = ir.tensors.find((candidate) => candidate.id === id); return tensor ? tensor.shape.join(" × ") : null; }
function label(node: FigureSemanticModel["displayNodes"][number], intent: FigureIntent): string { return `${node.label}${intent.density !== "compact" && node.summary ? ` · ${node.summary}` : ""}`; }
function truncate(value: string, length: number): string { return value.length <= length ? value : `${value.slice(0, Math.max(1, length - 1)).trimEnd()}…`; }
