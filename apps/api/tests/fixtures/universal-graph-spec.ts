const sourceHash = "a".repeat(64);

export function unknownDualStreamFusionUgs(): any {
  return {
    version: 1,
    graphId: "novel-dual-stream-fusion",
    revision: 1,
    sourceIds: ["prompt-1"],
    sourceHashes: [sourceHash],
    nodes: [
      node("input", "input", "Input", [], ["input:out"], "known", "proven", ["e-input"]),
      node("texture_mixer", "custom_operator", "Texture mixer", ["texture_mixer:in"], ["texture_mixer:out"], "custom", "unknown", ["e-texture"]),
      node("context_router", "custom_operator", "Context router", ["context_router:in"], ["context_router:out"], "custom", "unknown", ["e-context"]),
      node("spectral_fusion", "custom_module", "Spectral fusion", ["spectral_fusion:left", "spectral_fusion:right"], ["spectral_fusion:out"], "custom", "unknown", ["e-fusion"]),
      node("output", "output", "Prediction", ["output:in"], [], "known", "unknown", ["e-output"]),
    ],
    ports: [
      port("input:out", "input", "output"),
      port("texture_mixer:in", "texture_mixer", "input"),
      port("texture_mixer:out", "texture_mixer", "output"),
      port("context_router:in", "context_router", "input"),
      port("context_router:out", "context_router", "output"),
      port("spectral_fusion:left", "spectral_fusion", "input"),
      port("spectral_fusion:right", "spectral_fusion", "input"),
      port("spectral_fusion:out", "spectral_fusion", "output"),
      port("output:in", "output", "input"),
    ],
    edges: [
      edge("input-to-texture", "input:out", "texture_mixer:in", "e-texture"),
      edge("input-to-context", "input:out", "context_router:in", "e-context"),
      edge("texture-to-fusion", "texture_mixer:out", "spectral_fusion:left", "e-fusion"),
      edge("context-to-fusion", "context_router:out", "spectral_fusion:right", "e-fusion"),
      edge("fusion-to-output", "spectral_fusion:out", "output:in", "e-output"),
    ],
    groups: [],
    evidence: [
      evidence("e-input"),
      evidence("e-texture"),
      evidence("e-context"),
      evidence("e-fusion"),
      evidence("e-output"),
    ],
    topologyConfidence: 0.95,
    unresolved: [],
  };
}

export function unknownRepeatedFusionStackUgs(): any {
  const input = unknownDualStreamFusionUgs();
  input.nodes.splice(input.nodes.length - 1, 0, node(
    "spectral_stack",
    "container",
    "Spectral fusion stack",
    ["spectral_stack:in"],
    ["spectral_stack:out"],
    "custom",
    "unknown",
    ["e-fusion"],
  ));
  input.nodes.find((item: any) => item.nodeId === "spectral_stack").attributes = {
    repeatCount: 3,
    repeatGroupId: "spectral-stack-unit",
  };
  input.ports.push(
    port("spectral_stack:in", "spectral_stack", "input"),
    port("spectral_stack:out", "spectral_stack", "output"),
  );
  input.edges = input.edges.map((item: any) => item.edgeId === "fusion-to-output"
    ? edge("fusion-to-stack", "spectral_fusion:out", "spectral_stack:in", "e-fusion")
    : item,
  );
  input.edges.push(edge("stack-to-output", "spectral_stack:out", "output:in", "e-output"));
  input.groups.push({
    groupId: "spectral-stack-unit",
    label: "Spectral fusion unit",
    memberNodeIds: ["texture_mixer", "context_router", "spectral_fusion"],
    evidenceIds: ["e-fusion"],
  });
  return input;
}

/**
 * Anonymous structural corpus for semantic-region derivation.  It deliberately
 * combines generic facts instead of naming or routing through an architecture.
 */
