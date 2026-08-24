import { describe, expect, it } from "vitest";
import { compileComposableRegionVisuals } from "../src/composable-region-visual-compiler.js";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import {
  unknownHybridSemanticRegionsCandidateUgs,
  unknownHybridSemanticRegionsUgs,
} from "./fixtures/universal-graph-spec.js";

describe("compileComposableRegionVisuals", () => {
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
