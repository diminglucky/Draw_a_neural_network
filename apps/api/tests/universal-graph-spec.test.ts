import { describe, expect, it } from "vitest";
import { getUniversalGraphEligibility, parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import { unknownDualStreamFusionUgs } from "./fixtures/universal-graph-spec.js";

describe("UniversalGraphSpec", () => {
  it("accepts explicit unknown modules as directly renderable structure", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());

    expect(ugs.nodes.map((node) => node.kind)).toEqual(expect.arrayContaining(["custom_operator", "custom_module"]));
    expect(ugs.nodes.find((node) => node.nodeId === "spectral_fusion")?.inputPortIds).toEqual(["spectral_fusion:left", "spectral_fusion:right"]);
    expect(getUniversalGraphEligibility(ugs)).toEqual({ preview: "renderable", export: "eligible" });
  });

  it("keeps ambiguous topology as a candidate and denies export eligibility", () => {
    const input = unknownDualStreamFusionUgs();
    input.edges[1] = { ...input.edges[1], relation: "candidate", knowledge: "candidate" };
    input.unresolved = [{ id: "fusion-target", scope: "topology", severity: "blocking", evidenceIds: ["e-fusion"] }];

    const ugs = parseUniversalGraphSpec(input);

    expect(getUniversalGraphEligibility(ugs)).toEqual({ preview: "candidate", export: "ineligible" });
  });

  it("rejects ports that are not owned by their declared node", () => {
    const input = unknownDualStreamFusionUgs();
    input.nodes[1].inputPortIds = ["context_router:in"];

    expect(() => parseUniversalGraphSpec(input)).toThrow(/port|owner/i);
  });

  it("rejects free geometry outside the semantic graph contract", () => {
    const input = unknownDualStreamFusionUgs();
    input.layout = { x: 1 };

    expect(() => parseUniversalGraphSpec(input)).toThrow(/unrecognized|unknown/i);
  });

  it.each(["worker", "browser", "com", "sourceBytes", "rawSource", "workerCommand", "rendererPath", "visioModel", "outputPath", "geometry", "geometryMode", "geometry_mode", "rendering", "renderingMode", "rendering_mode", "execution", "executionTarget", "execution_target"])('rejects forbidden execution or renderer attribute key %s', (attributeKey) => {
    const input = unknownDualStreamFusionUgs();
    input.nodes[1].attributes = { [attributeKey]: "unsafe" };

    expect(() => parseUniversalGraphSpec(input)).toThrow(/attribute|permitted/i);
  });

  it("rejects a non-feedback cycle instead of treating it as a drawable DAG", () => {
    const input = unknownDualStreamFusionUgs();
    input.edges.push({
      edgeId: "fusion-to-texture-cycle",
      sourcePortId: "spectral_fusion:out",
      targetPortId: "texture_mixer:in",
      relation: "data",
      knowledge: "declared",
      evidenceIds: ["e-fusion"],
    });

    expect(() => parseUniversalGraphSpec(input)).toThrow(/cycle|topology/i);
  });

  it("rejects an otherwise valid structural edge without provenance evidence", () => {
    const input = unknownDualStreamFusionUgs();
    input.edges[0].evidenceIds = [];

    expect(() => parseUniversalGraphSpec(input)).toThrow(/evidence/i);
  });
});
