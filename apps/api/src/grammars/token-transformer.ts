import type { FigureIntent } from "../figure-intent.js";
import { parseFigureSemanticModel, type FigureSemanticModel, type FigureSourceMapping } from "../figure-semantic-model.js";
import type { FigureGrammar, GrammarScore } from "../grammar-registry.js";
import { parseCanonicalNetworkIR, type CanonicalNetworkIR } from "../network-ir-v2.js";
import { parsePublicationFigurePlanV2, type FigureBounds, type PublicationFigurePlanV2 } from "../publication-figure-plan-v2.js";
import { runVisualQa } from "../visual-qa.js";

type CanonicalNode = CanonicalNetworkIR["nodes"][number];
type CanonicalEdge = CanonicalNetworkIR["edges"][number];

interface DataSpine {
  nodeIds: string[];
  edges: CanonicalEdge[];
}

interface TokenTransformerTopology {
  input: CanonicalNode;
  tokenization: CanonicalNode[];
  transformer: CanonicalNode;
  head: CanonicalNode[];
  inputToTokenization: CanonicalEdge;
  tokenizationToTransformer: CanonicalEdge;
  transformerToHead: CanonicalEdge;
}

interface Analysis { topology: TokenTransformerTopology | null; blockers: string[]; reasons: string[]; }

interface CompilableTokenTransformerGrammar extends FigureGrammar {
  compileSemanticModel(ir: CanonicalNetworkIR, intent: FigureIntent): FigureSemanticModel;
  compilePlan(model: FigureSemanticModel, intent: FigureIntent): PublicationFigurePlanV2;
}

