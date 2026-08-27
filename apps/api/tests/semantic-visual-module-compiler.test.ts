import { describe, expect, it } from "vitest";
import type { SemanticArchitectureGraphInput, SemanticModule, SemanticModuleType } from "../src/semantic-visual-module.js";
import { normalizeSemanticArchitectureGraph } from "../src/semantic-visual-module-normalizer.js";
import { compileSemanticVisualModules } from "../src/semantic-visual-module-compiler.js";

describe("semantic visual module compiler", () => {
  it("compiles convolution and scale modules into tensor faces plus operator bodies", () => {
    const compilation = compileSemanticVisualModules(normalizeSemanticArchitectureGraph(baseFixture()));
    const module = compilation.modules.find((item) => item.moduleId === "stage:conv");

    expect(module?.visualGrammarId).toBe("tensor-operator-stage");
    expect(module?.parts.map((part) => part.role)).toEqual([
      "front_face", "top_face", "side_face", "operator_body", "label",
    ]);
    expect(module?.parts.every((part) => part.sourceModuleId === "stage:conv")).toBe(true);
  });

  it("compiles attention into token structures and a typed relation part", () => {
    const compilation = compileSemanticVisualModules(normalizeSemanticArchitectureGraph(baseFixture()));
    const module = compilation.modules.find((item) => item.moduleId === "block:attention");

    expect(module?.visualGrammarId).toBe("attention-block");
    expect(module?.parts.map((part) => part.role)).toEqual([
      "query_tokens", "key_tokens", "value_tokens", "attention_relation", "output_tokens",
    ]);
  });

  it("compiles graph, memory and diffusion modules into distinct internal visual structures", () => {
    const compilation = compileSemanticVisualModules(normalizeSemanticArchitectureGraph(baseFixture()));
    const graph = compilation.modules.find((item) => item.moduleId === "graph:message");
    const memory = compilation.modules.find((item) => item.moduleId === "state:memory");
    const diffusion = compilation.modules.find((item) => item.moduleId === "process:diffusion");

    expect(graph?.parts.map((part) => part.role)).toEqual([
      "node_group", "edge_group", "message_aggregate", "graph_inset_label",
    ]);
    expect(memory?.parts.map((part) => part.role)).toEqual([
      "state_store", "state_read_port", "state_write_port",
    ]);
    expect(diffusion?.parts.map((part) => part.role)).toEqual([
      "operator_body", "repeat_marker", "process_axis", "condition_marker", "label",
    ]);
  });

  it("keeps unknown modules visibly unknown and records a diagnostic", () => {
    const compilation = compileSemanticVisualModules(normalizeSemanticArchitectureGraph(baseFixture()));
    const unknown = compilation.modules.find((item) => item.moduleId === "module:unknown");

    expect(unknown?.parts.map((part) => part.kind)).toEqual(["unknown_container", "label"]);
    expect(unknown?.parts[0]).toMatchObject({ role: "unknown_module" });
    expect(compilation.diagnostics).toContainEqual({ code: "unknown-module", moduleId: "module:unknown" });
    expect(compilation.exportEligibility).toBe("blocked");
  });

  it("maps every typed relation to a distinct visual marker", () => {
    const compilation = compileSemanticVisualModules(normalizeSemanticArchitectureGraph(baseFixture()));
    const byType = new Map(compilation.relations.map((relation) => [relation.relationType, relation]));

    expect(byType.get("add_merge")).toMatchObject({ visualRole: "merge_add", marker: "plus" });
    expect(byType.get("concat_merge")).toMatchObject({ visualRole: "merge_concat", marker: "concat" });
    expect(byType.get("cross_attention")).toMatchObject({ visualRole: "cross_attention", marker: "attention" });
    expect(byType.get("message_passing")).toMatchObject({ visualRole: "message_passing", marker: "message" });
    expect(byType.get("state_read")).toMatchObject({ visualRole: "state_read", marker: "read" });
    expect(byType.get("state_write")).toMatchObject({ visualRole: "state_write", marker: "write" });
    expect(byType.get("feedback")).toMatchObject({ visualRole: "feedback", marker: "feedback" });
    expect(byType.get("diffusion_iteration")).toMatchObject({ visualRole: "diffusion_iteration", marker: "diffusion" });
  });

  it("is deterministic and does not emit renderer or geometry keys", () => {
    const graph = normalizeSemanticArchitectureGraph(baseFixture());
    const first = compileSemanticVisualModules(graph);
    const second = compileSemanticVisualModules(graph);

    expect(second).toEqual(first);
    expect(allObjectKeys(first)).not.toEqual(expect.arrayContaining(["x", "y", "bounds", "renderer", "visio", "command"]));
  });

  it("marks candidate relations without upgrading graph eligibility", () => {
    const input = baseFixture();
    input.modules = input.modules.filter((module) => module.moduleId !== "module:unknown");
    input.panels[0]!.memberModuleIds = input.modules.map((module) => module.moduleId);
    input.relations.find((relation) => relation.relationId === "relation:add")!.knowledge = "candidate";
    const compilation = compileSemanticVisualModules(normalizeSemanticArchitectureGraph(input));

    expect(compilation.exportEligibility).toBe("candidate");
    expect(compilation.diagnostics).toContainEqual({ code: "candidate-structure", relationId: "relation:add" });
  });
});

