import type { FigureIntent } from "../figure-intent.js";
import { parseFigureSemanticModel, type FigureSemanticModel, type FigureSourceMapping } from "../figure-semantic-model.js";
import type { FigureGrammar, GrammarScore } from "../grammar-registry.js";
import { parseCanonicalNetworkIR, type CanonicalNetworkIR } from "../network-ir-v2.js";
import { parsePublicationFigurePlanV2, type FigureBounds, type PublicationFigurePlanV2 } from "../publication-figure-plan-v2.js";
import { runVisualQa } from "../visual-qa.js";

interface CompilableEncoderDecoderGrammar extends FigureGrammar {
  compileSemanticModel(ir: CanonicalNetworkIR, intent: FigureIntent): FigureSemanticModel;
  compilePlan(model: FigureSemanticModel, intent: FigureIntent): PublicationFigurePlanV2;
}

type CanonicalNode = CanonicalNetworkIR["nodes"][number];

interface EncoderStage {
  node: CanonicalNode;
  downsample: CanonicalNode;
  tensorId: string;
  scale: SpatialScale;
}

interface DecoderStage {
  concat: CanonicalNode;
  upsample: CanonicalNode;
  decoder: CanonicalNode;
  encoder: EncoderStage;
  tensorId: string;
  scale: SpatialScale;
}

interface EncoderDecoderTopology {
  input: CanonicalNode;
  output: CanonicalNode;
  encoder: EncoderStage[];
  bottleneck: CanonicalNode;
  bottleneckTensorId: string;
  decoder: DecoderStage[];
}

interface TopologyAnalysis {
  topology: EncoderDecoderTopology | null;
  blockers: string[];
  reasons: string[];
}

interface SpatialScale { height: number; width: number; }

