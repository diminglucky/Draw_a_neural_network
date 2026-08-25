import { describe, expect, it } from "vitest";
import { createPublicationVisualPlan } from "../src/publication-visual-plan.js";
import { compilePublicationVisualPlan } from "../src/publication-visual-plan-compiler.js";
import { promotePublicationVisualPlanAfterTrustedReview, type TrustedPublicationVisualPlanReview } from "../src/publication-visual-plan-qa-promotion.js";
import { composeGeneralPublicationGraph } from "../src/general-publication-graph.js";
import { parseUniversalGraphSpec } from "../src/universal-graph-spec.js";
import { unknownDualStreamFusionUgs } from "./fixtures/universal-graph-spec.js";

const updateIdentity = { ownerId: "owner-1", deviceId: "device-1", workflowId: "workflow-1", documentId: "document-1", pageId: "page-1", expectedRevision: 1 };

function formalPendingPlan() {
  const ugs = parseUniversalGraphSpec(unknownDualStreamFusionUgs());
  const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
  return compilePublicationVisualPlan({ ugs, graph, updateIdentity });
}

function reviewFor(plan: any, overrides: Partial<TrustedPublicationVisualPlanReview> = {}): TrustedPublicationVisualPlanReview {
  return { authority: "trusted-human", reviewerId: "reviewer-1", reviewedAt: "2026-08-20T08:00:00.000Z", approval: "approved", expectedPlanHash: plan.identity.canonicalHash, ...overrides };
}

describe("trusted PVP QA promotion", () => {
  it("binds an explicitly reviewed formal pending PVP to a new canonical QA-passed PVP", () => {
    const pending = formalPendingPlan();
    const promoted = promotePublicationVisualPlanAfterTrustedReview({ plan: pending, review: reviewFor(pending) });

    expect(promoted.plan.eligibility).toMatchObject({ kind: "formal", qaStatus: "passed", blockingReasons: [] });
    expect((promoted.plan.eligibility.formalReasons as string[])).toContain(`visual-qa:pvp-qa-1:${pending.identity.canonicalHash}`);
    expect(promoted.plan.identity.canonicalHash).not.toBe(pending.identity.canonicalHash);
    expect(promoted.decision).toEqual({
      version: 1,
      status: "passed",
      qaVersion: "pvp-qa-1",
      reviewerId: "reviewer-1",
      reviewedAt: "2026-08-20T08:00:00.000Z",
      sourcePlanHash: pending.identity.canonicalHash,
      approvedPlanHash: promoted.plan.identity.canonicalHash,
    });
    expect(Object.isFrozen(promoted.decision)).toBe(true);
  });

  it("accepts a numeric-leading stable reviewer ID from the trusted review service", () => {
    const pending = formalPendingPlan();

    expect(promotePublicationVisualPlanAfterTrustedReview({
      plan: pending,
      review: reviewFor(pending, { reviewerId: "9ef7d40a-d6b5-4c91-9d5a-05a597c9668f" }),
    }).decision.reviewerId).toBe("9ef7d40a-d6b5-4c91-9d5a-05a597c9668f");
  });

  it.each([
    ["candidate PVP", () => {
      const source = unknownDualStreamFusionUgs();
      source.edges[0] = { ...source.edges[0], relation: "candidate", knowledge: "candidate" };
      const ugs = parseUniversalGraphSpec(source);
      const graph = composeGeneralPublicationGraph(ugs, { detail: "architecture" });
      const plan = compilePublicationVisualPlan({ ugs, graph, updateIdentity });
      return { plan, review: reviewFor(plan) };
    }],
    ["structurally failed PVP", () => {
      const pending = formalPendingPlan() as any;
      const plan = createPublicationVisualPlan({
        ...structuredClone(pending),
        annotations: [
          { annotationId: "annotation:a", targetIds: [pending.primitives[0].primitiveId], bounds: { x: 20, y: 20, width: 100, height: 60 }, text: "A", role: "note", styleTokenIds: [] },
          { annotationId: "annotation:b", targetIds: [pending.primitives[1].primitiveId], bounds: { x: 60, y: 40, width: 100, height: 60 }, text: "B", role: "note", styleTokenIds: [] },
        ],
      });
      return { plan, review: reviewFor(plan) };
    }],
    ["mismatched source hash", () => {
      const plan = formalPendingPlan();
      return { plan, review: reviewFor(plan, { expectedPlanHash: "0".repeat(64) }) };
    }],
    ["already passed PVP", () => {
      const pending = formalPendingPlan();
      const plan = createPublicationVisualPlan({ ...structuredClone(pending), eligibility: { kind: "formal", formalReasons: ["topology-complete"], blockingReasons: [], qaStatus: "passed" } });
      return { plan, review: reviewFor(plan) };
    }],
  ])("rejects %s", (_name, build) => {
    const input = build();
    expect(() => promotePublicationVisualPlanAfterTrustedReview(input)).toThrow();
  });
});