export function unknownHybridSemanticRegionsUgs(): any {
  const input = zeroTemplateUgs({
    graphId: "unknown-hybrid-semantic-regions",
    nodes: [
      { id: "source_field", kind: "input", label: "Source field" },
      {
        id: "spatial_stage",
        kind: "custom_operator",
        label: "Spatial stage",
        attributes: { repeatCount: 3, repeatGroupId: "repeat-core" },
      },
      { id: "left_path", kind: "custom_operator", label: "Left path" },
      { id: "right_path", kind: "custom_operator", label: "Right path" },
      { id: "add_gate", kind: "operator", label: "Add gate", attributes: { mergeKind: "add" } },
      { id: "concat_gate", kind: "operator", label: "Concat gate", attributes: { mergeKind: "concat" } },
      {
        id: "token_attention",
        kind: "operator",
        label: "Token relation",
        semanticHints: ["attention", "self_attention", "self"],
        attributes: { attentionKind: "self" },
      },
      { id: "opaque_module", kind: "custom_module", label: "Opaque module" },
      { id: "result_field", kind: "output", label: "Result field" },
    ],
    edges: [
      { id: "source-to-spatial", from: "source_field", to: "spatial_stage" },
      { id: "spatial-to-left", from: "spatial_stage", to: "left_path" },
      { id: "spatial-to-right", from: "spatial_stage", to: "right_path" },
      { id: "left-to-add", from: "left_path", to: "add_gate", relation: "merge" },
      { id: "right-to-add", from: "right_path", to: "add_gate", relation: "merge" },
      { id: "add-to-concat", from: "add_gate", to: "concat_gate", relation: "merge" },
      { id: "spatial-to-concat", from: "spatial_stage", to: "concat_gate", relation: "merge" },
      { id: "concat-to-attention", from: "concat_gate", to: "token_attention" },
      { id: "attention-to-module", from: "token_attention", to: "opaque_module" },
      { id: "module-to-result", from: "opaque_module", to: "result_field" },
    ],
  });

  input.edges = input.edges.map((edge: any) => ({ ...edge, knowledge: "proven" }));
  input.groups = [{
    groupId: "repeat-core",
    label: "Repeated core",
    memberNodeIds: ["spatial_stage"],
    evidenceIds: ["e-topology"],
  }];
  const facts = (channels: number, height: number, width: number) => ({
    axes: ["channels", "height", "width"],
    dimensions: { channels, height, width },
    evidenceIds: ["e-topology"],
  });
  for (const node of input.nodes) node.tensorFacts = facts(32, 32, 32);
  input.nodes.find((node: any) => node.nodeId === "source_field").tensorFacts = facts(16, 64, 64);
  return input;
}

export function unknownHybridSemanticRegionsCandidateUgs(): any {
  const input = unknownHybridSemanticRegionsUgs();
  input.edges.push({
    edgeId: "candidate-topology",
    sourcePortId: "spatial-to-left:output",
    targetPortId: "attention-to-module:input",
    relation: "candidate",
    knowledge: "candidate",
    evidenceIds: ["e-topology"],
  });
  return input;
}

export function unknownHybridSemanticRegionsFeedbackUgs(): any {
  const input = unknownHybridSemanticRegionsUgs();
  input.edges.push({
    edgeId: "feedback-topology",
    sourcePortId: "module-to-result:output",
    targetPortId: "spatial-to-left:input",
    relation: "feedback",
    knowledge: "proven",
    evidenceIds: ["e-topology"],
  });
  return input;
}

export function scaleLikeLabelsWithoutFactsUgs(): any {
  return zeroTemplateUgs({
    graphId: "scale-like-labels-without-facts",
    nodes: [
      { id: "input_field", kind: "input", label: "Input field" },
      { id: "pool_word", kind: "operator", label: "pool" },
      { id: "up_word", kind: "operator", label: "up" },
      { id: "down_word", kind: "operator", label: "down" },
      { id: "output_field", kind: "output", label: "Output field" },
    ],
    edges: [
      { id: "input-pool", from: "input_field", to: "pool_word" },
      { id: "pool-up", from: "pool_word", to: "up_word" },
      { id: "up-down", from: "up_word", to: "down_word" },
      { id: "down-output", from: "down_word", to: "output_field" },
    ],
  });
}

type FixtureNode = {
  id: string;
  kind: string;
  label: string;
  semanticHints?: string[];
  attributes?: Record<string, string | number | boolean | null>;
};