export const encoderDecoderGrammar: CompilableEncoderDecoderGrammar = {
  id: "encoder-decoder",
  version: 1,
  evaluate(ir, _intent): GrammarScore {
    const analysis = analyzeTopology(ir);
    const topology = analysis.topology;
    const score = topology
      ? Math.min(0.98, 0.4 + topology.encoder.length * 0.08 + topology.decoder.length * 0.14 + 0.18)
      : 0.1;
    return { grammarId: "encoder-decoder", score, reasons: analysis.reasons, blockers: analysis.blockers };
  },
  compileSemanticModel(ir, intent) {
    parseCanonicalNetworkIR(ir, undefined, { renderReady: true });
    const analysis = analyzeTopology(ir);
    if (!analysis.topology || analysis.blockers.length > 0) {
      throw new Error(`encoder-decoder requires verified topology: ${analysis.blockers.join("; ")}`);
    }
    const topology = analysis.topology;
    const displayNodes: FigureSemanticModel["displayNodes"] = [
      { id: "input-stage", role: "input", label: "Input", summary: tensorLabel(ir, topology.input.outputTensorIds[0]), semantic: { stage: 0 } },
      ...topology.encoder.map((stage, index) => ({
        id: `encoder-stage-${index + 1}`,
        role: "tensor_stage" as const,
        label: `Encoder level ${index + 1}`,
        summary: tensorLabel(ir, stage.tensorId),
        semantic: { stage: index + 1, scaleHeight: stage.scale.height, scaleWidth: stage.scale.width, repeatCount: stage.node.repeats?.count ?? 1 },
      })),
      {
        id: "bottleneck-stage",
        role: "tensor_stage",
        label: "Bottleneck",
        summary: tensorLabel(ir, topology.bottleneckTensorId),
        semantic: { stage: topology.encoder.length + 1, repeatCount: topology.bottleneck.repeats?.count ?? 1 },
      },
      ...topology.decoder.map((stage, index) => ({
        id: `decoder-stage-${index + 1}`,
        role: "tensor_stage" as const,
        label: `Decoder level ${topology.decoder.length - index}`,
        summary: tensorLabel(ir, stage.tensorId),
        semantic: { stage: topology.encoder.length + 2 + index, scaleHeight: stage.scale.height, scaleWidth: stage.scale.width, repeatCount: stage.decoder.repeats?.count ?? 1, merge: "Concat" },
      })),
      { id: "output-head", role: "output", label: "Output", summary: tensorLabel(ir, topology.output.inputTensorIds[0]), semantic: { stage: topology.encoder.length + topology.decoder.length + 2 } },
    ];
    const sourceMappings: FigureSourceMapping[] = [
      mappingFor(ir, "input-stage", [topology.input.id]),
      ...topology.encoder.map((stage, index) => mappingFor(ir, `encoder-stage-${index + 1}`, [stage.node.id, stage.downsample.id])),
      mappingFor(ir, "bottleneck-stage", [topology.bottleneck.id]),
      ...topology.decoder.map((stage, index) => mappingFor(ir, `decoder-stage-${index + 1}`, [stage.upsample.id, stage.concat.id, stage.decoder.id])),
      mappingFor(ir, "output-head", [topology.output.id]),
    ];
    const displayRelations: FigureSemanticModel["displayRelations"] = [];
    const encoderIds = topology.encoder.map((_, index) => `encoder-stage-${index + 1}`);
    displayRelations.push({ id: "input-flow", role: "flow", sourceDisplayId: "input-stage", targetDisplayId: encoderIds[0]!, label: null, semantic: {} });
    for (let index = 1; index < encoderIds.length; index += 1) {
      displayRelations.push({ id: `downsample-${index}`, role: "downsample", sourceDisplayId: encoderIds[index - 1]!, targetDisplayId: encoderIds[index]!, label: null, semantic: {} });
    }
    displayRelations.push({ id: "downsample-bottleneck", role: "downsample", sourceDisplayId: encoderIds[encoderIds.length - 1]!, targetDisplayId: "bottleneck-stage", label: null, semantic: {} });
    let previousDecoderSource = "bottleneck-stage";
    for (const [index, decoder] of topology.decoder.entries()) {
      const decoderId = `decoder-stage-${index + 1}`;
      displayRelations.push({ id: `upsample-${index + 1}`, role: "upsample", sourceDisplayId: previousDecoderSource, targetDisplayId: decoderId, label: null, semantic: {} });
      const encoderIndex = topology.encoder.findIndex((stage) => stage.node.id === decoder.encoder.node.id);
      displayRelations.push({ id: `concat-${index + 1}`, role: "concat", sourceDisplayId: `encoder-stage-${encoderIndex + 1}`, targetDisplayId: decoderId, label: "Concat", semantic: { merge: "concat" } });
      previousDecoderSource = decoderId;
    }
    displayRelations.push({ id: "output-flow", role: "flow", sourceDisplayId: previousDecoderSource, targetDisplayId: "output-head", label: null, semantic: {} });
    return parseFigureSemanticModel({
      version: 1,
      grammar: { id: "encoder-decoder", version: 1 },
      regions: [
        { id: "encoder", label: "Encoder", role: "encoder", displayIds: ["input-stage", ...encoderIds] },
        { id: "bottleneck", label: "Bottleneck", role: "bottleneck", displayIds: ["bottleneck-stage"] },
        { id: "decoder", label: "Decoder", role: "decoder", displayIds: [...topology.decoder.map((_, index) => `decoder-stage-${index + 1}`), "output-head"] },
      ],
      displayNodes,
      displayRelations,
      sourceMappings,
      narrative: {
        title: ir.figure.title,
        summary: "A scale-aware encoder contracts spatial features into a bottleneck before decoder stages restore resolution through verified Concat skips.",
        stageSummaries: displayNodes.map((node) => node.label),
      },
    }, ir, intent);
  },
  compilePlan(model, intent) {
    if (model.grammar.id !== "encoder-decoder") throw new Error("encoder-decoder can only compile its own semantic model");
    const input = requiredNode(model, "input-stage");
    const encoder = model.displayNodes.filter((node) => node.id.startsWith("encoder-stage-"));
    const bottleneck = requiredNode(model, "bottleneck-stage");
    const decoder = model.displayNodes.filter((node) => node.id.startsWith("decoder-stage-"));
    const output = requiredNode(model, "output-head");
    if (encoder.length < 2 || decoder.length < 2) throw new Error("encoder-decoder semantic model requires at least two encoder and decoder stages");

    const primitiveFor = new Map<string, string>();
    const boundsFor = new Map<string, FigureBounds>();
    const markerFor = new Map<string, string>();
    const primitives: Array<{ id: string; kind: "tensor_volume" | "block_frame" | "merge_marker" | "annotation_track"; bounds: FigureBounds; semantic: Record<string, string | number | boolean | null>; sourceDisplayId: string }> = [];
    const topY = 135;
    const levelStep = 150;
    const horizontalStep = 180;
    const tensorHeight = 115;
    const blockHeight = 100;
    const stageY = (level: number) => topY + level * levelStep;
    const stageBounds = (x: number, level: number, kind: "tensor" | "block"): FigureBounds => ({ x, y: stageY(level), width: kind === "tensor" ? 125 : 145, height: kind === "tensor" ? tensorHeight : blockHeight });
    const bottleneckX = 175 + encoder.length * horizontalStep;
    const decoderMarkerX = bottleneckX + 185;
    addPrimitive(primitives, primitiveFor, boundsFor, input, "tensor_volume", { x: 25, y: topY, width: 95, height: tensorHeight }, { role: "input" });
    for (const [index, stage] of encoder.entries()) addPrimitive(primitives, primitiveFor, boundsFor, stage, "tensor_volume", stageBounds(175 + index * horizontalStep, index, "tensor"), { role: "encoder", level: index + 1, repeatCount: numericSemantic(stage, "repeatCount", 1) });
    addPrimitive(primitives, primitiveFor, boundsFor, bottleneck, "tensor_volume", stageBounds(bottleneckX, encoder.length, "tensor"), { role: "bottleneck", repeatCount: numericSemantic(bottleneck, "repeatCount", 1) });
    for (const [index, stage] of decoder.entries()) {
      const level = decoder.length - index - 1;
      const markerBounds = { x: decoderMarkerX + index * horizontalStep, y: stageY(level) + 28, width: 28, height: 42 };
      const markerId = `marker-${stage.id}`;
      markerFor.set(stage.id, markerId);
      primitives.push({ id: markerId, kind: "merge_marker", bounds: markerBounds, semantic: { operation: "concat", level: decoder.length - index }, sourceDisplayId: stage.id });
      addPrimitive(primitives, primitiveFor, boundsFor, stage, "block_frame", stageBounds(decoderMarkerX + 40 + index * horizontalStep, level, "block"), { role: "decoder", level: decoder.length - index, repeatCount: numericSemantic(stage, "repeatCount", 1) });
    }
    const outputX = decoderMarkerX + 40 + (decoder.length - 1) * horizontalStep + 180;
    const pageWidth = outputX + 120;
    const pageHeight = stageY(encoder.length) + tensorHeight + 170;
    addPrimitive(primitives, primitiveFor, boundsFor, output, "block_frame", { x: outputX, y: topY, width: 90, height: tensorHeight }, { role: "output" });
    primitives.push({ id: "annotation-track", kind: "annotation_track", bounds: { x: 20, y: pageHeight - 70, width: pageWidth - 40, height: 55 }, semantic: { role: "annotation" }, sourceDisplayId: input.id });

    const relations: PublicationFigurePlanV2["relations"] = [];
    const addFlow = (id: string, sourceDisplayId: string, targetPrimitiveId: string, sourceBounds: FigureBounds, targetBounds: FigureBounds, sourcePrimitiveId: string) => {
      relations.push({ id, kind: "flow_arrow", sourcePrimitiveId, targetPrimitiveId, route: horizontalOrVerticalRoute(sourceBounds, targetBounds), semantic: {}, sourceDisplayId, style: { stroke: "solid", tone: "dark", thickness: 1 } });
    };
    addFlow("flow-input", input.id, primitiveFor.get(encoder[0]!.id)!, boundsFor.get(input.id)!, boundsFor.get(encoder[0]!.id)!, primitiveFor.get(input.id)!);
    for (let index = 1; index < encoder.length; index += 1) addFlow(`flow-encoder-${index}`, encoder[index - 1]!.id, primitiveFor.get(encoder[index]!.id)!, boundsFor.get(encoder[index - 1]!.id)!, boundsFor.get(encoder[index]!.id)!, primitiveFor.get(encoder[index - 1]!.id)!);
    addFlow("flow-bottleneck", encoder[encoder.length - 1]!.id, primitiveFor.get(bottleneck.id)!, boundsFor.get(encoder[encoder.length - 1]!.id)!, boundsFor.get(bottleneck.id)!, primitiveFor.get(encoder[encoder.length - 1]!.id)!);
    let previousPrimitiveId = primitiveFor.get(bottleneck.id)!;
    let previousBounds = boundsFor.get(bottleneck.id)!;
    for (const [index, stage] of decoder.entries()) {
      const markerId = markerFor.get(stage.id)!;
      const markerBounds = primitives.find((primitive) => primitive.id === markerId)!.bounds;
      addFlow(`flow-decoder-merge-${index + 1}`, index === 0 ? bottleneck.id : decoder[index - 1]!.id, markerId, previousBounds, markerBounds, previousPrimitiveId);
      const sourceEncoder = encoder[encoder.length - index - 1]!;
      relations.push({
        id: `concat-skip-${index + 1}`,
        kind: "merge_marker",
        sourcePrimitiveId: primitiveFor.get(sourceEncoder.id)!,
        targetPrimitiveId: markerId,
        route: horizontalOrVerticalRoute(boundsFor.get(sourceEncoder.id)!, markerBounds),
        semantic: { operation: "concat" },
        sourceDisplayId: sourceEncoder.id,
        style: { stroke: "dashed", tone: "mid", thickness: 1 },
      });
      addFlow(`flow-decoder-block-${index + 1}`, stage.id, primitiveFor.get(stage.id)!, markerBounds, boundsFor.get(stage.id)!, markerId);
      previousPrimitiveId = primitiveFor.get(stage.id)!;
      previousBounds = boundsFor.get(stage.id)!;
    }
    addFlow("flow-output", decoder[decoder.length - 1]!.id, primitiveFor.get(output.id)!, previousBounds, boundsFor.get(output.id)!, previousPrimitiveId);

    const annotations = [
      { id: "title", targetId: primitiveFor.get(input.id)!, role: "heading" as const, text: model.narrative.title, bounds: { x: 25, y: 28, width: 560, height: 28 }, fontSizePt: 14 },
      ...[input, ...encoder, bottleneck, ...decoder, output].map((node) => ({ id: `label-${node.id}`, targetId: primitiveFor.get(node.id)!, role: "detail" as const, text: node.label, bounds: labelBounds(boundsFor.get(node.id)!), fontSizePt: 8 })),
      ...decoder.map((node) => ({ id: `concat-label-${node.id}`, targetId: markerFor.get(node.id)!, role: "relation_label" as const, text: "Concat", bounds: markerLabelBounds(primitives.find((primitive) => primitive.id === markerFor.get(node.id))!.bounds), fontSizePt: 7 })),
    ];
    const plan = parsePublicationFigurePlanV2({
      version: 2,
      target: "preview",
      renderIntent: { density: intent.density, printMode: intent.printMode },
      grammar: { id: "encoder-decoder", version: model.grammar.version },
      coordinateSpace: { unit: "figure-unit", figureUnitInches: 0.01, origin: "top-left", width: pageWidth, height: pageHeight },
      regions: [
        { id: "encoder", label: "Encoder", role: "encoder", bounds: { x: 15, y: 95, width: bottleneckX - 30, height: pageHeight - 175 } },
        { id: "bottleneck", label: "Bottleneck", role: "bottleneck", bounds: { x: bottleneckX - 25, y: stageY(encoder.length) - 35, width: 175, height: 175 } },
        { id: "decoder", label: "Decoder", role: "decoder", bounds: { x: decoderMarkerX - 25, y: 95, width: pageWidth - decoderMarkerX - 10, height: pageHeight - 175 } },
      ],
      primitives,
      relations,
      annotations,
      sourceMappings: model.sourceMappings.map((mapping) => ({ mappingId: `mapping-${mapping.displayId}`, ...mapping })),
      qaContract: { minFontSizePt: 7, printMode: intent.printMode, maxPrimitiveCount: 600 },
    });
    const qa = runVisualQa(plan);
    if (qa.blocking.length > 0) throw new Error(`encoder-decoder produced a plan that failed visual QA: ${qa.blocking.map((issue) => issue.code).join(", ")}`);
    return plan;
  },
};

