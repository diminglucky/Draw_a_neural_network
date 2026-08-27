import { describe, expect, it } from "vitest";
import type { SemanticArchitectureGraphInput, SemanticModule, SemanticModuleType } from "../src/semantic-visual-module.js";
import { normalizeSemanticArchitectureGraph } from "../src/semantic-visual-module-normalizer.js";
import { compileSemanticVisualModules } from "../src/semantic-visual-module-compiler.js";
import { composeFigureStory } from "../src/figure-story-composer.js";
import { compilePublicationVisualPlanVNext } from "../src/publication-visual-plan-vnext.js";
import { compilePublicationVisualPlanVNextNativeGroupIntent } from "../src/publication-visual-plan-vnext-native-group-intent.js";

describe("publication visual plan vNext native group intent", () => {
  it("maps one semantic module to one native group and preserves every V2 part as a child", () => {
    const intent = compileIntent();
    const attention = intent.groups.find((group) => group.moduleId === "module:attention")!;

    expect(intent.protocolVersion).toBe("pvp-vnext-native-group-1");
    expect(intent.snapshotId).toBe("pvp-vnext:anonymous-vnext:1:fixture-seed");
    expect(intent.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(intent.groups.map((group) => group.groupId)).toEqual([
      "group:module:input", "group:module:stage", "group:module:attention", "group:module:output",
    ]);
    expect(attention.childShapes.map((child) => child.partId)).toEqual([
      "module:attention:attention_relation",
      "module:attention:key_tokens",
      "module:attention:output_tokens",
      "module:attention:query_tokens",
      "module:attention:value_tokens",
    ]);
    expect(attention.shapeData).toMatchObject({
      "pvp-vnext.moduleId": "module:attention",
      "pvp-vnext.semanticType": "attention_block",
      "pvp-vnext.ownership": "agent",
    });
    expect(attention.childShapes.every((child) => child.shapeData["pvp-vnext.groupId"] === attention.groupId)).toBe(true);
  });

  it("maps typed V4 relations to group connectors and emits independent readback manifests", () => {
    const intent = compileIntent();
    expect(intent.connectors.map((connector) => connector.connectorId)).toEqual([
      "connector:flow:attention-output", "connector:flow:input-stage", "connector:flow:stage-attention",
    ]);
    expect(intent.connectors[0]).toMatchObject({
      relationType: "data_flow",
      visualRole: "data",
      marker: "arrow",
      sourceGroupId: "group:module:attention",
      targetGroupId: "group:module:output",
    });
    expect(intent.readback.groups).toEqual(intent.groups.map((group) => ({
      groupId: group.groupId,
      moduleId: group.moduleId,
      childIds: group.childShapes.map((child) => child.childId),
      children: group.childShapes.map((child) => ({
        childId: child.childId,
        partId: child.partId,
        requiredShapeDataKeys: expect.arrayContaining([
          "pvp-vnext.snapshotId", "pvp-vnext.snapshotHash", "pvp-vnext.groupId",
          "pvp-vnext.childId", "pvp-vnext.moduleId", "pvp-vnext.partId",
          "pvp-vnext.role", "pvp-vnext.ownership",
        ]),
      })),
      requiredShapeDataKeys: expect.arrayContaining([
        "pvp-vnext.snapshotId", "pvp-vnext.snapshotHash", "pvp-vnext.groupId",
        "pvp-vnext.moduleId", "pvp-vnext.semanticType", "pvp-vnext.panelId",
        "pvp-vnext.grammarId", "pvp-vnext.ownership",
      ]),
    })));
    expect(intent.readback.connectors.map((item) => item.connectorId)).toEqual(intent.connectors.map((connector) => connector.connectorId));
  });

  it("preserves V4 geometry exactly, rejects candidate snapshots and rejects forged hashes", () => {
    const snapshot = compileSnapshot();
    const intent = compilePublicationVisualPlanVNextNativeGroupIntent(snapshot);
    expect(intent.coordinateSpace.page).toEqual(snapshot.coordinateSpace.page);
    expect(intent.groups[0]!.bounds).toEqual(snapshot.modules[0]!.bounds);
    expect(intent.connectors[0]!.route).toEqual(snapshot.relations[0]!.route);

    const candidateInput = baseFixture();
    candidateInput.relations[0]!.knowledge = "candidate";
    const candidateGraph = normalizeSemanticArchitectureGraph(candidateInput);
    const candidateCompilation = compileSemanticVisualModules(candidateGraph);
    const candidateStory = composeFigureStory(candidateGraph, candidateCompilation);
    const candidateSnapshot = compilePublicationVisualPlanVNext({
      graph: candidateGraph,
      compilation: candidateCompilation,
      story: candidateStory,
      layoutSeed: "fixture-seed",
      layoutIntent: { orientation: "landscape", density: "comfortable" },
    });
    expect(() => compilePublicationVisualPlanVNextNativeGroupIntent(candidateSnapshot)).toThrow(/formal/i);

    const forged = structuredClone(snapshot);
    forged.identity.canonicalHash = "a".repeat(64);
    expect(() => compilePublicationVisualPlanVNextNativeGroupIntent(forged)).toThrow(/hash|identity/i);
  });

  it("deep-freezes the intent and rejects unsafe output fields", () => {
    const intent = compileIntent();
    expect(Object.isFrozen(intent)).toBe(true);
    expect(Object.isFrozen(intent.groups)).toBe(true);
    expect(Object.isFrozen(intent.groups[0])).toBe(true);
    expect(allObjectKeys(intent)).not.toEqual(expect.arrayContaining([
      "command", "com", "provider", "sourceCode", "sourcePath", "rawSource",
    ]));
  });
});

function compileIntent() {
  return compilePublicationVisualPlanVNextNativeGroupIntent(compileSnapshot());
}

function compileSnapshot() {
  const input = baseFixture();
  const graph = normalizeSemanticArchitectureGraph(input);
  const compilation = compileSemanticVisualModules(graph);
  const story = composeFigureStory(graph, compilation);
  return compilePublicationVisualPlanVNext({
    graph,
    compilation,
    story,
    layoutSeed: "fixture-seed",
    layoutIntent: { orientation: "landscape", density: "comfortable" },
  });
}

function baseFixture(): SemanticArchitectureGraphInput {
  const modules = [
    createModule("module:input", "tensor_volume"),
    createModule("module:stage", "convolution_stage"),
    createModule("module:attention", "attention_block"),
    createModule("module:output", "prediction"),
  ];
  return {
    graphId: "anonymous-vnext",
    revision: "1",
    modules,
    dataObjects: [{ dataId: "data:main", dataType: "feature_map", shape: { axes: ["C", "H", "W"], dimensions: [64, 32, 32] }, sourceNodeIds: ["source"], evidenceIds: ["fact:main"], visualRole: "primary", confidence: 0.9, knowledge: "proven" }],
    relations: [
      relation("flow:input-stage", "module:input", "module:stage"),
      relation("flow:stage-attention", "module:stage", "module:attention"),
      relation("flow:attention-output", "module:attention", "module:output"),
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
    knowledge: "declared",
  };
}

function relation(relationId: string, sourceModuleId: string, targetModuleId: string) {
  return { relationId, type: "data_flow" as const, source: { moduleId: sourceModuleId, portId: sourceModuleId + ":out" }, target: { moduleId: targetModuleId, portId: targetModuleId + ":in" }, dataId: "data:main", knowledge: "declared" as const, evidenceIds: ["fact:main"] };
}

function allObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allObjectKeys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allObjectKeys(child)]);
}
