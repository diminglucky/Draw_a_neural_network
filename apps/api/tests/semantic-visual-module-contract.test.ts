import { describe, expect, it } from "vitest";
import type {
  SemanticArchitectureGraphInput,
  SemanticDataType,
  SemanticModuleType,
  SemanticRelationType,
} from "../src/semantic-visual-module.js";
import {
  canonicalSemanticArchitectureGraphJson,
  getSemanticExportEligibility,
  normalizeSemanticArchitectureGraph,
} from "../src/semantic-visual-module-normalizer.js";
import {
  architectureSignatureId,
  deriveArchitectureSignature,
} from "../src/semantic-visual-module-signature.js";

const semanticModuleTypes: SemanticModuleType[] = [
  "image_frame", "tensor_volume", "token_sequence", "grid", "mesh_graph",
  "latent", "mask", "prediction", "memory_state", "convolution_stage",
  "scale_transition", "attention_block", "ffn_block", "ssm_block",
  "graph_message_passing", "diffusion_denoiser", "stage_region",
  "repeat_group", "multi_tower", "fusion_block", "time_axis", "feedback_loop",
  "diffusion_ladder", "ensemble_branch", "unknown_module",
];

const semanticDataTypes: SemanticDataType[] = [
  "image", "video_frame", "tensor", "feature_map", "token_sequence", "grid",
  "mesh", "graph", "latent", "mask", "prediction", "memory", "state", "unknown",
];

const semanticRelationTypes: SemanticRelationType[] = [
  "data_flow", "condition_flow", "residual_skip", "add_merge", "concat_merge",
  "cross_attention", "message_passing", "state_read", "state_write", "feedback",
  "time_step", "diffusion_iteration",
];