function analyzeTopology(ir: CanonicalNetworkIR): TopologyAnalysis {
  const reasons: string[] = [];
  const blockers: string[] = [];
  const nodeById = new Map(ir.nodes.map((node) => [node.id, node]));
  const tensorById = new Map(ir.tensors.map((tensor) => [tensor.id, tensor]));
  const inputs = ir.nodes.filter((node) => node.op === "input");
  const outputs = ir.nodes.filter((node) => node.op === "output");
  const input = inputs[0] ?? null;
  const output = outputs[0] ?? null;
  if (inputs.length !== 1) blockers.push("requires exactly one input node for a single encoder-decoder component");
  if (outputs.length !== 1) blockers.push("requires exactly one output node for a single encoder-decoder component");
  if (ir.nodes.some((node) => node.op === "attention" || node.op === "transformer_block")) blockers.push("token or attention semantics require a token grammar");
  if (!input || !output || blockers.length > 0) return { topology: null, blockers: unique(blockers), reasons };
  if (dataComponent(input.id, ir).size !== ir.nodes.length) return { topology: null, blockers: ["requires one connected data component without detached towers or branches"], reasons };
  const nonBinaryConcat = ir.nodes.find((node) => node.op === "concat" && node.inputTensorIds.length !== 2);
  if (nonBinaryConcat) return { topology: null, blockers: [`Concat "${nonBinaryConcat.id}" requires exactly two inputs: one decoder upsample and one encoder skip`], reasons };

  const mainPath = selectMainPath(ir, input.id, output.id, tensorById);
  if (!mainPath) return { topology: null, blockers: ["requires one unambiguous input-to-output encoder-decoder data path"], reasons };
  if (mainPath.length !== ir.nodes.length) {
    return { topology: null, blockers: ["requires every data node in the connected component to belong to the represented binary U-Net path"], reasons };
  }
  const pathNodes = mainPath.map((id) => nodeById.get(id)!);
  const downsampleIndices = pathNodes.flatMap((node, index) => node.op === "pool" && reducesSpatialScale(node, tensorById) ? [index] : []);
  const upsampleIndices = pathNodes.flatMap((node, index) => node.op === "upsample" && increasesSpatialScale(node, tensorById) ? [index] : []);
  if (downsampleIndices.length < 2) blockers.push("requires at least two verified downsample transitions on the input-to-output path");
  if (upsampleIndices.length < 2) blockers.push("requires at least two verified upsample transitions on the input-to-output path");
  const firstUpsampleIndex = upsampleIndices[0];
  if (firstUpsampleIndex === undefined || firstUpsampleIndex === 0 || downsampleIndices.some((index) => index >= firstUpsampleIndex)) {
    blockers.push("requires all downsample transitions to precede a bottleneck and decoder upsample path");
  }
  const encoder = downsampleIndices.map((downsampleIndex) => {
    const downsample = pathNodes[downsampleIndex]!;
    const node = pathNodes[downsampleIndex - 1];
    const tensorId = downsample.inputTensorIds[0];
    const scale = spatialScale(tensorId, tensorById);
    return node && tensorId && scale ? { node, downsample, tensorId, scale } : null;
  });
  if (encoder.some((stage) => !stage)) blockers.push("each path downsample transition requires an immediately preceding spatial encoder producer");
  const resolvedEncoder = encoder.filter((stage): stage is EncoderStage => stage !== null);
  const bottleneck = firstUpsampleIndex === undefined ? null : pathNodes[firstUpsampleIndex - 1] ?? null;
  const bottleneckTensorId = firstUpsampleIndex === undefined ? null : pathNodes[firstUpsampleIndex]!.inputTensorIds[0] ?? null;
  if (!bottleneck || !bottleneckTensorId) blockers.push("requires a bottleneck immediately before the first decoder upsample transition");

  const decoder: DecoderStage[] = [];
  const usedEncoderNodes = new Set<string>();
  for (const [pathIndex, concat] of pathNodes.entries()) {
    if (concat.op !== "concat") continue;
    const upsample = pathNodes[pathIndex - 1] ?? null;
    const decoderNode = pathNodes[pathIndex + 1] ?? null;
    if (concat.inputTensorIds.length !== 2) {
      blockers.push(`Concat "${concat.id}" requires exactly two inputs: one decoder upsample and one encoder skip`);
      continue;
    }
    const inputScales = concat.inputTensorIds.map((id) => spatialScale(id, tensorById));
    const outputScale = spatialScale(concat.outputTensorIds[0], tensorById);
    const sameScale = inputScales.length >= 2 && inputScales.every((scale) => equalScale(scale, inputScales[0])) && equalScale(inputScales[0], outputScale);
    const inputProducers = concat.inputTensorIds.map((tensorId) => ({ tensorId, producer: producerOf(tensorId, tensorById, nodeById) }));
    const decoderInputs = inputProducers.filter((item) => item.producer?.id === upsample?.id);
    const skipInputs = inputProducers.filter((item) => item.producer?.id !== upsample?.id);
    const encoderStage = skipInputs
      .map((item) => item.producer)
      .map((node) => resolvedEncoder.find((stage) => stage.node.id === node?.id))
      .find((stage): stage is EncoderStage => Boolean(stage)) ?? null;
    const decoderTensor = concat.outputTensorIds[0];
    const validDecoderBlock = decoderNode?.op === "conv2d" || decoderNode?.op === "depthwise_conv2d";
    if (!sameScale) blockers.push(`Concat "${concat.id}" requires scale-compatible encoder and decoder tensors`);
    if (decoderInputs.length !== 1 || skipInputs.length !== 1 || upsample?.op !== "upsample" || !increasesSpatialScale(upsample, tensorById) || !encoderStage || !validDecoderBlock || !decoderTensor || !outputScale) {
      blockers.push(`Concat "${concat.id}" must join the current decoder upsample with one encoder stage before a decoder block`);
      continue;
    }
    if (usedEncoderNodes.has(encoderStage.node.id)) {
      blockers.push(`Concat "${concat.id}" reuses encoder stage "${encoderStage.node.id}" instead of a distinct scale skip`);
      continue;
    }
    usedEncoderNodes.add(encoderStage.node.id);
    decoder.push({ concat, upsample, decoder: decoderNode, encoder: encoderStage, tensorId: decoderTensor, scale: outputScale });
  }
  if (decoder.length < 2) blockers.push("requires at least two verified encoder-to-decoder Concat joins on the input-to-output path");
  if (decoder.length !== resolvedEncoder.length) blockers.push("requires one verified Concat decoder stage for each encoder scale level");
  for (const [index, stage] of decoder.entries()) {
    const expectedEncoder = resolvedEncoder[resolvedEncoder.length - index - 1];
    if (expectedEncoder && stage.encoder.node.id !== expectedEncoder.node.id) {
      blockers.push(`Concat "${stage.concat.id}" must restore encoder scale "${expectedEncoder.node.id}" in reverse decoder order`);
    }
  }
  if (resolvedEncoder.length >= 2 && upsampleIndices.length >= 2 && decoder.length >= 2) reasons.push(`${resolvedEncoder.length} ordered downsample and ${upsampleIndices.length} ordered upsample transitions form an input-to-output encoder-decoder path`);
  if (decoder.length >= 2) reasons.push(`${decoder.length} scale-compatible Concat skips bridge distinct encoder and decoder levels`);
  if (blockers.length > 0 || !bottleneck || !bottleneckTensorId) return { topology: null, blockers: unique(blockers), reasons };
  return { topology: { input, output, encoder: resolvedEncoder, bottleneck, bottleneckTensorId, decoder }, blockers: [], reasons };
}