export const tokenTransformerGrammar: CompilableTokenTransformerGrammar = {
  id: "token-transformer",
  version: 1,
  evaluate(ir, _intent): GrammarScore {
    const analysis = analyze(ir);
    return { grammarId: "token-transformer", score: analysis.topology ? 0.92 : 0.1, reasons: analysis.reasons, blockers: analysis.blockers };
  },
  compileSemanticModel(ir, intent) {
    parseCanonicalNetworkIR(ir, undefined, { renderReady: true });
    const analysis = analyze(ir);
    if (!analysis.topology || analysis.blockers.length > 0) throw new Error(`token-transformer requires verified topology: ${analysis.blockers.join("; ")}`);
    const topology = analysis.topology;
    const displayNodes: FigureSemanticModel["displayNodes"] = [
      { id: "input-stage", role: "input", label: "Input", summary: tensorLabel(ir, topology.input.outputTensorIds[0]), semantic: {} },
      { id: "tokenization", role: "token", label: "Patch + position embedding", summary: tokenLabel(ir, topology.tokenization[topology.tokenization.length - 1]!.outputTensorIds[0]), semantic: { tokenization: true, representation: "token_feature" } },
      { id: "transformer-encoder", role: "operator_block", label: "Transformer encoder", summary: tokenLabel(ir, topology.transformer.outputTensorIds[0]), semantic: { repeatCount: topology.transformer.repeats?.count ?? 1, attention: "self", representation: "token_feature" } },
      { id: "output-head", role: "head", label: "Prediction head", summary: "Token representation to output prediction", semantic: {} },
    ];
    const sourceMappings: FigureSourceMapping[] = [
      mappingFor(ir, "input-stage", [topology.input.id], [topology.inputToTokenization]),
      mappingFor(ir, "tokenization", topology.tokenization.map((node) => node.id), [topology.tokenizationToTransformer]),
      mappingFor(ir, "transformer-encoder", [topology.transformer.id], [topology.transformerToHead]),
      mappingFor(ir, "output-head", topology.head.map((node) => node.id)),
    ];
    return parseFigureSemanticModel({
      version: 1,
      grammar: { id: "token-transformer", version: 1 },
      regions: [
        { id: "tokenization", label: "Tokenization", role: "tokenization", displayIds: ["input-stage", "tokenization"] },
        { id: "transformer-encoder", label: "Transformer encoder", role: "encoder", displayIds: ["transformer-encoder"] },
        { id: "head", label: "Head", role: "head", displayIds: ["output-head"] },
      ],
      displayNodes,
      displayRelations: [
        { id: "token-flow", role: "flow", sourceDisplayId: "input-stage", targetDisplayId: "tokenization", label: null, semantic: {} },
        { id: "self-attention", role: "attention", sourceDisplayId: "tokenization", targetDisplayId: "transformer-encoder", label: "Self-attention", semantic: { attention: "self" } },
        { id: "head-flow", role: "flow", sourceDisplayId: "transformer-encoder", targetDisplayId: "output-head", label: null, semantic: {} },
      ],
      sourceMappings,
      narrative: { title: ir.figure.title, summary: "Tokenization creates a token sequence that is processed by a compact repeated Transformer encoder before prediction.", stageSummaries: displayNodes.map((node) => node.label) },
    }, ir, intent);
  },
  compilePlan(model, intent) {
    if (model.grammar.id !== "token-transformer") throw new Error("token-transformer can only compile its own semantic model");
    const input = required(model, "input-stage");
    const tokenization = required(model, "tokenization");
    const transformer = required(model, "transformer-encoder");
    const head = required(model, "output-head");
    const positions = new Map<string, FigureBounds>([
      [input.id, { x: 35, y: 185, width: 130, height: 100 }],
      [tokenization.id, { x: 235, y: 165, width: 175, height: 140 }],
      [transformer.id, { x: 485, y: 135, width: 260, height: 200 }],
      [head.id, { x: 825, y: 185, width: 145, height: 100 }],
    ]);
    const primitiveFor = new Map<string, string>();
    const primitives: PublicationFigurePlanV2["primitives"] = [];
    for (const node of [input, tokenization, transformer, head]) {
      const id = `primitive-${node.id}`;
      primitiveFor.set(node.id, id);
      primitives.push({ id, kind: "block_frame", bounds: positions.get(node.id)!, semantic: { role: node.role, repeatCount: numeric(node, "repeatCount", 1) }, sourceDisplayId: node.id });
    }
    primitives.push({ id: "annotation-track", kind: "annotation_track", bounds: { x: 25, y: 395, width: 955, height: 70 }, semantic: { role: "annotation" }, sourceDisplayId: input.id });
    const flow = (id: string, source: FigureSemanticModel["displayNodes"][number], target: FigureSemanticModel["displayNodes"][number], stroke: "solid" | "dotted", tone: "dark" | "mid", semantic: Record<string, string | number | boolean | null>) => ({
      id,
      kind: "flow_arrow" as const,
      sourcePrimitiveId: primitiveFor.get(source.id)!,
      targetPrimitiveId: primitiveFor.get(target.id)!,
      route: horizontal(positions.get(source.id)!, positions.get(target.id)!),
      semantic,
      sourceDisplayId: source.id,
      style: { stroke, tone, thickness: 1 },
    });
    const plan = parsePublicationFigurePlanV2({
      version: 2,
      target: "preview",
      renderIntent: { density: intent.density, printMode: intent.printMode },
      grammar: { id: "token-transformer", version: model.grammar.version },
      coordinateSpace: { unit: "figure-unit", figureUnitInches: 0.01, origin: "top-left", width: 1020, height: 500 },
      regions: [
        { id: "tokenization", label: "Tokenization", role: "tokenization", bounds: { x: 20, y: 100, width: 420, height: 260 } },
        { id: "transformer-encoder", label: "Transformer encoder", role: "encoder", bounds: { x: 450, y: 100, width: 330, height: 260 } },
        { id: "head", label: "Head", role: "head", bounds: { x: 800, y: 150, width: 190, height: 190 } },
      ],
      primitives,
      relations: [flow("flow-input", input, tokenization, "solid", "dark", {}), flow("attention-flow", tokenization, transformer, "dotted", "mid", { attention: "self" }), flow("flow-head", transformer, head, "solid", "dark", {})],
      annotations: [
        { id: "title", targetId: primitiveFor.get(input.id)!, role: "heading", text: truncateText(model.narrative.title, 64), bounds: { x: 35, y: 35, width: 600, height: 28 }, fontSizePt: 14 },
        ...[input, tokenization, transformer, head].map((node) => ({ id: `label-${node.id}`, targetId: primitiveFor.get(node.id)!, role: "detail" as const, text: annotationText(node), bounds: label(positions.get(node.id)!), fontSizePt: 8 })),
      ],
      sourceMappings: model.sourceMappings.map((mapping) => ({ mappingId: `mapping-${mapping.displayId}`, ...mapping })),
      qaContract: { minFontSizePt: 7, printMode: intent.printMode, maxPrimitiveCount: 600 },
    });
    const qa = runVisualQa(plan);
    if (qa.blocking.length > 0) throw new Error(`token-transformer produced a plan that failed visual QA: ${qa.blocking.map((issue) => issue.code).join(", ")}`);
    return plan;
  },
};

