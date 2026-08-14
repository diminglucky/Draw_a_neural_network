import { z } from "zod";
import type { AgentTaskIntent } from "./agent-intent.js";
import { ApiErrorCode, FoundationError, type FigureDraftStatus } from "./domain.js";
import {
  parseEvidenceBundle,
  publicEvidenceSummary,
  type EvidenceBundle,
  type EvidenceFact,
  type EvidenceKind,
} from "./evidence-bundle.js";
import { parseCanonicalNetworkIR, type CanonicalNetworkIR } from "./network-ir-v2.js";

export interface FigureDraftBlockingQuestion {
  id: string;
  question: string;
  candidateValues: string[];
}

export interface FigureDraftResolvedConfirmation {
  questionId: string;
  value: string;
}

export interface FigureDraftRevisionPayload {
  taskIntent: AgentTaskIntent;
  evidence: ReturnType<typeof publicEvidenceSummary>;
  canonicalNetworkIR: CanonicalNetworkIR;
  blockingQuestions: FigureDraftBlockingQuestion[];
  resolvedConfirmations: FigureDraftResolvedConfirmation[];
  warnings: string[];
  readyForVisio: false;
}

export interface FigureDraftPayloadParseOptions {
  statusCode?: number;
}

const boundedText = (max: number) => z.string().max(max);
const identifier = z.string().trim().min(1).max(128);
const evidenceKindSchema = z.enum(["text", "code", "model", "image"]);
const evidenceValueSchema = z.union([
  boundedText(512),
  z.number().finite(),
  z.boolean(),
  z.array(boundedText(128)).max(32),
  z.null(),
]);

const taskIntentSchema = z.object({
  action: z.enum(["analyze_network", "create_figure", "revise_figure", "explain_structure", "render_to_visio", "export_preview"]),
  sourceMode: z.enum(["text", "code", "model", "sketch", "reference_image", "mixed"]),
  requestedArtifact: z.enum(["structure_only", "paper_overview", "architecture_detail", "module_detail", "visio_document"]),
  referencesDraftId: identifier.nullable(),
  userConstraints: z.object({
    orientation: z.enum(["auto", "landscape", "portrait"]),
    density: z.enum(["compact", "standard", "detailed"]),
    printMode: z.enum(["auto", "color", "grayscale"]),
    requiresNativeVisio: z.boolean(),
  }).strict(),
}).strict();

const publicEvidenceSchema = z.object({
  id: identifier,
  subject: boundedText(128),
  predicate: boundedText(128),
  value: evidenceValueSchema,
  confidence: z.number().finite().min(0).max(1),
  source: z.object({
    sourceId: identifier,
    kind: evidenceKindSchema,
    name: boundedText(256),
  }).strict(),
}).strict();

const blockingQuestionSchema = z.object({
  id: identifier,
  question: boundedText(512),
  candidateValues: z.array(boundedText(256)).min(2).max(8),
}).strict().superRefine((question, context) => {
  if (new Set(question.candidateValues).size !== question.candidateValues.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "candidate values must be unique", path: ["candidateValues"] });
  }
});

const resolvedConfirmationSchema = z.object({
  questionId: identifier,
  value: boundedText(256),
}).strict();

const payloadSchema = z.object({
  taskIntent: taskIntentSchema,
  evidence: z.array(publicEvidenceSchema).max(256),
  canonicalNetworkIR: z.unknown(),
  blockingQuestions: z.array(blockingQuestionSchema).max(1),
  resolvedConfirmations: z.array(resolvedConfirmationSchema).max(1).default([]),
  warnings: z.array(boundedText(512)).max(128),
  readyForVisio: z.literal(false),
}).strict().superRefine((payload, context) => {
  if (payload.blockingQuestions.length > 0 && payload.resolvedConfirmations.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "a payload cannot contain both a blocking question and a resolved confirmation",
      path: ["resolvedConfirmations"],
    });
  }
});

const forbiddenKeys = new Set([
  "apikey",
  "providerapikey",
  "authorization",
  "headers",
  "requestheaders",
  "rawattachmentbytes",
  "attachmentbytes",
  "attachments",
  "locator",
  "excerpt",
  "figureplan",
  "publicationfigureplan",
  "coordinates",
  "coordinate",
  "primitives",
  "primitiveid",
  "primitiveids",
  "outputpath",
  "visiocommand",
  "visiocommands",
  "comcommand",
  "workercommand",
  "shellcommand",
  "pythoncommand",
  "providerresponse",
]);