describe("semantic visual module contract", () => {
  it("exposes the renderer-neutral vocabulary and requires internal module parts", () => {
    expect(semanticModuleTypes).toHaveLength(25);
    expect(semanticDataTypes).toContain("mesh");
    expect(semanticDataTypes).toContain("memory");
    expect(semanticRelationTypes).toContain("cross_attention");
    expect(semanticRelationTypes).toContain("state_write");

    const normalized = normalizeSemanticArchitectureGraph(baseFixture());
    expect(normalized.modules[0]?.internalParts.length).toBeGreaterThan(0);
    expect(normalized.relations[0]).toMatchObject({
      source: { moduleId: "stage:conv", portId: "stage:output" },
      target: { moduleId: "stage:output", portId: "output:input" },
    });
    expect(normalized).not.toHaveProperty("coordinates");
    expect(normalized).not.toHaveProperty("bounds");
    expect(normalized).not.toHaveProperty("renderer");
    expect(normalized).not.toHaveProperty("visio");
  });

  it("rejects duplicate IDs and dangling module or port references", () => {
    const duplicate = structuredClone(baseFixture());
    duplicate.modules.push(structuredClone(duplicate.modules[0]));
    expect(() => normalizeSemanticArchitectureGraph(duplicate)).toThrow(/duplicate|unique/i);

    const dangling = structuredClone(baseFixture());
    dangling.relations[0]!.target.moduleId = "missing-module";
    expect(() => normalizeSemanticArchitectureGraph(dangling)).toThrow(/module|endpoint|port/i);

    const badPort = structuredClone(baseFixture());
    badPort.relations[0]!.target.portId = "missing-port";
    expect(() => normalizeSemanticArchitectureGraph(badPort)).toThrow(/module|endpoint|port/i);
  });

  it("rejects state read and write lists that point at the wrong port direction", () => {
    const invalid = structuredClone(stateFixture());
    invalid.modules[0]!.state!.readPortIds = ["memory:write"];
    expect(() => normalizeSemanticArchitectureGraph(invalid)).toThrow(/state.*read|input/i);
  });

  it("rejects non-finite and out-of-range confidence", () => {
    for (const confidence of [-0.1, 1.1, Number.POSITIVE_INFINITY]) {
      const invalid = structuredClone(baseFixture());
      invalid.confidence = confidence;
      expect(() => normalizeSemanticArchitectureGraph(invalid)).toThrow(/confidence/i);
    }
  });

  it("keeps candidate or unknown topology out of formal export", () => {
    const candidateRelation = structuredClone(baseFixture());
    candidateRelation.relations[0]!.knowledge = "candidate";
    expect(getSemanticExportEligibility(candidateRelation)).toBe("candidate");
    expect(normalizeSemanticArchitectureGraph(candidateRelation).exportEligibility).toBe("candidate");

    const unknown = structuredClone(baseFixture());
    unknown.modules[0]!.semanticType = "unknown_module";
    unknown.modules[0]!.knowledge = "proven";
    expect(normalizeSemanticArchitectureGraph(unknown).exportEligibility).toBe("blocked");

    const unresolved = structuredClone(baseFixture());
    unresolved.unresolved = [{
      unresolvedId: "uncertain-topology",
      scope: "topology",
      severity: "blocking",
      evidenceIds: ["fact-conv"],
    }];
    expect(normalizeSemanticArchitectureGraph(unresolved).exportEligibility).toBe("blocked");
  });

  it("sorts evidence and collections and produces byte-identical canonical output", () => {
    const first = normalizeSemanticArchitectureGraph(baseFixture());
    const reordered = structuredClone(baseFixture());
    reordered.modules.reverse();
    reordered.evidenceIds.reverse();
    reordered.modules[0]!.evidenceIds.reverse();
    reordered.modules[0]!.internalParts.reverse();
    const second = normalizeSemanticArchitectureGraph(reordered);

    expect(second.evidenceIds).toEqual(["fact-conv", "fact-input", "fact-output"]);
    expect(canonicalSemanticArchitectureGraphJson(first)).toBe(canonicalSemanticArchitectureGraphJson(second));
    expect(first.canonicalHash).toBe(second.canonicalHash);
  });

  it("rejects geometry and renderer leakage", () => {
    const invalid = structuredClone(baseFixture()) as unknown as Record<string, unknown>;
    invalid.coordinates = { x: 1, y: 2 };
    expect(() => normalizeSemanticArchitectureGraph(invalid as never)).toThrow(/forbidden|renderer|geometry/i);

    const nested = structuredClone(baseFixture());
    (nested.modules[0] as unknown as Record<string, unknown>).renderer = "visio";
    expect(() => normalizeSemanticArchitectureGraph(nested)).toThrow(/forbidden|renderer|geometry/i);
  });

  it("derives spatial and graph signatures from structure rather than model names", () => {
    const scaleSignature = deriveArchitectureSignature(normalizeSemanticArchitectureGraph(scaleFixture()));
    expect(scaleSignature.hasSpatialScaleChange).toBe(true);

    const graphSignature = deriveArchitectureSignature(normalizeSemanticArchitectureGraph(graphFixture()));
    expect(graphSignature.hasGraphStructure).toBe(true);
  });

  it("derives process, state, condition, attention, repeat and multi-tower traits", () => {
    const graph = normalizeSemanticArchitectureGraph(processAndFusionFixture());
    const signature = deriveArchitectureSignature(graph);

    expect(signature).toMatchObject({
      hasPersistentState: true,
      hasConditionPath: true,
      hasCrossAttention: true,
      hasRepeat: true,
      hasFeedback: true,
      hasDiffusionIteration: true,
      hasMultiTower: true,
    });
    expect(signature.complexity).toBe("high");
  });

  it("produces the same signature ID for reordered equivalent semantic graphs", () => {
    const first = deriveArchitectureSignature(normalizeSemanticArchitectureGraph(processAndFusionFixture()));
    const reordered = processAndFusionFixture();
    reordered.modules.reverse();
    reordered.dataObjects.reverse();
    reordered.relations.reverse();
    const second = deriveArchitectureSignature(normalizeSemanticArchitectureGraph(reordered));

    expect(architectureSignatureId(first)).toBe(architectureSignatureId(second));
  });
});

