import { describe, expect, it } from "vitest";
import { assertPublicationVisualPlanRendererCapabilities, compilePublicationVisualPlan } from "../src/publication-visual-plan-compiler.js";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import { unknownDualStreamFusionUgs, unknownResidualMultiBranchUgs } from "./fixtures/universal-graph-spec.js";

const updateIdentity = { ownerId: "owner-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 };

describe("PublicationVisualPlan compiler", () => {
  it("compiles an unseen dual-stream custom network into a formal plan with native ports and orthogonal routes", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const plan = compilePublicationVisualPlan({ ugs, graph, updateIdentity });

    expect(plan.eligibility).toMatchObject({ kind: "formal", qaStatus: "pending" });
    expect((plan.primitives as any[]).some((item) => item.kind === "CustomOperator")).toBe(true);
    expect(plan.ports).toHaveLength(graph.relations.length * 2);
    expect(plan.connectors).toHaveLength(graph.relations.length);
    expect(plan.sourceMappings).toHaveLength(graph.components.length);
    for (const connector of plan.connectors as any[]) {
      expect(connector.route).toHaveLength(4);
      expect(connector.route[0]).not.toEqual(connector.route.at(-1));
    }
  });

  it("keeps ambiguous topology as a non-exportable candidate plan", () => {
    const input = unknownDualStreamFusionUgs();
    input.edges[1] = { ...input.edges[1], relation: "candidate", knowledge: "candidate" };
    const ugs = parseUniversalGraphSpec(input);
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const plan = compilePublicationVisualPlan({ ugs, graph, updateIdentity });

    expect(plan.eligibility).toMatchObject({ kind: "candidate", formalReasons: [], qaStatus: "pending" });
    expect(plan.eligibility.blockingReasons).toEqual(["topology-candidate"]);
  });

  it.each(["candidate-edge", "feedback-edge"])("never promotes %s to a formal PVP", (kind) => {
    const input = unknownDualStreamFusionUgs();
    if (kind === "candidate-edge") input.edges[1] = { ...input.edges[1], relation: "candidate", knowledge: "candidate" };
    if (kind === "feedback-edge") input.edges.push({ edgeId: "feedback", sourcePortId: "spectral_fusion:out", targetPortId: "texture_mixer:in", relation: "feedback", knowledge: "proven", evidenceIds: ["e-fusion"] });
    const ugs = parseUniversalGraphSpec(input);
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });

    expect(compilePublicationVisualPlan({ ugs, graph, updateIdentity }).eligibility.kind).toBe("candidate");
  });

  it("fails closed when a renderer lacks a required PVP capability", () => {
    const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const plan = compilePublicationVisualPlan({ ugs, graph, updateIdentity });

    expect(() => assertPublicationVisualPlanRendererCapabilities(plan, ["native-text", "orthogonal-route"])).toThrow(/shape-data|capability/i);
    expect(() => assertPublicationVisualPlanRendererCapabilities(plan, ["native-text", "orthogonal-route", "shape-data"])).not.toThrow();
  });

  it("records deterministic Profile provenance without changing structural PVP topology", () => {
    const ugs = parseUniversalGraphSpec(unknownResidualMultiBranchUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const first = compilePublicationVisualPlan({ ugs, graph, updateIdentity });
    const second = compilePublicationVisualPlan({ ugs, graph, updateIdentity });

    expect(first.profileApplications).toEqual(second.profileApplications);
    expect(first.profileApplications).toMatchObject([{ profileId: "residual-branch", profileVersion: "u3-1" }]);
    expect((first.lineage as any).profileSetHash).not.toBe("4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
    expect(first.sourceMappings).toEqual(second.sourceMappings);
    expect(first.ports).toEqual(second.ports);
    expect((first.connectors as any[]).map(({ connectorId, sourcePortId, targetPortId, route }) => ({ connectorId, sourcePortId, targetPortId, route })))
      .toEqual((second.connectors as any[]).map(({ connectorId, sourcePortId, targetPortId, route }) => ({ connectorId, sourcePortId, targetPortId, route })));
  });
});
