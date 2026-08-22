import { describe, expect, it } from "vitest";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import { unknownDualStreamFusionUgs, unknownRepeatedFusionStackUgs } from "./fixtures/universal-graph-spec.js";

describe("General Publication Graph", () => {
  it("composes a deterministic publication graph for an unseen dual-stream fusion", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
    const first = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const second = composeGeneralPublicationGraph(ugs, { detail: "architecture" });

    expect(first).toEqual(second);
    expect(first.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "custom_operator", sourceNodeIds: ["texture_mixer"] }),
      expect.objectContaining({ role: "custom_module", sourceNodeIds: ["spectral_fusion"] }),
      expect.objectContaining({ role: "custom_fusion", sourceNodeIds: ["spectral_fusion"] }),
    ]));
    expect(first.exportEligibility).toBe("eligible");
    expect(first.layoutOrder).toEqual(first.components.map((component) => ({
      componentId: component.componentId,
      rank: component.layoutOrder.rank,
      order: component.layoutOrder.order,
    })));
    expect(JSON.stringify(first)).not.toMatch(/\b(x|y|width|height|visio|svg|command|path)\b/i);
  });

  it("normalizes equivalent evidence ordering before producing a semantic graph", () => {
    const firstInput = unknownDualStreamFusionUgs();
    const secondInput = unknownDualStreamFusionUgs();
    firstInput.nodes.find((node: any) => node.nodeId === "texture_mixer").evidenceIds = ["e-texture", "e-context"];
    secondInput.nodes.find((node: any) => node.nodeId === "texture_mixer").evidenceIds = ["e-context", "e-texture"];

    const first = composeGeneralPublicationGraph(parseUniversalGraphSpec(firstInput), { detail: "architecture" });
    const second = composeGeneralPublicationGraph(parseUniversalGraphSpec(secondInput), { detail: "architecture" });

    expect(first).toEqual(second);
  });

  it("preserves confirmed components but represents ambiguous topology as a candidate region", () => {
    const input = unknownDualStreamFusionUgs();
    input.edges[1] = { ...input.edges[1], relation: "candidate", knowledge: "candidate" };
    input.unresolved = [{ id: "fusion-target", scope: "topology", severity: "blocking", evidenceIds: ["e-fusion"] }];

    const graph = composeGeneralPublicationGraph(parseUniversalGraphSpec(input), { detail: "architecture" });

    expect(graph.exportEligibility).toBe("ineligible");
    expect(graph.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "custom_operator", sourceNodeIds: ["texture_mixer"] }),
      expect.objectContaining({ role: "candidate_region", sourceEdgeIds: ["input-to-context"] }),
    ]));
    expect(graph.relations.some((relation) => relation.sourceEdgeIds.includes("input-to-context"))).toBe(false);
  });

  it("turns evidence-only blocking topology uncertainty into a traceable candidate region", () => {
    const input = unknownDualStreamFusionUgs();
    input.unresolved = [{ id: "fusion-target", scope: "topology", severity: "blocking", evidenceIds: ["e-fusion"] }];

    const graph = composeGeneralPublicationGraph(parseUniversalGraphSpec(input), { detail: "architecture" });

    expect(graph.exportEligibility).toBe("ineligible");
    expect(graph.components).toEqual(expect.arrayContaining([
      expect.objectContaining({
        componentId: "candidate:unresolved:fusion-target",
        role: "candidate_region",
        sourceNodeIds: ["spectral_fusion"],
        sourceEdgeIds: [],
        evidenceIds: ["e-fusion"],
      }),
    ]));
  });

  it("keeps proven feedback out of the generic DAG flow until a recurrence grammar exists", () => {
    const input = unknownDualStreamFusionUgs();
    input.edges.push({
      edgeId: "fusion-feedback",
      sourcePortId: "spectral_fusion:out",
      targetPortId: "texture_mixer:in",
      relation: "feedback",
      knowledge: "proven",
      evidenceIds: ["e-fusion"],
    });

    const graph = composeGeneralPublicationGraph(parseUniversalGraphSpec(input), { detail: "architecture" });

    expect(graph.exportEligibility).toBe("ineligible");
    expect(graph.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "candidate_region", sourceEdgeIds: ["fusion-feedback"] }),
    ]));
    expect(graph.relations.some((relation) => relation.sourceEdgeIds.includes("fusion-feedback"))).toBe(false);
  });

  it("keeps repeated unseen module members and count in one deterministic repeat badge", () => {
    const graph = composeGeneralPublicationGraph(parseUniversalGraphSpec(unknownRepeatedFusionStackUgs()), { detail: "architecture" });
    const badges = graph.components.filter((component) => component.role === "repeat_badge");

    expect(badges).toHaveLength(1);
    expect(badges[0]).toMatchObject({
      count: 3,
      sourceNodeIds: expect.arrayContaining(["spectral_stack", "texture_mixer", "context_router", "spectral_fusion"]),
    });
  });
});
