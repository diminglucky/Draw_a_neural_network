import { describe, expect, it } from "vitest";
import { compileGeneralPublicationFigurePlan, parseGeneralPublicationFigurePlan } from "../src/general-publication-figure-plan.js";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import { unknownDualStreamFusionUgs } from "./fixtures/universal-graph-spec.js";

describe("General Publication Figure Plan", () => {
  it("creates a deterministic renderer-neutral plan for a complete unknown-module graph", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });

    const first = compileGeneralPublicationFigurePlan({ ugs, graph });
    const second = compileGeneralPublicationFigurePlan({ ugs, graph });

    expect(first).toEqual(second);
    expect(first.primitives).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "custom_operator", sourceNodeIds: ["texture_mixer"] }),
      expect.objectContaining({ role: "custom_module", sourceNodeIds: ["spectral_fusion"] }),
    ]));
    expect(first.sourceGraphHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toMatch(/\b(visio|svg|com|worker|command|path|sourceBytes)\b/i);
  });

  it("maps semantic rank and lane order to stable bounds and traceable formal connectors", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const plan = compileGeneralPublicationFigurePlan({ ugs, graph });
    const input = plan.primitives.find((item) => item.sourceComponentIds.includes("node:input"));
    const texture = plan.primitives.find((item) => item.sourceComponentIds.includes("node:texture_mixer"));
    const context = plan.primitives.find((item) => item.sourceComponentIds.includes("node:context_router"));

    expect(input).toBeDefined();
    expect(texture).toBeDefined();
    expect(context).toBeDefined();
    expect(texture!.bounds.left).toBeGreaterThan(input!.bounds.left);
    expect(context!.bounds.top).not.toBe(texture!.bounds.top);
    expect(plan.connectors).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "flow", sourceRelationIds: ["relation:input-to-texture"] }),
    ]));
  });

  it.each(["candidate-edge", "blocking-topology", "feedback"])("rejects %s before formal planning", (kind) => {
    const input = unknownDualStreamFusionUgs();
    if (kind === "candidate-edge") input.edges[1] = { ...input.edges[1], relation: "candidate", knowledge: "candidate" };
    if (kind === "blocking-topology") input.unresolved = [{ id: "fusion-target", scope: "topology", severity: "blocking", evidenceIds: ["e-fusion"] }];
    if (kind === "feedback") input.edges.push({ edgeId: "feedback-edge", sourcePortId: "spectral_fusion:out", targetPortId: "texture_mixer:in", relation: "feedback", knowledge: "proven", evidenceIds: ["e-fusion"] });
    const ugs = parseUniversalGraphSpec(input);
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });

    expect(() => compileGeneralPublicationFigurePlan({ ugs, graph })).toThrow(/eligible|candidate|feedback/i);
  });

  it("rejects duplicate evidence and source references before a plan can be frozen", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const plan = compileGeneralPublicationFigurePlan({ ugs, graph });
    const duplicateEvidence = structuredClone(plan);
    duplicateEvidence.primitives[0]!.evidenceIds = ["e-input", "e-input"];
    const duplicateSource = structuredClone(plan);
    duplicateSource.sourceMappings[0]!.sourceComponentIds = ["node:input", "node:input"];

    expect(() => parseGeneralPublicationFigurePlan(duplicateEvidence)).toThrow(/duplicate|unique/i);
    expect(() => parseGeneralPublicationFigurePlan(duplicateSource)).toThrow(/duplicate|unique/i);
  });
});