function selectMainPath(ir: CanonicalNetworkIR, inputId: string, outputId: string, tensors: Map<string, CanonicalNetworkIR["tensors"][number]>): string[] | null {
  const outgoing = new Map<string, string[]>();
  for (const edge of ir.edges.filter((edge) => edge.relation === "data")) {
    const targets = outgoing.get(edge.sourceNodeId) ?? [];
    targets.push(edge.targetNodeId);
    outgoing.set(edge.sourceNodeId, targets);
  }
  for (const targets of outgoing.values()) targets.sort();
  const paths: string[][] = [];
  const maximumPaths = 256;
  const visit = (nodeId: string, path: string[], seen: Set<string>): void => {
    if (paths.length > maximumPaths) return;
    if (nodeId === outputId) {
      paths.push(path);
      return;
    }
    for (const targetId of outgoing.get(nodeId) ?? []) {
      if (seen.has(targetId)) continue;
      visit(targetId, [...path, targetId], new Set([...seen, targetId]));
    }
  };
  visit(inputId, [inputId], new Set([inputId]));
  if (paths.length === 0 || paths.length > maximumPaths) return null;
  const nodeById = new Map(ir.nodes.map((node) => [node.id, node]));
  const ranked = paths
    .map((path) => ({ path, score: pathScore(path, nodeById, tensors) }))
    .sort((left, right) => right.score.downsamples - left.score.downsamples || right.score.upsamples - left.score.upsamples || right.score.concats - left.score.concats || right.score.length - left.score.length || left.path.join("/").localeCompare(right.path.join("/")));
  const eligible = ranked.filter((candidate) => candidate.score.downsamples >= 2 && candidate.score.upsamples >= 2 && candidate.score.concats >= 2);
  return eligible.length === 1 ? eligible[0]!.path : null;
}