function baseFixture(): SemanticArchitectureGraphInput {
  return {
    graphId: "anonymous-convolution",
    revision: "1",
    modules: [
      {
        moduleId: "stage:conv",
        semanticType: "convolution_stage",
        label: "Convolution stage",
        sourceNodeIds: ["conv"],
        evidenceIds: ["fact-conv"],
        inputs: [{ portId: "stage:input", direction: "input", dataId: "input-tensor", role: "data" }],
        outputs: [{ portId: "stage:output", direction: "output", dataId: "feature-map", role: "data" }],
        internalParts: [
          { partId: "stage:conv-body", kind: "operator", role: "convolution", label: "Conv", evidenceIds: ["fact-conv"] },
          { partId: "stage:activation", kind: "operator", role: "activation", label: "Activation", evidenceIds: ["fact-conv"] },
        ],
        repeat: null,
        state: null,
        condition: null,
        layoutIntent: { emphasis: "primary", preferredPanel: "overview", detailPolicy: "summary" },
        confidence: 0.9,
        knowledge: "proven",
      },
      {
        moduleId: "stage:output",
        semanticType: "prediction",
        label: "Prediction",
        sourceNodeIds: ["output"],
        evidenceIds: ["fact-output"],
        inputs: [{ portId: "output:input", direction: "input", dataId: "feature-map", role: "data" }],
        outputs: [],
        internalParts: [
          { partId: "output:head", kind: "operator", role: "prediction_head", label: "Head", evidenceIds: ["fact-output"] },
        ],
        repeat: null,
        state: null,
        condition: null,
        layoutIntent: { emphasis: "secondary", preferredPanel: "overview", detailPolicy: "summary" },
        confidence: 0.88,
        knowledge: "declared",
      },
    ],
    dataObjects: [
      { dataId: "feature-map", dataType: "feature_map", shape: { axes: ["C", "H", "W"], dimensions: [64, 32, 32] }, sourceNodeIds: ["conv"], evidenceIds: ["fact-conv"], visualRole: "primary", confidence: 0.9, knowledge: "proven" },
      { dataId: "input-tensor", dataType: "tensor", shape: { axes: ["C", "H", "W"], dimensions: [3, 64, 64] }, sourceNodeIds: ["input"], evidenceIds: ["fact-input"], visualRole: "primary", confidence: 0.9, knowledge: "proven" },
    ],
    relations: [
      { relationId: "flow:output", type: "data_flow", source: { moduleId: "stage:conv", portId: "stage:output" }, target: { moduleId: "stage:output", portId: "output:input" }, dataId: "feature-map", knowledge: "proven", evidenceIds: ["fact-conv"] },
    ],
    panels: [
      { panelId: "panel:overview", kind: "overview", memberModuleIds: ["stage:conv", "stage:output"] },
    ],
    evidenceIds: ["fact-output", "fact-conv", "fact-input"],
    confidence: 0.9,
    unresolved: [],
  };
}

function stateFixture(): SemanticArchitectureGraphInput {
  const graph = baseFixture();
  graph.modules[0] = {
    ...graph.modules[0],
    moduleId: "state:update",
    semanticType: "memory_state",
    label: "Memory state",
    sourceNodeIds: ["memory"],
    inputs: [{ portId: "memory:read", direction: "input", dataId: "memory", role: "state" }],
    outputs: [{ portId: "memory:write", direction: "output", dataId: "memory", role: "state" }],
    state: { stateId: "state:memory", stateType: "memory", readPortIds: ["memory:read"], writePortIds: ["memory:write"], persistent: true, evidenceIds: ["fact-conv"] },
  };
  graph.relations[0] = {
    ...graph.relations[0],
    relationId: "state:write",
    type: "state_write",
    source: { moduleId: "state:update", portId: "memory:write" },
    target: { moduleId: "stage:output", portId: "output:input" },
    dataId: "memory",
  };
  graph.dataObjects.push({ dataId: "memory", dataType: "memory", shape: null, sourceNodeIds: ["memory"], evidenceIds: ["fact-conv"], visualRole: "state", confidence: 0.8, knowledge: "declared" });
  return graph;
}

function scaleFixture(): SemanticArchitectureGraphInput {
  const graph = baseFixture();
  graph.modules.push({
    moduleId: "stage:scale",
    semanticType: "scale_transition",
    label: "Scale transition",
    sourceNodeIds: ["scale"],
    evidenceIds: ["fact-conv"],
    inputs: [{ portId: "scale:input", direction: "input", dataId: "feature-map", role: "data" }],
    outputs: [{ portId: "scale:output", direction: "output", dataId: "scaled-map", role: "data" }],
    internalParts: [{ partId: "scale:wedge", kind: "operator", role: "downsample", label: "Downsample", evidenceIds: ["fact-conv"] }],
    repeat: null, state: null, condition: null,
    layoutIntent: { emphasis: "secondary", preferredPanel: "overview", detailPolicy: "summary" },
    confidence: 0.85, knowledge: "declared",
  });
  graph.dataObjects.push({ dataId: "scaled-map", dataType: "feature_map", shape: { axes: ["C", "H", "W"], dimensions: [128, 16, 16] }, sourceNodeIds: ["scale"], evidenceIds: ["fact-conv"], visualRole: "primary", confidence: 0.8, knowledge: "declared" });
  return graph;
}