type FixtureEdge = { id: string; from: string; to: string; relation?: string };

/** Deliberately uses arbitrary operator names rather than a model-family grammar. */
export function unknownCustomSpatialBackboneUgs(): any {
  return zeroTemplateUgs({
    graphId: "unknown-spatial-backbone",
    nodes: [
      { id: "image_input", kind: "input", label: "Image input" },
      { id: "phase_stem", kind: "custom_operator", label: "Phase stem" },
      { id: "dilation_weaver", kind: "custom_operator", label: "Dilation weaver" },
      { id: "local_context_bank", kind: "custom_module", label: "Local context bank" },
      { id: "spatial_output", kind: "output", label: "Spatial prediction" },
    ],
    edges: [
      { id: "image-phase", from: "image_input", to: "phase_stem" },
      { id: "phase-weaver", from: "phase_stem", to: "dilation_weaver" },
      { id: "weaver-bank", from: "dilation_weaver", to: "local_context_bank" },
      { id: "bank-output", from: "local_context_bank", to: "spatial_output" },
    ],
  });
}

export function unknownResidualMultiBranchUgs(): any {
  return zeroTemplateUgs({
    graphId: "unknown-residual-multibranch",
    nodes: [
      { id: "signal_input", kind: "input", label: "Signal input" },
      { id: "branch_gate", kind: "operator", label: "Branch gate", semanticHints: ["split"] },
      { id: "detail_path", kind: "custom_operator", label: "Detail path" },
      { id: "context_path", kind: "custom_operator", label: "Context path" },
      { id: "residual_mixer", kind: "operator", label: "Residual mixer", attributes: { mergeKind: "add" } },
      { id: "residual_output", kind: "output", label: "Residual prediction" },
    ],
    edges: [
      { id: "signal-gate", from: "signal_input", to: "branch_gate" },
      { id: "gate-detail", from: "branch_gate", to: "detail_path" },
      { id: "gate-context", from: "branch_gate", to: "context_path" },
      { id: "detail-mixer", from: "detail_path", to: "residual_mixer", relation: "merge" },
      { id: "context-mixer", from: "context_path", to: "residual_mixer", relation: "merge" },
      { id: "signal-skip", from: "signal_input", to: "residual_mixer", relation: "skip" },
      { id: "mixer-output", from: "residual_mixer", to: "residual_output" },
    ],
  });
}

export function unknownMultiScaleEncoderDecoderUgs(): any {
  return zeroTemplateUgs({
    graphId: "unknown-multiscale-encoder-decoder",
    nodes: [
      { id: "map_input", kind: "input", label: "Map input" },
      { id: "scale_probe", kind: "custom_operator", label: "Scale probe" },
      { id: "coarse_encoder", kind: "custom_module", label: "Coarse encoder" },
      { id: "latent_router", kind: "custom_operator", label: "Latent router" },
      { id: "upstream_decoder", kind: "custom_module", label: "Upstream decoder" },
      { id: "scale_join", kind: "operator", label: "Scale join", attributes: { mergeKind: "concat" } },
      { id: "detail_projector", kind: "custom_operator", label: "Detail projector" },
      { id: "map_output", kind: "output", label: "Dense output" },
    ],
    edges: [
      { id: "map-probe", from: "map_input", to: "scale_probe" },
      { id: "probe-encoder", from: "scale_probe", to: "coarse_encoder" },
      { id: "encoder-latent", from: "coarse_encoder", to: "latent_router" },
      { id: "latent-decoder", from: "latent_router", to: "upstream_decoder" },
      { id: "decoder-join", from: "upstream_decoder", to: "scale_join", relation: "merge" },
      { id: "encoder-skip", from: "coarse_encoder", to: "scale_join", relation: "skip" },
      { id: "join-projector", from: "scale_join", to: "detail_projector" },
      { id: "projector-output", from: "detail_projector", to: "map_output" },
    ],
  });
}

