import { describe, expect, it } from "vitest";
import type { SemanticArchitectureGraphInput, SemanticModule, SemanticModuleType } from "../src/semantic-visual-module.js";
import { normalizeSemanticArchitectureGraph } from "../src/semantic-visual-module-normalizer.js";
import { compileSemanticVisualModules } from "../src/semantic-visual-module-compiler.js";
import { composeFigureStory } from "../src/figure-story-composer.js";

describe("figure story composer", () => {
  it("extracts a main path and separates condition, state, feedback, graph and process lanes", () => {
    const story = compose(baseFixture());

    expect(story.mainPathModuleIds).toEqual([
      "module:input", "module:stage", "module:attention", "module:output",
    ]);
    expect(story.lanes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "main", relationIds: expect.arrayContaining(["flow:input-stage", "flow:stage-attention", "flow:attention-output"]) }),
      expect.objectContaining({ kind: "condition", relationIds: expect.arrayContaining(["condition:text"]) }),
      expect.objectContaining({ kind: "state", relationIds: expect.arrayContaining(["state:read", "state:write"]) }),
      expect.objectContaining({ kind: "feedback", relationIds: ["feedback:stage"] }),
      expect.objectContaining({ kind: "graph", relationIds: ["message:graph"] }),
      expect.objectContaining({ kind: "process", relationIds: ["diffusion:step"] }),
    ]));
  });

  it("creates overview, detail, process and legend panels without flattening complex modules", () => {
    const story = compose(baseFixture());
    const overview = story.panels.find((panel) => panel.kind === "overview");
    const detail = story.panels.find((panel) => panel.kind === "detail");
    const process = story.panels.find((panel) => panel.kind === "process");
    const legend = story.panels.find((panel) => panel.kind === "legend");

    expect(overview?.moduleIds).toEqual(story.mainPathModuleIds);
    expect(detail?.moduleIds).toEqual(expect.arrayContaining([
      "module:attention", "module:graph", "module:memory", "module:diffusion",
    ]));
    expect(process?.relationIds).toEqual(["diffusion:step"]);
    expect(legend?.moduleIds.length).toBeGreaterThan(0);
    expect(story.panels.map((panel) => panel.panelId)).toEqual([
      "panel:overview", "panel:detail", "panel:process", "panel:legend",
    ]);
  });

  it("creates detail insets from V2 parts and only emits legends for used relation roles", () => {
    const story = compose(baseFixture());
    const insetIds = story.insets.map((inset) => inset.insetId);

    expect(insetIds).toEqual([
      "inset:module:attention", "inset:module:diffusion",
      "inset:module:graph", "inset:module:memory",
    ]);
    expect(story.insets.every((inset) => inset.panelId === "panel:overview" && inset.partIds.length > 0)).toBe(true);
    expect(story.legend.map((entry) => entry.semanticType)).toEqual([
      "condition", "data", "feedback", "message_passing", "process", "state_read", "state_write",
    ]);
    expect(story.legend.some((entry) => entry.semanticType === "cross_attention")).toBe(false);
    expect(story.legend.some((entry) => entry.semanticType === "diffusion_iteration")).toBe(false);
    expect(story.legend.some((entry) => entry.semanticType === "time_step")).toBe(false);
  });

  it("preserves candidate and blocked eligibility while keeping uncertainty visible", () => {
    const input = baseFixture();
    input.modules.push(createModule("module:unknown", "unknown_module"));
    input.panels[0]!.memberModuleIds.push("module:unknown");
    input.relations[0]!.knowledge = "candidate";
    const story = compose(input);

    expect(story.exportEligibility).toBe("blocked");
    expect(story.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unknown-module", moduleId: "module:unknown" }),
      expect.objectContaining({ code: "candidate-structure", relationId: "flow:input-stage" }),
    ]));
  });

  it("is deterministic and does not emit geometry, route or renderer keys", () => {
    const input = baseFixture();
    const first = compose(input);
    const second = compose(input);

    expect(second).toEqual(first);
    expect(allObjectKeys(first)).not.toEqual(expect.arrayContaining([
      "x", "y", "width", "height", "bounds", "route", "renderer", "visio", "command",
    ]));
  });
});

