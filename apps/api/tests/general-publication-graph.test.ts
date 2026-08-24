import { describe, expect, it } from "vitest";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import {
  unknownDualStreamFusionUgs,
  unknownHybridSemanticRegionsCandidateUgs,
  unknownHybridSemanticRegionsUgs,
  unknownRepeatedFusionStackUgs,
} from "./fixtures/universal-graph-spec.js";

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

  it("retains one deterministic full semantic-region representation whose provenance is valid UGS evidence", () => {
    const ugs = parseUniversalGraphSpec(unknownHybridSemanticRegionsUgs());
    const first = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const second = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const nodeIds = new Set(ugs.nodes.map((node) => node.nodeId));
    const edgeIds = new Set(ugs.edges.map((edge) => edge.edgeId));
    const groupIds = new Set(ugs.groups.map((group) => group.groupId));
    const evidenceIds = new Set(ugs.evidence.map((evidence) => evidence.evidenceId));

    expect(first).toEqual(second);
    expect(first.semanticRegions.map((region) => region.regionId)).toEqual([...first.semanticRegions.map((region) => region.regionId)].sort());
    expect(first.semanticRegions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "scale_transition", state: "formal" }),
      expect.objectContaining({ kind: "repeat_group", state: "formal" }),
      expect.objectContaining({ kind: "add_merge", state: "formal" }),
      expect.objectContaining({ kind: "concat_fusion", state: "formal" }),
    ]));
    for (const region of first.semanticRegions) {
      expect(region.sourceNodeIds.every((id) => nodeIds.has(id))).toBe(true);
      expect(region.sourceEdgeIds.every((id) => edgeIds.has(id))).toBe(true);
      expect(region.sourceGroupIds.every((id) => groupIds.has(id))).toBe(true);
      expect(region.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
    }
  });

  it("keeps known generic components while candidate semantic regions make the GPG ineligible", () => {
    const graph = composeGeneralPublicationGraph(
      parseUniversalGraphSpec(unknownHybridSemanticRegionsCandidateUgs()),
      { detail: "architecture" },
    );

    expect(graph.exportEligibility).toBe("ineligible");
    expect(graph.semanticRegions).toEqual([
      expect.objectContaining({ kind: "candidate_feedback", state: "candidate" }),
    ]);
    expect(graph.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ componentId: "node:spatial_stage", role: "custom_operator" }),
      expect.objectContaining({ componentId: "node:result_field", role: "output" }),
    ]));
    expect(graph.relations.some((relation) => relation.role === "flow")).toBe(true);
  });
});