function analyze(ir: CanonicalNetworkIR): Analysis {
  const blockers: string[] = [];
  const reasons: string[] = [];
  const inputs = ir.nodes.filter((node) => node.op === "input");
  const outputs = ir.nodes.filter((node) => node.op === "output");
  if (inputs.length !== 1) blockers.push("requires exactly one input node");
  if (outputs.length !== 1) blockers.push("requires exactly one output node");
  if (ir.edges.some((edge) => edge.relation !== "data")) blockers.push("non-data relations require a dedicated Transformer grammar");
  if (ir.nodes.some((node) => ["conv2d", "depthwise_conv2d", "pool", "upsample", "concat", "add"].includes(node.op))) blockers.push("spatial or multi-branch semantics require a non-token grammar");
  const spine = inputs[0] && outputs[0] ? linearDataSpine(ir, inputs[0].id, outputs[0].id) : null;
  if (!spine || spine.nodeIds.length !== ir.nodes.length) blockers.push("requires one unambiguous linear token data path without detached branches");
  const ordered = spine ? spine.nodeIds.map((id) => ir.nodes.find((node) => node.id === id)!) : [];
  const transformerBlocks = ordered.filter((node) => node.op === "transformer_block");
  if (transformerBlocks.length !== 1) blockers.push("requires exactly one repeated transformer block; multiple distinct transformer stages require a dedicated grammar");
  const transformer = transformerBlocks[0] ?? null;
  const transformerIndex = transformer ? ordered.findIndex((node) => node.id === transformer.id) : -1;
  const tokenization = transformerIndex >= 0 ? ordered.slice(1, transformerIndex) : [];
  const head = transformerIndex >= 0 ? ordered.slice(transformerIndex + 1) : [];
  if (ordered.length > 0 && (ordered[0]?.op !== "input" || ordered.at(-1)?.op !== "output")) blockers.push("requires an input-to-output token path");
  if (tokenization.length === 0 || tokenization.some((node) => node.op !== "embedding")) blockers.push("tokenization must precede the transformer block and contain only embedding stages");
  if (head.length < 2 || head.at(-1)?.op !== "output" || head.slice(0, -1).some((node) => node.op !== "classifier" && node.op !== "dense")) blockers.push("requires classifier or dense prediction stages followed by output");
  if (!transformer) blockers.push("requires a transformer block");
  const repeat = transformer?.repeats;
  const repeatGroupVerified = Boolean(transformer && repeat && repeat.count > 1 && transformer.sourceEvidenceIds.length > 0 && repeat.unitNodeIds.includes(transformer.id) && ir.groups.some((group) => sameIds(group.nodeIds, repeat.unitNodeIds) && group.sourceEvidenceIds.length > 0));
  if (!repeatGroupVerified) blockers.push("transformer block requires verified repeat metadata that identifies the transformer unit");
  const finalEmbedding = tokenization.at(-1);
  const finalEmbeddingOutput = finalEmbedding?.outputTensorIds[0];
  const transformerInput = transformer?.inputTensorIds[0];
  const transformerOutput = transformer?.outputTensorIds[0];
  if (!isTokenFeatureTensor(ir, finalEmbeddingOutput)) blockers.push("tokenization output must be a token-feature tensor");
  if (!isTokenFeatureTensor(ir, transformerInput)) blockers.push("transformer block must consume a token-feature tensor");
  if (!isTokenFeatureTensor(ir, transformerOutput)) blockers.push("transformer block must produce a token-feature tensor");
  const inputToTokenization = spine?.edges[0] ?? null;
  const tokenizationToTransformer = transformerIndex > 0 ? spine?.edges[transformerIndex - 1] ?? null : null;
  const transformerToHead = transformerIndex >= 0 ? spine?.edges[transformerIndex] ?? null : null;
  if ([inputToTokenization, tokenizationToTransformer, transformerToHead].some((edge) => !edge || edge.evidenceIds.length === 0)) blockers.push("every visible flow requires an evidence-backed canonical data edge");
  if (blockers.length > 0 || !inputs[0] || !transformer || !inputToTokenization || !tokenizationToTransformer || !transformerToHead) return { topology: null, blockers: [...new Set(blockers)], reasons };
  reasons.push("token-feature tensors and embedding stages are present");
  reasons.push(`transformer encoder repeats ${transformer.repeats?.count ?? 1} block(s)`);
  return { topology: { input: inputs[0], tokenization, transformer, head, inputToTokenization, tokenizationToTransformer, transformerToHead }, blockers: [], reasons };
}

