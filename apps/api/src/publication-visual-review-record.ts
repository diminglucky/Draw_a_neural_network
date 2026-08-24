const REVIEW_RECORD_KEYS = [
  "corpusCaseId",
  "pvpHash",
  "svgHash",
  "reviewer",
  "reviewedAt",
  "hierarchy",
  "topologyReadability",
  "labelReadability",
  "visualDensity",
  "grayscaleDistinction",
  "publicationSuitability",
] as const;

const CORPUS_CASE_ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_REVIEWER_LENGTH = 128;

export interface PublicationVisualReviewRecord {
  readonly corpusCaseId: string;
  readonly pvpHash: string;
  readonly svgHash: string;
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly hierarchy: boolean;
  readonly topologyReadability: boolean;
  readonly labelReadability: boolean;
  readonly visualDensity: boolean;
  readonly grayscaleDistinction: boolean;
  readonly publicationSuitability: boolean;
}

/**
 * Creates the Task 7 SVG-only independent review record. The record binds an
 * anonymous corpus case to exact PVP/SVG bytes, but deliberately contains no
 * rasterizer, PNG, source, rubric, or native/Visio state.
 */
export function createPublicationVisualReviewRecord(input: unknown): PublicationVisualReviewRecord {
  return parsePublicationVisualReviewRecord(input);
}

export function parsePublicationVisualReviewRecord(input: unknown): PublicationVisualReviewRecord {
  const value = exactRecord(input);
  const record: PublicationVisualReviewRecord = {
    corpusCaseId: corpusCaseId(value.corpusCaseId),
    pvpHash: digest(value.pvpHash, "PVP hash"),
    svgHash: digest(value.svgHash, "SVG hash"),
    reviewer: reviewer(value.reviewer),
    reviewedAt: reviewedAt(value.reviewedAt),
    hierarchy: boolean(value.hierarchy, "hierarchy"),
    topologyReadability: boolean(value.topologyReadability, "topologyReadability"),
    labelReadability: boolean(value.labelReadability, "labelReadability"),
    visualDensity: boolean(value.visualDensity, "visualDensity"),
    grayscaleDistinction: boolean(value.grayscaleDistinction, "grayscaleDistinction"),
    publicationSuitability: boolean(value.publicationSuitability, "publicationSuitability"),
  };
  return Object.freeze(record);
}

/** A review is accepted only when every named SVG review criterion passed. */
export function isAcceptedPublicationVisualReviewRecord(input: PublicationVisualReviewRecord): boolean {
  const record = parsePublicationVisualReviewRecord(input);
  return record.hierarchy
    && record.topologyReadability
    && record.labelReadability
    && record.visualDensity
    && record.grayscaleDistinction
    && record.publicationSuitability;
}

function exactRecord(input: unknown): Record<(typeof REVIEW_RECORD_KEYS)[number], unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) throw new Error("Publication visual review record must be a plain object");
  const value = input as Record<string, unknown>;
  const actual = Object.keys(value).sort();
  const expected = [...REVIEW_RECORD_KEYS].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error("Publication visual review record has unknown or missing fields");
  return value as Record<(typeof REVIEW_RECORD_KEYS)[number], unknown>;
}

function corpusCaseId(value: unknown): string {
  if (typeof value !== "string" || !CORPUS_CASE_ID.test(value)) throw new Error("Publication visual review corpusCaseId is invalid");
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`Publication visual review ${label} must be a lowercase SHA-256 digest`);
  return value;
}

function reviewer(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_REVIEWER_LENGTH || value.trim() !== value || /[\u0000-\u001F\u007F]/.test(value) || hasUnpairedSurrogate(value)) throw new Error("Publication visual review reviewer is invalid");
  return value;
}

function reviewedAt(value: unknown): string {
  if (typeof value !== "string" || !UTC_MILLISECONDS.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error("Publication visual review reviewedAt must be a canonical ISO UTC timestamp");
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Publication visual review ${label} must be boolean`);
  return value;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (following < 0xdc00 || following > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}
