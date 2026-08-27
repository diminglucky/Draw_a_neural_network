import { describe, expect, it } from "vitest";
import type { SemanticArchitectureGraphInput, SemanticModule, SemanticModuleType } from "../src/semantic-visual-module.js";
import { normalizeSemanticArchitectureGraph } from "../src/semantic-visual-module-normalizer.js";
import { compileSemanticVisualModules } from "../src/semantic-visual-module-compiler.js";
import { composeFigureStory } from "../src/figure-story-composer.js";
import { compilePublicationVisualPlanVNext } from "../src/publication-visual-plan-vnext.js";

describe("publication visual plan vNext", () => {
  it("projects story semantics into a versioned snapshot without flattening module parts", () => {
    const snapshot = compileSnapshot();

    expect(snapshot.version).toBe(1);
    expect(snapshot.grammarManifestVersion).toBe(1);
    expect(snapshot.identity.snapshotId).toBe("pvp-vnext:anonymous-vnext:1:fixture-seed");
    expect(snapshot.identity.canonicalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.panels.map((panel) => panel.panelId)).toEqual([
      "panel:overview", "panel:detail", "panel:legend",
    ]);
    expect(snapshot.modules.map((module) => module.moduleId)).toEqual([
      "module:input", "module:stage", "module:attention", "module:output",
    ]);
    expect(snapshot.modules.find((module) => module.moduleId === "module:attention")?.parts.map((part) => part.partId)).toEqual([
      "module:attention:attention_relation",
      "module:attention:key_tokens",
      "module:attention:output_tokens",
      "module:attention:query_tokens",
      "module:attention:value_tokens",
    ]);
    expect(snapshot.dataObjects.map((item) => item.dataId)).toEqual(["data:main"]);
    expect(snapshot.relations.map((relation) => relation.relationId)).toEqual([
      "flow:attention-output", "flow:input-stage", "flow:stage-attention",
    ]);
    expect(snapshot.containers.map((container) => container.containerId)).toEqual([
      "container:panel:detail", "container:panel:legend", "container:panel:overview",
    ]);
    expect(snapshot.insets.map((inset) => inset.insetId)).toEqual(["inset:module:attention"]);
    expect(snapshot.legend.entries.map((entry) => entry.semanticType)).toEqual(["data"]);
    expect(snapshot.sourceMappings.length).toBe(snapshot.modules.length + snapshot.dataObjects.length + snapshot.relations.length);
    expect(snapshot.rendererRequirements.requiredCapabilities).toEqual([
      "group-readback", "native-group", "native-text", "orthogonal-route", "shape-data",
    ]);
  });

  it("keeps story order and contains every module part and relation route", () => {
    const snapshot = compileSnapshot();
    const overview = snapshot.panels.find((panel) => panel.panelId === "panel:overview")!;
    const moduleById = new Map(snapshot.modules.map((module) => [module.moduleId, module]));

    expect(overview.moduleIds).toEqual([
      "module:input", "module:stage", "module:attention", "module:output",
    ]);
    for (const module of snapshot.modules) {
      expect(contains(overview.bounds, module.bounds) || module.panelId === "panel:detail").toBe(true);
      for (const part of module.parts) expect(contains(module.bounds, part.bounds)).toBe(true);
    }
    for (const relation of snapshot.relations) {
      expect(relation.route.length).toBeGreaterThanOrEqual(2);
      expect(relation.route[0]).toEqual(relation.sourceAnchor);
      expect(relation.route.at(-1)).toEqual(relation.targetAnchor);
      expect(moduleById.has(relation.sourceModuleId)).toBe(true);
      expect(moduleById.has(relation.targetModuleId)).toBe(true);
    }
    expect(snapshot.coordinateSpace.page.width).toBeGreaterThan(snapshot.coordinateSpace.safeMargins.width);
    expect(snapshot.coordinateSpace.page.height).toBeGreaterThan(snapshot.coordinateSpace.safeMargins.height);
  });

  it("is byte-equivalent for repeated compilation and changes identity when seed or revision changes", () => {
    const first = compileSnapshot();
    const second = compileSnapshot();
    const third = compileSnapshot();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(second)).toBe(JSON.stringify(third));
    expect(compileSnapshot("other-seed").identity.canonicalHash).not.toBe(first.identity.canonicalHash);
    expect(compileSnapshot("fixture-seed", "2").identity.canonicalHash).not.toBe(first.identity.canonicalHash);
  });

  it("keeps candidate eligibility non-formal and rejects blocked graphs before snapshot creation", () => {
    const candidateInput = baseFixture();
    candidateInput.relations[0]!.knowledge = "candidate";
    const candidate = compileSnapshotFrom(candidateInput);
    expect(candidate.eligibility).toEqual({ kind: "candidate", qaStatus: "pending", formalReasons: [], blockingReasons: ["candidate-structure"] });
    expect(() => { candidate.eligibility.kind = "formal"; }).toThrow();

    const blockedInput = baseFixture();
    blockedInput.modules.push(createModule("module:unknown", "unknown_module"));
    expect(() => compileSnapshotFrom(blockedInput)).toThrow("blocked");
  });

  it("deep-freezes the snapshot and does not expose geometry commands or raw-source fields", () => {
    const snapshot = compileSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.modules)).toBe(true);
    expect(Object.isFrozen(snapshot.modules[0])).toBe(true);
    expect(allObjectKeys(snapshot)).not.toEqual(expect.arrayContaining([
      "command", "com", "provider", "sourceCode", "sourcePath", "rawSource",
    ]));
  });

  it("expands a panel when many auxiliary modules would otherwise overflow its fixed baseline height", () => {
    const input = baseFixture();
    for (let index = 0; index < 12; index += 1) input.modules.push(createModule(`module:detail-${index}`, "attention_block"));
    const snapshot = compileSnapshotFrom(input);
    const detail = snapshot.panels.find((panel) => panel.panelId === "panel:detail")!;
    const detailModules = snapshot.modules.filter((module) => module.panelId === "panel:detail");
    expect(detail.bounds.height).toBeGreaterThan(1080);
    expect(detailModules.every((module) => contains(detail.bounds, module.bounds))).toBe(true);
  });
});

function compileSnapshot(layoutSeed = "fixture-seed", revision = "1") {
  const input = baseFixture();
  input.revision = revision;
  return compileSnapshotFrom(input, layoutSeed);
}

function compileSnapshotFrom(input: SemanticArchitectureGraphInput, layoutSeed = "fixture-seed") {
  const graph = normalizeSemanticArchitectureGraph(input);
  const compilation = compileSemanticVisualModules(graph);
  const story = composeFigureStory(graph, compilation);
  return compilePublicationVisualPlanVNext({
    graph,
    compilation,
    story,
    layoutSeed,
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
    dataObjects: [{
      dataId: "data:main",
      dataType: "feature_map",
      shape: { axes: ["C", "H", "W"], dimensions: [64, 32, 32] },
      sourceNodeIds: ["source"],
      evidenceIds: ["fact:main"],
      visualRole: "primary",
      confidence: 0.9,
      knowledge: "proven",
    }],
    relations: [
      relation("flow:input-stage", "data_flow", "module:input", "module:stage"),
      relation("flow:stage-attention", "data_flow", "module:stage", "module:attention"),
      relation("flow:attention-output", "data_flow", "module:attention", "module:output"),
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

function relation(relationId: string, type: "data_flow", sourceModuleId: string, targetModuleId: string) {
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

function contains(outer: { x: number; y: number; width: number; height: number }, inner: { x: number; y: number; width: number; height: number }): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function allObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allObjectKeys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allObjectKeys(child)]);
}
