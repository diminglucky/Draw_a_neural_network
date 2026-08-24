import type { ComposableSemanticRegionKind } from "./composable-semantic-regions.js";

export const PUBLICATION_VISUAL_PRIMITIVE_KINDS = [
  "InputTerminal",
  "OutputTerminal",
  "TensorStage",
  "TensorVolume",
  "OperatorFrame",
  "ModuleFrame",
  "RepeatBadge",
  "SplitMarker",
  "AddMarker",
  "ConcatMarker",
  "AttentionTokenStrip",
  "AttentionRelation",
  "CandidateCallout",
] as const;

export type PublicationVisualPrimitiveKind = typeof PUBLICATION_VISUAL_PRIMITIVE_KINDS[number];
export type PublicationVisualRegionRole = "base" | ComposableSemanticRegionKind;
export type PublicationVisualNativeSupport = "supported" | "restricted";
export type PublicationVisualGeometryRequirement = "none" | "tensor_volume" | "ordered_cells";

export interface PublicationVisualGrammarDescriptor {
  readonly kind: PublicationVisualPrimitiveKind;
  readonly regionRole: PublicationVisualRegionRole;
  readonly requiredPorts: readonly string[];
  readonly mappingRule: "component" | "semantic_region" | "semantic_relation";
  readonly styleTokenIds: readonly string[];
  readonly nativeSupport: PublicationVisualNativeSupport;
  readonly geometry: Readonly<{
    readonly frontFace?: "required";
    readonly depthFace?: "required";
    readonly orderedCells?: "required";
    readonly requirement: PublicationVisualGeometryRequirement;
  }>;
}

const GRAMMAR: readonly PublicationVisualGrammarDescriptor[] = Object.freeze([
  descriptor("InputTerminal", "base", ["output"], "component", "style:terminal"),
  descriptor("OutputTerminal", "base", ["input"], "component", "style:terminal"),
  descriptor("TensorStage", "scale_transition", ["input", "output"], "semantic_region", "style:tensor-stage"),
  descriptor("TensorVolume", "scale_transition", ["input", "output"], "semantic_region", "style:tensor-volume", { requirement: "tensor_volume", frontFace: "required", depthFace: "required" }),
  descriptor("OperatorFrame", "base", ["input", "output"], "component", "style:operator"),
  descriptor("ModuleFrame", "custom_module", ["input", "output"], "component", "style:module"),
  descriptor("RepeatBadge", "repeat_group", [], "semantic_region", "style:repeat"),
  descriptor("SplitMarker", "multi_branch", ["input", "output"], "semantic_relation", "style:split"),
  descriptor("AddMarker", "add_merge", ["input-0", "input-1", "output"], "component", "style:add"),
  descriptor("ConcatMarker", "concat_fusion", ["input-0", "input-1", "output"], "component", "style:concat"),
  descriptor("AttentionTokenStrip", "token_attention", ["input", "output"], "semantic_region", "style:attention", { requirement: "ordered_cells", orderedCells: "required" }),
  descriptor("AttentionRelation", "token_attention", [], "semantic_relation", "style:attention"),
  descriptor("CandidateCallout", "candidate_feedback", [], "semantic_region", "style:candidate", { requirement: "none" }, "restricted"),
]);

function descriptor(
  kind: PublicationVisualPrimitiveKind,
  regionRole: PublicationVisualRegionRole,
  requiredPorts: readonly string[],
  mappingRule: PublicationVisualGrammarDescriptor["mappingRule"],
  styleTokenId: string,
  geometry: PublicationVisualGrammarDescriptor["geometry"] = { requirement: "none" },
  nativeSupport: PublicationVisualNativeSupport = "supported",
): PublicationVisualGrammarDescriptor {
  return Object.freeze({ kind, regionRole, requiredPorts: Object.freeze([...requiredPorts]), mappingRule, styleTokenIds: Object.freeze([styleTokenId]), nativeSupport, geometry: Object.freeze({ ...geometry }) });
}

export function getPublicationVisualGrammar(): readonly PublicationVisualGrammarDescriptor[] {
  return GRAMMAR.map((item) => Object.freeze({ ...item, requiredPorts: Object.freeze([...item.requiredPorts]), styleTokenIds: Object.freeze([...item.styleTokenIds]), geometry: Object.freeze({ ...item.geometry }) }));
}

export function getPublicationVisualGrammarDescriptor(kind: PublicationVisualPrimitiveKind): PublicationVisualGrammarDescriptor {
  const descriptor = GRAMMAR.find((item) => item.kind === kind);
  if (!descriptor) throw new Error(`Unsupported publication visual primitive kind: ${kind}`);
  return descriptor;
}

export function isPublicationVisualPrimitiveKind(value: unknown): value is PublicationVisualPrimitiveKind {
  return typeof value === "string" && (PUBLICATION_VISUAL_PRIMITIVE_KINDS as readonly string[]).includes(value);
}
