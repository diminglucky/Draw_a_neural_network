import {
  unknownCustomSpatialBackboneUgs,
  unknownDualStreamFusionUgs,
  unknownDualTowerCrossModalFusionUgs,
  unknownHybridSemanticRegionsCandidateUgs,
  unknownHybridSemanticRegionsUgs,
  unknownMultiScaleEncoderDecoderUgs,
  unknownRepeatedFusionStackUgs,
  unknownResidualMultiBranchUgs,
} from "./universal-graph-spec.js";

export interface PublicationVisualCorpusCase {
  readonly corpusCaseId: string;
  readonly createUgs: () => unknown;
  readonly expected: {
    readonly kind: "formal" | "candidate";
    readonly minimumUgsNodes: number;
    readonly requiredComponentRoles: readonly string[];
    readonly requiredPrimitiveKinds: readonly string[];
  };
}

/**
 * Anonymous structural inputs used to regression-test the generic UGS → GPG
 * → PVP → public SVG path.  They are intentionally organised by observable
 * topology and visual grammar, not by named network families or templates.
 */
export const publicationVisualCorpus: readonly PublicationVisualCorpusCase[] = Object.freeze([
  {
    corpusCaseId: "corpus.operator-chain",
    createUgs: unknownCustomSpatialBackboneUgs,
    expected: { kind: "formal", minimumUgsNodes: 5, requiredComponentRoles: ["input", "output", "custom_operator", "custom_module"], requiredPrimitiveKinds: ["InputTerminal", "OutputTerminal", "OperatorFrame", "ModuleFrame"] },
  },
  {
    corpusCaseId: "corpus.dual-stream-join",
    createUgs: unknownDualStreamFusionUgs,
    expected: { kind: "formal", minimumUgsNodes: 5, requiredComponentRoles: ["custom_fusion"], requiredPrimitiveKinds: ["InputTerminal", "OutputTerminal", "OperatorFrame", "ModuleFrame"] },
  },
  {
    corpusCaseId: "corpus.repeated-join",
    createUgs: unknownRepeatedFusionStackUgs,
    expected: { kind: "formal", minimumUgsNodes: 6, requiredComponentRoles: ["custom_fusion", "repeat_badge"], requiredPrimitiveKinds: ["InputTerminal", "OutputTerminal", "RepeatBadge"] },
  },
  {
    corpusCaseId: "corpus.branch-add-skip",
    createUgs: unknownResidualMultiBranchUgs,
    expected: { kind: "formal", minimumUgsNodes: 6, requiredComponentRoles: ["split", "merge_add"], requiredPrimitiveKinds: ["SplitMarker", "AddMarker"] },
  },
  {
    corpusCaseId: "corpus.scale-concat-skip",
    createUgs: unknownMultiScaleEncoderDecoderUgs,
    expected: { kind: "formal", minimumUgsNodes: 8, requiredComponentRoles: ["merge_concat"], requiredPrimitiveKinds: ["ConcatMarker", "ModuleFrame"] },
  },
  {
    corpusCaseId: "corpus.dual-input-hub",
    createUgs: unknownDualTowerCrossModalFusionUgs,
    expected: { kind: "formal", minimumUgsNodes: 6, requiredComponentRoles: ["custom_fusion"], requiredPrimitiveKinds: ["InputTerminal", "ModuleFrame"] },
  },
  {
    corpusCaseId: "corpus.composite-semantic-regions",
    createUgs: unknownHybridSemanticRegionsUgs,
    expected: { kind: "formal", minimumUgsNodes: 9, requiredComponentRoles: ["repeat_badge", "merge_add", "merge_concat"], requiredPrimitiveKinds: ["TensorVolume", "RepeatBadge", "AddMarker", "ConcatMarker", "AttentionTokenStrip", "AttentionRelation"] },
  },
  {
    corpusCaseId: "corpus.ambiguous-topology",
    createUgs: unknownHybridSemanticRegionsCandidateUgs,
    expected: { kind: "candidate", minimumUgsNodes: 9, requiredComponentRoles: ["candidate_region"], requiredPrimitiveKinds: ["CandidateCallout"] },
  },
]);