const forbiddenStringPatterns = [
  /\b(?:api[_-]?key|provider[_-]?api[_-]?key|authorization|access[_-]?token)\b\s*[:=]/i,
  /\bbearer\s+[a-z0-9._~+\/-]{8,}/i,
  /\b(?:sk|pk|ghp|github_pat|xox[bp]|AIza|AKIA)[-_]?[a-z0-9_-]{6,}\b/i,
  /\bdata:[^\s,]+(?:;base64)?[,:]/i,
  /\bbase64(?:\s+payload)?\s*[:=,]/i,
  /-----BEGIN[^\r\n-]*PRIVATE KEY-----/i,
  /(?:<\/?(?:svg|xml|shape|connects?)\b|<\?xml|<!doctype\b)[^>]*>/i,
  /\b(?:createobject\s*\(\s*["']visio\.application|visio\.application|visio\s+com|comobject|vba|addshape\s*\(|addconnector\s*\(|shell\s*\(|powershell|cmd(?:\.exe)?\s*[/\\-]|bash\s+-c|sh\s+-c|os\.system|subprocess\.(?:run|popen))\b/i,
  /(?:[a-z]:[\\/]|\\\\)[^\r\n]{0,512}\.vsdx\b/i,
];

export function parseFigureDraftRevisionPayload(
  input: unknown,
  options: FigureDraftPayloadParseOptions = {},
): FigureDraftRevisionPayload {
  const statusCode = options.statusCode ?? 400;
  try {
    assertNoForbiddenContent(input);
    const parsed = payloadSchema.parse(input);
    const evidenceBundle = publicEvidenceBundle(parsed.evidence);
    const evidence = publicEvidenceSummary(evidenceBundle);
    const canonicalNetworkIR = parseCanonicalNetworkIR(parsed.canonicalNetworkIR, evidenceBundle);
    return {
      taskIntent: parsed.taskIntent as AgentTaskIntent,
      evidence,
      canonicalNetworkIR,
      blockingQuestions: parsed.blockingQuestions,
      resolvedConfirmations: parsed.resolvedConfirmations,
      warnings: parsed.warnings,
      readyForVisio: false,
    };
  } catch {
    throw invalidPayload(statusCode);
  }
}

export function assertFigureDraftPayloadStatus(
  payload: FigureDraftRevisionPayload,
  status: FigureDraftStatus,
  statusCode = 400,
): void {
  if (status !== "needs_confirmation" && status !== "ready_for_preview" && status !== "failed") {
    throw invalidPayload(statusCode);
  }
  const valid = status === "failed"
    || (status === "needs_confirmation"
      ? payload.blockingQuestions.length === 1 && payload.resolvedConfirmations.length === 0
      : payload.blockingQuestions.length === 0);
  if (!valid) throw invalidPayload(statusCode);
}

export function parseFigureDraftConfirmation(input: unknown): FigureDraftResolvedConfirmation {
  try {
    assertNoForbiddenContent(input);
    return resolvedConfirmationSchema.parse(input);
  } catch {
    throw invalidPayload(400);
  }
}

function publicEvidenceBundle(evidence: Array<{
  id: string;
  subject: string;
  predicate: string;
  value: EvidenceFact["value"];
  confidence: number;
  source: { sourceId: string; kind: EvidenceKind; name: string };
}>): EvidenceBundle {
  const sources = new Map<string, { id: string; kind: EvidenceKind; name: string }>();
  const facts = evidence.map((fact) => {
    const current = sources.get(fact.source.sourceId);
    if (current && (current.kind !== fact.source.kind || current.name !== fact.source.name)) {
      throw new Error("inconsistent public evidence source metadata");
    }
    sources.set(fact.source.sourceId, {
      id: fact.source.sourceId,
      kind: fact.source.kind,
      name: fact.source.name,
    });
    return {
      id: fact.id,
      subject: fact.subject,
      predicate: fact.predicate,
      value: fact.value,
      confidence: fact.confidence,
      source: {
        sourceId: fact.source.sourceId,
        kind: fact.source.kind,
        locator: null,
        excerpt: null,
      },
    };
  });
  return parseEvidenceBundle({ version: 1, sources: [...sources.values()], facts, unresolved: [] });
}

function assertNoForbiddenContent(input: unknown): void {
  const seen = new WeakSet<object>();
  let visited = 0;
  let totalStringLength = 0;
  const visit = (value: unknown): void => {
    visited += 1;
    if (visited > 20_000) throw new Error("payload is too large");
    if (typeof value === "string") {
      totalStringLength += value.length;
      if (totalStringLength > 1_000_000) throw new Error("payload is too large");
      if (forbiddenStringPatterns.some((pattern) => pattern.test(value))) {
        throw new Error("payload contains forbidden content");
      }
      return;
    }
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) throw new Error("payload must be acyclic");
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (forbiddenKeys.has(normalizedKey)) throw new Error("payload contains a forbidden field");
      visit(item);
    }
  };
  visit(input);
}

function invalidPayload(statusCode: number): FoundationError {
  return new FoundationError(
    ApiErrorCode.VALIDATION_FAILED,
    "Figure draft revision payload is invalid or contains forbidden data",
    statusCode,
  );
}