function baseFixture(): SemanticArchitectureGraphInput {
  const modules = [
    createModule("stage:conv", "convolution_stage", "convolution"),
    createModule("block:attention", "attention_block", "attention"),
    createModule("graph:message", "graph_message_passing", "message"),
    createModule("state:memory", "memory_state", "memory"),
    createModule("process:diffusion", "diffusion_ladder", "denoiser"),
    createModule("module:unknown", "unknown_module", "unknown"),
    createModule("sink:output", "prediction", "prediction"),
  ];
  modules[1]!.condition = {
    conditionId: "condition:text",
    conditionType: "text",
    portIds: ["block:attention:in"],
    evidenceIds: ["fact:attention"],
  };
  modules[3]!.state = {
    stateId: "state:memory",
    stateType: "memory",
    readPortIds: ["state:memory:in"],
    writePortIds: ["state:memory:out"],
    persistent: true,
    evidenceIds: ["fact:memory"],
  };
  modules[4]!.repeat = {
    kind: "diffusion",
    count: 8,
    unitModuleIds: ["process:diffusion"],
    display: "first_last",
  };

  return {
    graphId: "anonymous-v2-composite",
    revision: "1",
    modules,
    dataObjects: [
      { dataId: "tensor:main", dataType: "feature_map", shape: { axes: ["C", "H", "W"], dimensions: [64, 32, 32] }, sourceNodeIds: ["source"], evidenceIds: ["fact:conv"], visualRole: "primary", confidence: 0.9, knowledge: "proven" },
      { dataId: "state:memory", dataType: "memory", shape: null, sourceNodeIds: ["state"], evidenceIds: ["fact:memory"], visualRole: "state", confidence: 0.9, knowledge: "proven" },
    ],
    relations: [
      relation("relation:add", "add_merge", "stage:conv", "block:attention", "fact:conv"),
      relation("relation:concat", "concat_merge", "stage:conv", "graph:message", "fact:conv"),
      relation("relation:attention", "cross_attention", "block:attention", "process:diffusion", "fact:attention"),
      relation("relation:message", "message_passing", "graph:message", "block:attention", "fact:graph"),
      relation("relation:read", "state_read", "state:memory", "block:attention", "fact:memory"),
      relation("relation:write", "state_write", "block:attention", "state:memory", "fact:memory"),
      relation("relation:feedback", "feedback", "process:diffusion", "stage:conv", "fact:diffusion"),
      relation("relation:diffusion", "diffusion_iteration", "process:diffusion", "sink:output", "fact:diffusion"),
    ],
    panels: [{ panelId: "panel:overview", kind: "overview", memberModuleIds: modules.map((module) => module.moduleId) }],
    evidenceIds: ["fact:attention", "fact:conv", "fact:diffusion", "fact:graph", "fact:memory"],
    confidence: 0.84,
    unresolved: [],
  };
}

function createModule(moduleId: string, semanticType: SemanticModuleType, role: string): SemanticModule {
  const evidenceKey = role === "denoiser" ? "diffusion" : role === "convolution" ? "conv" : role === "message" ? "graph" : ["attention", "memory"].includes(role) ? role : "conv";
  return {
    moduleId,
    semanticType,
    label: role,
    sourceNodeIds: [moduleId],
    evidenceIds: ["fact:" + evidenceKey],
    inputs: [{ portId: moduleId + ":in", direction: "input" as const, dataId: "tensor:main", role: "data" as const }],
    outputs: [{ portId: moduleId + ":out", direction: "output" as const, dataId: "tensor:main", role: "data" as const }],
    internalParts: [{ partId: moduleId + ":body", kind: "operator" as const, role, label: role, evidenceIds: ["fact:" + evidenceKey] }],
    repeat: null,
    state: null,
    condition: null,
    layoutIntent: { emphasis: "primary" as const, preferredPanel: "overview" as const, detailPolicy: "summary" as const },
    confidence: 0.8,
    knowledge: semanticType === "unknown_module" ? "proven" as const : "declared" as const,
  };
}

function relation(relationId: string, type: any, sourceModuleId: string, targetModuleId: string, evidenceId: string) {
  return {
    relationId,
    type,
    source: { moduleId: sourceModuleId, portId: sourceModuleId + ":out" },
    target: { moduleId: targetModuleId, portId: targetModuleId + ":in" },
    dataId: "tensor:main",
    knowledge: "declared" as const,
    evidenceIds: [evidenceId],
  };
}

function allObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allObjectKeys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allObjectKeys(child)]);
}
