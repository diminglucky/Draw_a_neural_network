import { describe, expect, it } from "vitest";
import { compileGeneralPublicationVisualPlan } from "../src/publication-visual-plan-compiler.js";
import type { PresentationProfile } from "../src/presentation-profile.js";
import { applyPresentationProfiles } from "../src/presentation-profile-registry.js";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import { unknownResidualMultiBranchUgs } from "./fixtures/universal-graph-spec.js";

const updateIdentity = { ownerId: "owner-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 };

function profile(profileId: string, tokenId: string): PresentationProfile {
  return {
    profileId,
    profileVersion: "test-1",
    match: () => ({ componentIds: ["node:branch_gate"], relationIds: [] }),
    apply: () => ({
      primitiveStyleTokenIds: [{ primitiveId: "primitive:node:branch_gate", styleTokenIds: [tokenId] }],
      connectorStyleTokenIds: [],
      styleTokens: [{ tokenId, values: { stroke: "#000000" } }],
      affectedIds: ["node:branch_gate"],
    }),
  };
}

describe("Presentation Profile registry", () => {
  it("returns the exact General PVP when two profiles claim the same visual target", () => {
    const ugs = parseUniversalGraphSpec(unknownResidualMultiBranchUgs());
    const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
    const generalPlan = compileGeneralPublicationVisualPlan({ ugs, graph, updateIdentity });

    const result = applyPresentationProfiles({
      ugs,
      graph,
      plan: generalPlan,
      profiles: [profile("first-profile", "profile:first"), profile("second-profile", "profile:second")],
    });

    expect(result).toEqual({ plan: generalPlan, applications: [] });
  });
});