function pathScore(path: string[], nodes: Map<string, CanonicalNode>, tensors: Map<string, CanonicalNetworkIR["tensors"][number]>): { downsamples: number; upsamples: number; concats: number; length: number } {
  const pathNodes = path.map((id) => nodes.get(id)!);
  return {
    downsamples: pathNodes.filter((node) => node.op === "pool" && reducesSpatialScale(node, tensors)).length,
    upsamples: pathNodes.filter((node) => node.op === "upsample" && increasesSpatialScale(node, tensors)).length,
    concats: pathNodes.filter((node) => node.op === "concat").length,
    length: pathNodes.length,
  };
}

function dataComponent(inputId: string, ir: CanonicalNetworkIR): Set<string> {
  const neighbors = new Map<string, Set<string>>();
  for (const edge of ir.edges.filter((item) => item.relation === "data")) {
    const source = neighbors.get(edge.sourceNodeId) ?? new Set<string>();
    source.add(edge.targetNodeId);
    neighbors.set(edge.sourceNodeId, source);
    const target = neighbors.get(edge.targetNodeId) ?? new Set<string>();
    target.add(edge.sourceNodeId);
    neighbors.set(edge.targetNodeId, target);
  }
  const connected = new Set<string>();
  const pending = [inputId];
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (connected.has(current)) continue;
    connected.add(current);
    for (const neighbor of neighbors.get(current) ?? []) if (!connected.has(neighbor)) pending.push(neighbor);
  }
  return connected;
}

