import { createPublicationVisualPlan, parsePublicationVisualPlan, type PublicationVisualPlan } from "./publication-visual-plan.js";
import { evaluatePublicationVisualPlanQa } from "./publication-visual-plan-qa.js";
import { compareCodeUnits } from "./stable-string-order.js";

const REVIEWER_ID = /^[A-Za-z][A-Za-z0-9._:-]{0,191}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const PROMOTION_PREFIX = "visual-qa:pvp-qa-1:";

export interface TrustedPublicationVisualPlanReview {
  readonly authority: "trusted-human";
  readonly reviewerId: string;
  readonly reviewedAt: string;
  readonly approval: "approved";
  readonly expectedPlanHash: string;
}

export interface PublicationVisualPlanQaDecision {
  readonly version: 1;
  readonly status: "passed";
  readonly qaVersion: "pvp-qa-1";
  readonly reviewerId: string;
  readonly reviewedAt: string;
  readonly sourcePlanHash: string;
  readonly approvedPlanHash: string;
}

export function promotePublicationVisualPlanAfterTrustedReview(input: {
  plan: unknown;
  review: TrustedPublicationVisualPlanReview;
}): Readonly<{ plan: PublicationVisualPlan; decision: PublicationVisualPlanQaDecision }> {
  const plan = parsePublicationVisualPlan(input.plan);
  const review = parseReview(input.review);
  if (plan.eligibility.kind !== "formal" || plan.eligibility.qaStatus !== "pending" || plan.eligibility.blockingReasons.length !== 0) throw new Error("Only formal pending PVP can be promoted");
  if (review.expectedPlanHash !== plan.identity.canonicalHash) throw new Error("Trusted review does not match the pending PVP hash");
  const qa = evaluatePublicationVisualPlanQa(plan);
  if (qa.status !== "passed") throw new Error("PVP structural QA must pass before trusted promotion");

  const formalReasons = [...new Set([...plan.eligibility.formalReasons, `${PROMOTION_PREFIX}${plan.identity.canonicalHash}`])].sort(compareCodeUnits);
  const promoted = createPublicationVisualPlan({
    ...structuredClone(plan),
    eligibility: { kind: "formal", formalReasons, blockingReasons: [], qaStatus: "passed" },
  });
  return deepFreeze({
    plan: promoted,
    decision: {
      version: 1,
      status: "passed",
      qaVersion: "pvp-qa-1",
      reviewerId: review.reviewerId,
      reviewedAt: review.reviewedAt,
      sourcePlanHash: plan.identity.canonicalHash,
      approvedPlanHash: promoted.identity.canonicalHash,
    },
  });
}

export function isPublicationVisualPlanQaPromotionReason(value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^${PROMOTION_PREFIX}[a-f0-9]{64}$`).test(value);
}

function parseReview(value: unknown): TrustedPublicationVisualPlanReview {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Trusted review is invalid");
  const review = value as Record<string, unknown>;
  const keys = Object.keys(review).sort(compareCodeUnits);
  const expectedKeys = ["approval", "authority", "expectedPlanHash", "reviewedAt", "reviewerId"];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) throw new Error("Trusted review has unknown or missing fields");
  if (review.authority !== "trusted-human" || review.approval !== "approved" || typeof review.reviewerId !== "string" || !REVIEWER_ID.test(review.reviewerId) || typeof review.expectedPlanHash !== "string" || !DIGEST.test(review.expectedPlanHash) || typeof review.reviewedAt !== "string" || !isCanonicalTimestamp(review.reviewedAt)) throw new Error("Trusted review is invalid");
  return Object.freeze({ authority: "trusted-human", approval: "approved", reviewerId: review.reviewerId, expectedPlanHash: review.expectedPlanHash, reviewedAt: review.reviewedAt });
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}
