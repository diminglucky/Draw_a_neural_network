import { describe, expect, it } from "vitest";
import { deriveComposableSemanticRegions } from "../src/composable-semantic-regions.js";
import {
  scaleLikeLabelsWithoutFactsUgs,
  unknownHybridSemanticRegionsCandidateUgs,
  unknownHybridSemanticRegionsFeedbackUgs,
  unknownHybridSemanticRegionsUgs,
} from "./fixtures/universal-graph-spec.js";

describe("composable semantic regions", () => {
  it("derives coexisting formal regions from anonymous, source-backed UGS facts", () => {
    const first = deriveComposableSemanticRegions(unknownHybridSemanticRegionsUgs());
    const second = deriveComposableSemanticRegions(unknownHybridSemanticRegionsUgs());

    expect(first).toEqual(second);
    expect(first.map((region) => region.regionId)).toEqual([
      "add_merge:add_gate",
      "concat_fusion:concat_gate",
      "custom_module:opaque_module",
      "multi_branch:spatial_stage",
      "repeat_group:repeat-core:spatial_stage",
      "scale_transition:source-to-spatial",
      "token_attention:token_attention",
    ]);
    expect(first.every((region) => region.state === "formal")).toBe(true);
    expect(first.map((region) => region.kind)).toEqual([
      "add_merge",
      "concat_fusion",
      "custom_module",
      "multi_branch",
      "repeat_group",
      "scale_transition",
      "token_attention",
    ]);
    expect(first.find((region) => region.kind === "scale_transition")).toMatchObject({
      sourceNodeIds: ["source_field", "spatial_stage"],
      sourceEdgeIds: ["source-to-spatial"],
      sourceGroupIds: [],
      evidenceIds: ["e-topology"],
    });
    expect(first.find((region) => region.kind === "repeat_group")).toMatchObject({
      sourceNodeIds: ["spatial_stage"],
      sourceEdgeIds: [],
      sourceGroupIds: ["repeat-core"],
      evidenceIds: ["e-topology"],
    });
    expect(first.find((region) => region.kind === "add_merge")).toMatchObject({
      sourceNodeIds: ["add_gate", "left_path", "right_path"],
      sourceEdgeIds: ["left-to-add", "right-to-add"],
      sourceGroupIds: [],
      evidenceIds: ["e-topology"],
    });
    for (const region of first) {
      expect(region.sourceNodeIds).toEqual([...region.sourceNodeIds].sort());
      expect(region.sourceEdgeIds).toEqual([...region.sourceEdgeIds].sort());
      expect(region.sourceGroupIds).toEqual([...region.sourceGroupIds].sort());
      expect(region.evidenceIds).toEqual([...region.evidenceIds].sort());
    }
  });

  it("fails closed to candidate feedback when candidate, feedback, or blocking topology appears", () => {
    for (const input of [
      unknownHybridSemanticRegionsCandidateUgs(),
      unknownHybridSemanticRegionsFeedbackUgs(),
      { ...unknownHybridSemanticRegionsUgs(), unresolved: [{ id: "topology-question", scope: "topology", severity: "blocking", evidenceIds: ["e-topology"] }] },
    ]) {
      const regions = deriveComposableSemanticRegions(input);

      expect(regions.length).toBeGreaterThan(0);
      expect(regions.every((region) => region.kind === "candidate_feedback" && region.state === "candidate")).toBe(true);
      expect(regions.every((region) => region.evidenceIds.length > 0)).toBe(true);
      expect(regions.some((region) => region.state === "formal")).toBe(false);
    }
  });

  it("does not infer a scale transition from scale-like labels without numeric tensor facts", () => {
    const regions = deriveComposableSemanticRegions(scaleLikeLabelsWithoutFactsUgs());

    expect(regions.some((region) => region.kind === "scale_transition")).toBe(false);
  });

  it("traces a repeat container through its declared group even when the container is not itself a group member", () => {
    const input = unknownHybridSemanticRegionsUgs();
    input.groups[0].memberNodeIds = ["left_path"];

    const repeat = deriveComposableSemanticRegions(input).find((region) => region.kind === "repeat_group");

    expect(repeat).toMatchObject({
      sourceNodeIds: ["left_path", "spatial_stage"],
      sourceGroupIds: ["repeat-core"],
      evidenceIds: ["e-topology"],
    });
  });

  it("validates the UGS input before deriving and serializes no rendering authority", () => {
    expect(() => deriveComposableSemanticRegions({ ...unknownHybridSemanticRegionsUgs(), nodes: [] } as any)).toThrow(/UniversalGraphSpec validation failed/i);

    const input = unknownHybridSemanticRegionsUgs();
    input.nodes.find((node: any) => node.nodeId === "opaque_module").label = "Visio SVG renderer";
    input.groups[0].label = "Geometry coordinates";
    const serialized = JSON.stringify(deriveComposableSemanticRegions(input));
    expect(serialized).not.toMatch(/geometry|svg|native|worker|visio|command|vgg|resnet|u[-_ ]?net|vision transformer|vit/iu);
  });
});