function mappingFor(ir: CanonicalNetworkIR, displayId: string, nodeIds: string[]): FigureSourceMapping {
  const nodeSet = new Set(nodeIds);
  const nodes = ir.nodes.filter((node) => nodeSet.has(node.id));
  const edges = ir.edges.filter((edge) => nodeSet.has(edge.sourceNodeId) && nodeSet.has(edge.targetNodeId));
  return {
    displayId,
    networkNodeIds: nodes.map((node) => node.id),
    tensorIds: [...new Set(nodes.flatMap((node) => [...node.inputTensorIds, ...node.outputTensorIds]))],
    edgeIds: edges.map((edge) => edge.id),
    evidenceIds: [...new Set([...nodes.flatMap((node) => node.sourceEvidenceIds), ...edges.flatMap((edge) => edge.evidenceIds)])],
  };
}

function producerOf(tensorId: string | undefined, tensors: Map<string, CanonicalNetworkIR["tensors"][number]>, nodes: Map<string, CanonicalNode>): CanonicalNode | null {
  const producerId = tensorId ? tensors.get(tensorId)?.producerNodeId : null;
  return producerId ? nodes.get(producerId) ?? null : null;
}

function spatialScale(tensorId: string | undefined, tensors: Map<string, CanonicalNetworkIR["tensors"][number]>): SpatialScale | null {
  const tensor = tensorId ? tensors.get(tensorId) : undefined;
  const height = tensor ? axisValue(tensor.shape, tensor.axes, "height") : null;
  const width = tensor ? axisValue(tensor.shape, tensor.axes, "width") : null;
  return typeof height === "number" && typeof width === "number" ? { height, width } : null;
}