function compose(input: SemanticArchitectureGraphInput) {
  const graph = normalizeSemanticArchitectureGraph(input);
  return composeFigureStory(graph, compileSemanticVisualModules(graph));
}

function baseFixture(): SemanticArchitectureGraphInput {
  const modules = [
    createModule("module:input", "tensor_volume"),
    createModule("module:stage", "convolution_stage"),
    createModule("module:attention", "attention_block"),
    createModule("module:output", "prediction"),
    createModule("module:text", "token_sequence"),
    createModule("module:graph", "graph_message_passing"),
    createModule("module:memory", "memory_state"),
    createModule("module:diffusion", "diffusion_ladder"),
  ];
  modules[2]!.condition = {
    conditionId: "condition:text",
    conditionType: "text",
    portIds: ["module:attention:in"],
    evidenceIds: ["fact:main"],
  };
  modules[6]!.state = {
    stateId: "state:memory",
    stateType: "memory",
    readPortIds: ["module:memory:in"],
    writePortIds: ["module:memory:out"],
    persistent: true,
    evidenceIds: ["fact:main"],
  };
  modules[7]!.repeat = {
    kind: "diffusion",
    count: 8,
    unitModuleIds: ["module:diffusion"],
    display: "first_last",
  };

  return {
    graphId: "anonymous-story",
    revision: "1",
    modules,
    dataObjects: [
      { dataId: "data:main", dataType: "feature_map", shape: { axes: ["C", "H", "W"], dimensions: [64, 32, 32] }, sourceNodeIds: ["source"], evidenceIds: ["fact:main"], visualRole: "primary", confidence: 0.9, knowledge: "proven" },
      { dataId: "data:state", dataType: "memory", shape: null, sourceNodeIds: ["memory"], evidenceIds: ["fact:main"], visualRole: "state", confidence: 0.9, knowledge: "proven" },
    ],
    relations: [
      relation("flow:input-stage", "data_flow", "module:input", "module:stage"),
      relation("flow:stage-attention", "data_flow", "module:stage", "module:attention"),
      relation("flow:attention-output", "data_flow", "module:attention", "module:output"),
      relation("condition:text", "condition_flow", "module:text", "module:attention"),
      relation("state:read", "state_read", "module:memory", "module:attention"),
      relation("state:write", "state_write", "module:attention", "module:memory"),
      relation("feedback:stage", "feedback", "module:diffusion", "module:stage"),
      relation("message:graph", "message_passing", "module:graph", "module:attention"),
      relation("diffusion:step", "diffusion_iteration", "module:diffusion", "module:output"),
    ],
    panels: [{ panelId: "panel:input", kind: "overview", memberModuleIds: modules.map((module) => module.moduleId) }],
    evidenceIds: ["fact:main"],
    confidence: 0.9,
    unresolved: [],
  };
}

function createModule(moduleId: string, semanticType: SemanticModuleType): SemanticModule {
  return {
    moduleId,
    semanticType,
    label: moduleId,
    sourceNodeIds: [moduleId],
    evidenceIds: ["fact:main"],
    inputs: [{ portId: moduleId + ":in", direction: "input", dataId: "data:main", role: "data" }],
    outputs: [{ portId: moduleId + ":out", direction: "output", dataId: "data:main", role: "data" }],
    internalParts: [{ partId: moduleId + ":body", kind: "operator", role: "operator", label: moduleId, evidenceIds: ["fact:main"] }],
    repeat: null,
    state: null,
    condition: null,
    layoutIntent: { emphasis: "primary", preferredPanel: "overview", detailPolicy: "summary" },
    confidence: 0.9,
    knowledge: semanticType === "unknown_module" ? "proven" : "declared",
  };
}

function relation(relationId: string, type: any, sourceModuleId: string, targetModuleId: string) {
  return {
    relationId,
    type,
    source: { moduleId: sourceModuleId, portId: sourceModuleId + ":out" },
    target: { moduleId: targetModuleId, portId: targetModuleId + ":in" },
    dataId: "data:main",
    knowledge: "declared" as const,
    evidenceIds: ["fact:main"],
  };
}

function allObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allObjectKeys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allObjectKeys(child)]);
}