export function unknownDualTowerCrossModalFusionUgs(): any {
  return zeroTemplateUgs({
    graphId: "unknown-dual-tower-crossmodal",
    nodes: [
      { id: "frame_input", kind: "input", label: "Frame input" },
      { id: "phrase_input", kind: "input", label: "Phrase input" },
      { id: "frame_tower", kind: "custom_module", label: "Frame tower" },
      { id: "phrase_tower", kind: "custom_operator", label: "Phrase tower" },
      { id: "cross_modal_hub", kind: "custom_module", label: "Cross modal hub" },
      { id: "fusion_output", kind: "output", label: "Joint prediction" },
    ],
    edges: [
      { id: "frame-tower", from: "frame_input", to: "frame_tower" },
      { id: "phrase-tower", from: "phrase_input", to: "phrase_tower" },
      { id: "frame-hub", from: "frame_tower", to: "cross_modal_hub", relation: "merge" },
      { id: "phrase-hub", from: "phrase_tower", to: "cross_modal_hub", relation: "merge" },
      { id: "hub-output", from: "cross_modal_hub", to: "fusion_output" },
    ],
  });
}

function zeroTemplateUgs(input: { graphId: string; nodes: FixtureNode[]; edges: FixtureEdge[] }): any {
  const sourceId = "fixture-source";
  const fixtureSourceHash = "c".repeat(64);
  const incoming = new Map(input.nodes.map((node) => [node.id, input.edges.filter((edge) => edge.to === node.id)]));
  const outgoing = new Map(input.nodes.map((node) => [node.id, input.edges.filter((edge) => edge.from === node.id)]));
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  if (input.edges.some((edge) => !nodeById.has(edge.from) || !nodeById.has(edge.to))) throw new Error("Fixture edge references an unknown node");
  const portId = (edge: FixtureEdge, direction: "input" | "output") => `${edge.id}:${direction}`;
  const nodes = input.nodes.map((node) => ({
    nodeId: node.id,
    kind: node.kind,
    label: node.label,
    semanticHints: node.semanticHints ?? [],
    inputPortIds: (incoming.get(node.id) ?? []).map((edge) => portId(edge, "input")),
    outputPortIds: (outgoing.get(node.id) ?? []).map((edge) => portId(edge, "output")),
    attributes: node.attributes ?? {},
    shapeClaim: "unknown",
    operationKnowledge: node.kind.startsWith("custom_") ? "custom" : "known",
    evidenceIds: ["e-topology"],
  }));
  return {
    version: 1,
    graphId: input.graphId,
    revision: 1,
    sourceIds: [sourceId],
    sourceHashes: [fixtureSourceHash],
    nodes,
    ports: input.edges.flatMap((edge) => [
      port(portId(edge, "output"), edge.from, "output"),
      port(portId(edge, "input"), edge.to, "input"),
    ]),
    edges: input.edges.map((edge) => ({ edgeId: edge.id, sourcePortId: portId(edge, "output"), targetPortId: portId(edge, "input"), relation: edge.relation ?? "data", knowledge: "declared", evidenceIds: ["e-topology"] })),
    groups: [],
    evidence: [{ evidenceId: "e-topology", sourceId, sourceHash: fixtureSourceHash, locator: "fixture-structure", excerptDigest: "d".repeat(64) }],
    topologyConfidence: 0.95,
    unresolved: [],
  };
}

function node(nodeId: string, kind: string, label: string, inputPortIds: string[], outputPortIds: string[], operationKnowledge: string, shapeClaim: string, evidenceIds: string[]) {
  return { nodeId, kind, label, semanticHints: [], inputPortIds, outputPortIds, attributes: {}, shapeClaim, operationKnowledge, evidenceIds };
}

function port(portId: string, nodeId: string, direction: string) {
  return { portId, nodeId, direction, label: null, representation: null, semanticType: "data", evidenceIds: [] };
}

function edge(edgeId: string, sourcePortId: string, targetPortId: string, evidenceId: string) {
  return { edgeId, sourcePortId, targetPortId, relation: "data", knowledge: "declared", evidenceIds: [evidenceId] };
}

function evidence(evidenceId: string) {
  return { evidenceId, sourceId: "prompt-1", sourceHash, locator: "prompt-fragment", excerptDigest: "b".repeat(64) };
}