function graphFixture(): SemanticArchitectureGraphInput {
  const graph = baseFixture();
  graph.modules[0] = {
    ...graph.modules[0],
    moduleId: "graph:message",
    semanticType: "graph_message_passing",
    label: "Message passing",
    sourceNodeIds: ["message"],
    internalParts: [
      { partId: "graph:neighbors", kind: "data", role: "neighbor_nodes", label: "Neighbors", evidenceIds: ["fact-conv"] },
      { partId: "graph:aggregate", kind: "operator", role: "message_aggregate", label: "Aggregate", evidenceIds: ["fact-conv"] },
    ],
  };
  graph.modules[0].inputs[0]!.dataId = "mesh";
  graph.modules[0].outputs[0]!.dataId = "mesh";
  graph.dataObjects.push({ dataId: "mesh", dataType: "mesh", shape: null, sourceNodeIds: ["message"], evidenceIds: ["fact-conv"], visualRole: "primary", confidence: 0.8, knowledge: "declared" });
  graph.relations[0]!.source = { moduleId: "graph:message", portId: "stage:output" };
  graph.panels[0]!.memberModuleIds = graph.modules.map((module) => module.moduleId);
  return graph;
}

function processAndFusionFixture(): SemanticArchitectureGraphInput {
  const graph = baseFixture();
  const makeModule = (moduleId: string, semanticType: SemanticModuleType, label: string) => ({
    ...graph.modules[0],
    moduleId, semanticType, label, sourceNodeIds: [moduleId],
    inputs: [{ portId: moduleId + ":input", direction: "input" as const, dataId: "input-tensor", role: "data" as const }],
    outputs: [{ portId: moduleId + ":output", direction: "output" as const, dataId: "feature-map", role: "data" as const }],
  });
  graph.modules = [
    makeModule("tower:image", "multi_tower", "Image tower"),
    makeModule("tower:text", "multi_tower", "Text tower"),
    {
      ...makeModule("fusion:cross", "fusion_block", "Cross fusion"),
      condition: { conditionId: "condition:text", conditionType: "text", portIds: ["fusion:cross:input"], evidenceIds: ["fact-conv"] },
      internalParts: [{ partId: "fusion:attention", kind: "relation", role: "cross_attention", label: "Cross attention", evidenceIds: ["fact-conv"] }],
    },
    {
      ...makeModule("process:diffusion", "diffusion_ladder", "Denoising process"),
      repeat: { kind: "diffusion", count: 8, unitModuleIds: ["process:denoiser"], display: "first_last" },
      state: { stateId: "state:latent", stateType: "latent", readPortIds: ["process:diffusion:input"], writePortIds: ["process:diffusion:output"], persistent: true, evidenceIds: ["fact-conv"] },
    },
    makeModule("process:denoiser", "diffusion_denoiser", "Denoiser"),
    makeModule("loop:feedback", "feedback_loop", "Feedback loop"),
  ];
  graph.relations = [
    { relationId: "tower:condition", type: "condition_flow", source: { moduleId: "tower:text", portId: "tower:text:output" }, target: { moduleId: "fusion:cross", portId: "fusion:cross:input" }, dataId: "feature-map", knowledge: "declared", evidenceIds: ["fact-conv"] },
    { relationId: "fusion:attention", type: "cross_attention", source: { moduleId: "tower:image", portId: "tower:image:output" }, target: { moduleId: "fusion:cross", portId: "fusion:cross:input" }, dataId: "feature-map", knowledge: "declared", evidenceIds: ["fact-conv"] },
    { relationId: "process:step", type: "diffusion_iteration", source: { moduleId: "process:diffusion", portId: "process:diffusion:output" }, target: { moduleId: "process:denoiser", portId: "process:denoiser:input" }, dataId: "feature-map", knowledge: "declared", evidenceIds: ["fact-conv"] },
    { relationId: "loop:feedback", type: "feedback", source: { moduleId: "loop:feedback", portId: "loop:feedback:output" }, target: { moduleId: "process:diffusion", portId: "process:diffusion:input" }, dataId: "feature-map", knowledge: "declared", evidenceIds: ["fact-conv"] },
  ];
  graph.panels[0]!.memberModuleIds = graph.modules.map((module) => module.moduleId);
  graph.unresolved = [];
  return graph;
}

function reordered(graph: SemanticArchitectureGraphInput): SemanticArchitectureGraphInput {
  const clone = structuredClone(graph);
  clone.modules.reverse();
  clone.dataObjects.reverse();
  clone.relations.reverse();
  return clone;
}