function axisValue(shape: Array<number | string>, axes: string[], axis: string): number | null {
  const index = axes.indexOf(axis);
  const value = index >= 0 ? shape[index] : null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function reducesSpatialScale(node: CanonicalNode, tensors: Map<string, CanonicalNetworkIR["tensors"][number]>): boolean {
  const input = spatialScale(node.inputTensorIds[0], tensors);
  const output = spatialScale(node.outputTensorIds[0], tensors);
  return Boolean(input && output && output.height < input.height && output.width < input.width);
}

function increasesSpatialScale(node: CanonicalNode, tensors: Map<string, CanonicalNetworkIR["tensors"][number]>): boolean {
  const input = spatialScale(node.inputTensorIds[0], tensors);
  const output = spatialScale(node.outputTensorIds[0], tensors);
  return Boolean(input && output && output.height > input.height && output.width > input.width);
}

function equalScale(left: SpatialScale | null | undefined, right: SpatialScale | null | undefined): boolean {
  return Boolean(left && right && left.height === right.height && left.width === right.width);
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
function tensorLabel(ir: CanonicalNetworkIR, tensorId: string | undefined): string | null { const tensor = ir.tensors.find((item) => item.id === tensorId); return tensor ? tensor.shape.join(" × ") : null; }
function requiredNode(model: FigureSemanticModel, id: string): FigureSemanticModel["displayNodes"][number] { const node = model.displayNodes.find((item) => item.id === id); if (!node) throw new Error(`encoder-decoder semantic model requires ${id}`); return node; }
function numericSemantic(node: FigureSemanticModel["displayNodes"][number], key: string, fallback: number): number { const value = node.semantic[key]; return typeof value === "number" ? value : fallback; }

function addPrimitive(
  primitives: Array<{ id: string; kind: "tensor_volume" | "block_frame" | "merge_marker" | "annotation_track"; bounds: FigureBounds; semantic: Record<string, string | number | boolean | null>; sourceDisplayId: string }>,
  primitiveFor: Map<string, string>,
  boundsFor: Map<string, FigureBounds>,
  node: FigureSemanticModel["displayNodes"][number],
  kind: "tensor_volume" | "block_frame",
  bounds: FigureBounds,
  semantic: Record<string, string | number | boolean | null>,
): void {
  const id = `primitive-${node.id}`;
  primitiveFor.set(node.id, id);
  boundsFor.set(node.id, bounds);
  primitives.push({ id, kind, bounds, semantic, sourceDisplayId: node.id });
}

function horizontalOrVerticalRoute(source: FigureBounds, target: FigureBounds): Array<{ x: number; y: number }> {
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterY = target.y + target.height / 2;
  if (Math.abs(sourceCenterY - targetCenterY) < 0.001) return [{ x: source.x + source.width, y: sourceCenterY }, { x: target.x, y: targetCenterY }];
  const sourceCenterX = source.x + source.width / 2;
  const targetCenterX = target.x + target.width / 2;
  return [{ x: sourceCenterX, y: source.y + source.height }, { x: targetCenterX, y: target.y }];
}

function labelBounds(bounds: FigureBounds): FigureBounds { return { x: bounds.x, y: Math.max(65, bounds.y - 26), width: bounds.width, height: 18 }; }
function markerLabelBounds(bounds: FigureBounds): FigureBounds { return { x: bounds.x - 14, y: Math.max(65, bounds.y - 22), width: 58, height: 16 }; }
