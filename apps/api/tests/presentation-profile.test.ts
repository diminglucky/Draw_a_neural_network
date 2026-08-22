import { describe, expect, it } from "vitest";
import { compileGeneralPublicationVisualPlan } from "../src/publication-visual-plan-compiler.js";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { applyPresentationProfiles } from "../src/presentation-profile-registry.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import {
  unknownCustomSpatialBackboneUgs,
  unknownDualTowerCrossModalFusionUgs,
  unknownMultiScaleEncoderDecoderUgs,
  unknownRepeatedFusionStackUgs,
  unknownResidualMultiBranchUgs,
} from "./fixtures/universal-graph-spec.js";

const updateIdentity = { ownerId: "owner-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 };

describe("Presentation Profile contract", () => {
  it("matches residual structure without inspecting the graph name or changing structural PVP fields", () => {
    const source = unknownResidualMultiBranchUgs();
    source.graphId = "unfamiliar-graph-name";
    const ugs = parseUniversalGraphSpec(source);
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const generalPlan = compileGeneralPublicationVisualPlan({ ugs, graph, updateIdentity });

    const result = applyPresentationProfiles({ ugs, graph, plan: generalPlan });

    expect(result.applications.map((item) => item.profileId)).toEqual(["residual-branch"]);
    expect(result.plan.sourceMappings).toEqual(generalPlan.sourceMappings);
    expect(result.plan.eligibility).toEqual(generalPlan.eligibility);
    expect(result.plan.ports).toEqual(generalPlan.ports);
    expect((result.plan.connectors as any[]).map(({ connectorId, sourcePortId, targetPortId, route }) => ({ connectorId, sourcePortId, targetPortId, route })))
      .toEqual((generalPlan.connectors as any[]).map(({ connectorId, sourcePortId, targetPortId, route }) => ({ connectorId, sourcePortId, targetPortId, route })));
  });

  it.each([
    ["unfamiliar spatial chain", unknownCustomSpatialBackboneUgs, "spatial-scale"],
    ["unfamiliar residual branch", unknownResidualMultiBranchUgs, "residual-branch"],
    ["unfamiliar encoder decoder", unknownMultiScaleEncoderDecoderUgs, "encoder-decoder"],
    ["unfamiliar dual tower", unknownDualTowerCrossModalFusionUgs, "dual-tower-fusion"],
    ["unfamiliar repeated stack", unknownRepeatedFusionStackUgs, "repeat-collapse"],
  ])("selects %s from graph semantics rather than a known model family", (_name, createUgs, expectedProfileId) => {
    const ugs = parseUniversalGraphSpec(createUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const generalPlan = compileGeneralPublicationVisualPlan({ ugs, graph, updateIdentity });

    const result = applyPresentationProfiles({ ugs, graph, plan: generalPlan });

    expect(result.applications.map((item) => item.profileId)).toContain(expectedProfileId);
  });
});
