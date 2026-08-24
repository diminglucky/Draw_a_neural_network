import { describe, expect, it } from "vitest";
import { compileComposableRegionVisuals } from "../src/composable-region-visual-compiler.js";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import {
  unknownHybridSemanticRegionsCandidateUgs,
  unknownHybridSemanticRegionsUgs,
} from "./fixtures/universal-graph-spec.js";

describe("compileComposableRegionVisuals", () => {
  it("keeps an anonymous composite component primary while preserving every concurrent visual meaning", () => {
    const input = unknownHybridSemanticRegionsUgs();
    input.nodes.find((node: any) => node.nodeId === "spatial_stage").kind = "custom_module";
    const graph = composeGeneralPublicationGraph(parseUniversalGraphSpec(input), { detail: "architecture" });

    const first = compileComposableRegionVisuals(graph);
    const second = compileComposableRegionVisuals(graph);
    const descriptors = first.descriptors.filter((descriptor) => descriptor.sourceNodeIds.includes("spatial_stage"));

    expect(first).toEqual(second);
    expect(first.descriptors.map((descriptor) => descriptor.primitiveId)).toEqual(second.descriptors.map((descriptor) => descriptor.primitiveId));
    expect(descriptors).toEqual(expect.arrayContaining([
      expect.objectContaining({ primitiveId: "primitive:node:spatial_stage", topologyComponentId: "node:spatial_stage", kind: "ModuleFrame" }),
      expect.objectContaining({ primitiveId: "primitive:semantic:scale_transition:source-to-spatial:stage", topologyComponentId: null, kind: "TensorStage" }),
      expect.objectContaining({ primitiveId: "primitive:semantic:scale_transition:source-to-spatial:volume", topologyComponentId: null, kind: "TensorVolume" }),
      expect.objectContaining({ primitiveId: "primitive:repeat:spatial_stage", kind: "RepeatBadge" }),
      expect.objectContaining({ primitiveId: "primitive:semantic:multi_branch:spatial_stage:split", topologyComponentId: null, kind: "SplitMarker" }),
    ]));
    expect(descriptors.filter((descriptor) => descriptor.topologyComponentId === "node:spatial_stage")).toEqual([
      expect.objectContaining({ kind: "ModuleFrame" }),
    ]);

    const primary = descriptors.find((descriptor) => descriptor.primitiveId === "primitive:node:spatial_stage")!;
    const stage = descriptors.find((descriptor) => descriptor.primitiveId === "primitive:semantic:scale_transition:source-to-spatial:stage")!;
    const volume = descriptors.find((descriptor) => descriptor.primitiveId === "primitive:semantic:scale_transition:source-to-spatial:volume")!;
    const repeat = descriptors.find((descriptor) => descriptor.primitiveId === "primitive:repeat:spatial_stage")!;
    const split = descriptors.find((descriptor) => descriptor.primitiveId === "primitive:semantic:multi_branch:spatial_stage:split")!;

    expect(primary.attachment).toBeNull();
    expect(stage).toMatchObject({
      layout: expect.objectContaining({ rank: primary.layout.rank }),
      attachment: { primaryPrimitiveId: primary.primitiveId, placement: "adjacent_right_top", slot: 0 },
    });
    expect(volume).toMatchObject({
      layout: expect.objectContaining({ rank: primary.layout.rank }),
      attachment: { primaryPrimitiveId: primary.primitiveId, placement: "adjacent_right_bottom", slot: 0 },
    });
    expect(repeat).toMatchObject({
      layout: expect.objectContaining({ rank: primary.layout.rank }),
      attachment: { primaryPrimitiveId: primary.primitiveId, placement: "corner_top_right", slot: 0 },
    });
    expect(split).toMatchObject({
      layout: expect.objectContaining({ rank: primary.layout.rank }),
      attachment: { primaryPrimitiveId: primary.primitiveId, placement: "output_side", slot: 0 },
    });
    expect([stage, volume, repeat, split].every((descriptor) => descriptor.sourceNodeIds.includes("spatial_stage") && descriptor.evidenceIds.length > 0)).toBe(true);
    expect(first.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "attachment", subjectIds: [primary.primitiveId, stage.primitiveId] }),
      expect.objectContaining({ kind: "attachment", subjectIds: [primary.primitiveId, volume.primitiveId] }),
      expect.objectContaining({ kind: "attachment", subjectIds: [primary.primitiveId, repeat.primitiveId] }),
      expect.objectContaining({ kind: "attachment", subjectIds: [primary.primitiveId, split.primitiveId] }),
    ]));
  });

  it("maps an anonymous hybrid graph to stable semantic visual descriptors without adding topology", () => {
    const graph = composeGeneralPublicationGraph(
      parseUniversalGraphSpec(unknownHybridSemanticRegionsUgs()),
      { detail: "architecture" },
    );

    const first = compileComposableRegionVisuals(graph);
    const second = compileComposableRegionVisuals(graph);
    const kinds = first.descriptors.map((descriptor) => descriptor.kind);

    expect(first).toEqual(second);
    expect(kinds).toEqual(expect.arrayContaining([
      "InputTerminal", "OutputTerminal", "TensorStage", "TensorVolume",
      "OperatorFrame", "ModuleFrame", "RepeatBadge", "SplitMarker",
      "AddMarker", "ConcatMarker", "AttentionTokenStrip", "AttentionRelation",
    ]));
    expect(first.descriptors.filter((descriptor) => descriptor.topologyComponentId !== null)
      .map((descriptor) => descriptor.topologyComponentId).sort())
      .toEqual(graph.components.map((component) => component.componentId).sort());
    expect(first.groups.every((group) => group.primitiveIds.length > 0)).toBe(true);
    expect(first.constraints.every((constraint) => constraint.subjectIds.length > 0 && !Object.hasOwn(constraint, "x") && !Object.hasOwn(constraint, "y"))).toBe(true);
  });

  it("emits only a CandidateCallout semantic descriptor for candidate regions and marks it ineligible", () => {
    const graph = composeGeneralPublicationGraph(
      parseUniversalGraphSpec(unknownHybridSemanticRegionsCandidateUgs()),
      { detail: "architecture" },
    );

    const visuals = compileComposableRegionVisuals(graph);

    expect(visuals.exportEligible).toBe(false);
    expect(visuals.descriptors).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "CandidateCallout", regionRole: "candidate_feedback" }),
    ]));
    expect(visuals.descriptors.some((descriptor) => descriptor.kind === "TensorVolume")).toBe(false);
  });
});