function linearDataSpine(ir: CanonicalNetworkIR, inputId: string, outputId: string): DataSpine | null {
  const dataEdges = ir.edges.filter((edge) => edge.relation === "data");
  const outgoing = new Map<string, CanonicalEdge[]>();
  const incoming = new Map<string, CanonicalEdge[]>();
  for (const edge of dataEdges) {
    outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) ?? []), edge]);
    incoming.set(edge.targetNodeId, [...(incoming.get(edge.targetNodeId) ?? []), edge]);
  }
  const path = [inputId];
  const spineEdges: CanonicalEdge[] = [];
  const seen = new Set(path);
  while (path[path.length - 1] !== outputId) {
    const current = path[path.length - 1]!;
    const next = outgoing.get(current) ?? [];
    if (next.length !== 1 || seen.has(next[0]!.targetNodeId)) return null;
    spineEdges.push(next[0]!);
    path.push(next[0]!.targetNodeId);
    seen.add(next[0]!.targetNodeId);
  }
  if (dataEdges.length !== spineEdges.length || (incoming.get(inputId) ?? []).length !== 0 || (outgoing.get(outputId) ?? []).length !== 0) return null;
  if (spineEdges.some((edge) => edge.tensorIds.length !== 1)) return null;
  const nodeById = new Map(ir.nodes.map((node) => [node.id, node]));
  for (const [index, nodeId] of path.entries()) {
    const node = nodeById.get(nodeId);
    if (!node) return null;
    const previous = index > 0 ? spineEdges[index - 1] : null;
    const next = index < spineEdges.length ? spineEdges[index] : null;
    if ((incoming.get(nodeId) ?? []).length !== (previous ? 1 : 0) || (outgoing.get(nodeId) ?? []).length !== (next ? 1 : 0)) return null;
    if ((previous && node.inputTensorIds.length !== 1) || (!previous && node.inputTensorIds.length !== 0) || (next && node.outputTensorIds.length !== 1) || (!next && node.outputTensorIds.length !== 0)) return null;
    if (!sameIds(node.inputTensorIds, previous?.tensorIds ?? []) || !sameIds(node.outputTensorIds, next?.tensorIds ?? [])) return null;
  }
  return { nodeIds: path, edges: spineEdges };
}

function mappingFor(ir: CanonicalNetworkIR, displayId: string, nodeIds: string[], boundaryEdges: CanonicalEdge[] = []): FigureSourceMapping {
  const set = new Set(nodeIds);
  const nodes = ir.nodes.filter((node) => set.has(node.id));
  const edges = [...new Map([...ir.edges.filter((edge) => set.has(edge.sourceNodeId) || set.has(edge.targetNodeId)), ...boundaryEdges].map((edge) => [edge.id, edge])).values()];
  return { displayId, networkNodeIds: nodes.map((node) => node.id), tensorIds: [...new Set(nodes.flatMap((node) => [...node.inputTensorIds, ...node.outputTensorIds]))], edgeIds: edges.map((edge) => edge.id), evidenceIds: [...new Set([...nodes.flatMap((node) => node.sourceEvidenceIds), ...edges.flatMap((edge) => edge.evidenceIds)])] };
}

function tensorLabel(ir: CanonicalNetworkIR, id: string | undefined): string | null { const tensor = ir.tensors.find((item) => item.id === id); return tensor ? tensor.shape.join(" × ") : null; }
function tokenLabel(ir: CanonicalNetworkIR, id: string | undefined): string | null {
  const tensor = ir.tensors.find((item) => item.id === id);
  return tensor && isTokenFeatureTensor(ir, id) ? `tokens × features · ${tensor.shape.join(" × ")}` : null;
}
function isTokenFeatureTensor(ir: CanonicalNetworkIR, id: string | undefined): boolean { const tensor = ir.tensors.find((item) => item.id === id); return Boolean(tensor?.axes.includes("token") && tensor.axes.includes("feature")); }
function sameIds(left: string[], right: string[]): boolean { return left.length === right.length && new Set(left).size === left.length && new Set(right).size === right.length && left.every((id) => right.includes(id)); }
function truncateText(value: string, maxLength: number): string { return value.length <= maxLength ? value : `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`; }
function required(model: FigureSemanticModel, id: string): FigureSemanticModel["displayNodes"][number] { const node = model.displayNodes.find((item) => item.id === id); if (!node) throw new Error(`token-transformer semantic model requires ${id}`); return node; }
function numeric(node: FigureSemanticModel["displayNodes"][number], key: string, fallback: number): number { const value = node.semantic[key]; return typeof value === "number" ? value : fallback; }
function annotationText(node: FigureSemanticModel["displayNodes"][number]): string {
  if (node.id === "tokenization") return "Tokenize · tokens × features";
  if (node.id === "transformer-encoder") return `Transformer encoder ×${numeric(node, "repeatCount", 1)} · tokens × features`;
  return node.label;
}
function horizontal(source: FigureBounds, target: FigureBounds): Array<{ x: number; y: number }> { return [{ x: source.x + source.width, y: source.y + source.height / 2 }, { x: target.x, y: target.y + target.height / 2 }]; }
function label(bounds: FigureBounds): FigureBounds { return { x: bounds.x, y: bounds.y + bounds.height + 18, width: bounds.width, height: 18 }; }
