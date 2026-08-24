import { describe, expect, it } from "vitest";
import {
  createPublicationVisualReviewRecord,
  isAcceptedPublicationVisualReviewRecord,
} from "../src/publication-visual-review-record.js";

const acceptedInput = () => ({
  corpusCaseId: "corpus.dual-stream",
  pvpHash: "a".repeat(64),
  svgHash: "b".repeat(64),
  reviewer: "independent-reviewer",
  reviewedAt: "2026-08-24T09:30:00.000Z",
  hierarchy: true,
  topologyReadability: true,
  labelReadability: true,
  visualDensity: true,
  grayscaleDistinction: true,
  publicationSuitability: true,
});

describe("PublicationVisualReviewRecord", () => {
  it("creates a detached immutable record accepted only when every SVG review criterion is true", () => {
    const input = acceptedInput();
    const record = createPublicationVisualReviewRecord(input);

    expect(record).toEqual(input);
    expect(record).not.toBe(input);
    expect(Object.isFrozen(record)).toBe(true);
    expect(isAcceptedPublicationVisualReviewRecord(record)).toBe(true);

    input.reviewer = "changed-after-create";
    expect(record.reviewer).toBe("independent-reviewer");
  });

  it.each([
    "hierarchy",
    "topologyReadability",
    "labelReadability",
    "visualDensity",
    "grayscaleDistinction",
    "publicationSuitability",
  ] as const)("does not accept a record when %s is false", (field) => {
    const input = acceptedInput();
    input[field] = false;

    expect(isAcceptedPublicationVisualReviewRecord(createPublicationVisualReviewRecord(input))).toBe(false);
  });

  it("rejects missing, unknown, Task 8, and rubric fields", () => {
    const missing = acceptedInput() as Record<string, unknown>;
    delete missing.svgHash;
    expect(() => createPublicationVisualReviewRecord(missing)).toThrow(/missing|field|review/i);

    for (const extra of [
      { pngHash: "c".repeat(64) },
      { rasterizerVersion: "browser-1" },
      { rubric: { score: 1 } },
      { accepted: true },
    ]) {
      expect(() => createPublicationVisualReviewRecord({ ...acceptedInput(), ...extra })).toThrow(/unknown|field|review/i);
    }
  });

  it.each([
    ["corpus case ID", { corpusCaseId: "not allowed" }],
    ["uppercase PVP hash", { pvpHash: "A".repeat(64) }],
    ["short SVG hash", { svgHash: "b".repeat(63) }],
    ["empty reviewer", { reviewer: "" }],
    ["padded reviewer", { reviewer: " reviewer " }],
    ["offset timestamp", { reviewedAt: "2026-08-24T17:30:00.000+08:00" }],
    ["invalid UTC timestamp", { reviewedAt: "2026-02-30T09:30:00.000Z" }],
    ["non-boolean criterion", { hierarchy: "true" }],
  ])("rejects %s", (_name, changed) => {
    expect(() => createPublicationVisualReviewRecord({ ...acceptedInput(), ...changed })).toThrow();
  });
});
