import { z } from "zod";

export type EvidenceKind = "text" | "code" | "model" | "image";

export interface EvidenceSource {
  id: string;
  kind: EvidenceKind;
  name: string;
}

export interface EvidenceFact {
  id: string;
  subject: string;
  predicate: string;
  value: string | number | boolean | string[] | null;
  confidence: number;
  source: {
    sourceId: string;
    kind: EvidenceKind;
    locator: string | null;
    excerpt: string | null;
  };
}

export interface ProposedUnresolved {
  id: string;
  question: string;
  severity: "blocking" | "warning";
  candidateValues: string[];
  evidenceIds: string[];
}

export interface EvidenceBundle {
  version: 1;
  sources: EvidenceSource[];
  facts: EvidenceFact[];
  unresolved: ProposedUnresolved[];
}

const evidenceKindSchema = z.enum(["text", "code", "model", "image"]);
const boundedText = (max: number) => z.string().max(max);

const forbiddenFactValuePatterns = [
  /\bdata:[^\s,]+(?:;base64)?[,:]/i,
  /\bbase64(?:\s+payload)?\s*[:=,]/i,
  /-----BEGIN[^\r\n-]*PRIVATE KEY-----/i,
  /-----BEGIN[^\r\n-]*PRIVATE KEY-----/i,
  /["']?\b(?:api[_-]?key|access[_-]?token)\b["']?\s*[:=]/i,
  /\b(?:bearer\s+[a-z0-9._-]{8,}|(?:sk|pk|ghp|github_pat|xox[bp]|AIza|AKIA)[-_]?[a-z0-9_-]{6,})\b/i,
  /(?:<\/?(?:svg|xml|visio|shape|connects?)\b|<\?xml|<!doctype\b)[^>]*>/i,
  /\b(?:visio\s+com|visio\.application|createobject\s*\(\s*["']visio|comobject|vba|sub\s+\w+|end\s+sub|shell\s*\(|powershell|cmd(?:\.exe)?\s*[/\\-]|bash\s+-c|sh\s+-c|os\.system|subprocess\.(?:run|popen)|python\s+-[cm]|import\s+(?:os|subprocess)|from\s+(?:os|subprocess)\s+import|javascript:|eval\s*\(|process\.env|document\.)\b/i,
  /\b(?:moveto|lineto|bezier(?:to)?|addshape|addconnector|connector|beginx|endx)\s*\(/i,
];

function containsForbiddenFactValue(value: string): boolean {
  return forbiddenFactValuePatterns.some((pattern) => pattern.test(value));
}

const factScalarStringSchema = z.string().max(512).refine((value) => !containsForbiddenFactValue(value), {
  message: "fact value contains a forbidden transport, credential, or desktop-render payload",
});

const factArrayStringSchema = z.string().max(128).refine((value) => !containsForbiddenFactValue(value), {
  message: "fact value contains a forbidden transport, credential, or desktop-render payload",
});

const sourceSchema = z.object({
  id: boundedText(128),
  kind: evidenceKindSchema,
  name: boundedText(256),
}).strict();

const factSchema = z.object({
  id: boundedText(128),
  subject: boundedText(128),
  predicate: boundedText(128),
  value: z.union([
    factScalarStringSchema,
    z.number().finite(),
    z.boolean(),
    z.array(factArrayStringSchema).max(32),
    z.null(),
  ]),
  confidence: z.number().finite().min(0).max(1),
  source: z.object({
    sourceId: boundedText(128),
    kind: evidenceKindSchema,
    locator: boundedText(256).nullable(),
    excerpt: boundedText(512).nullable(),
  }).strict(),
}).strict();

const unresolvedSchema = z.object({
  id: boundedText(128),
  question: boundedText(512),
  severity: z.enum(["blocking", "warning"]),
  candidateValues: z.array(boundedText(256)).max(8),
  evidenceIds: z.array(boundedText(128)).max(256),
}).strict().superRefine((unresolved, context) => {
  if (new Set(unresolved.candidateValues).size !== unresolved.candidateValues.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "candidate values must be unique", path: ["candidateValues"] });
  }
  if (unresolved.severity === "blocking" && (unresolved.candidateValues.length < 2 || unresolved.candidateValues.length > 8)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "blocking unresolved requires 2–8 candidate values", path: ["candidateValues"] });
  }
  if (new Set(unresolved.evidenceIds).size !== unresolved.evidenceIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "evidence IDs must be unique", path: ["evidenceIds"] });
  }
});

const evidenceBundleSchema = z.object({
  version: z.literal(1),
  sources: z.array(sourceSchema).max(6),
  facts: z.array(factSchema).max(256),
  unresolved: z.array(unresolvedSchema).max(16).default([]),
}).strict().superRefine((bundle, context) => {
  const sourceById = new Map<string, EvidenceSource>();
  for (const [index, source] of bundle.sources.entries()) {
    if (sourceById.has(source.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "source IDs must be unique", path: ["sources", index, "id"] });
    }
    sourceById.set(source.id, source as EvidenceSource);
  }

  const factIds = new Set<string>();
  for (const [index, fact] of bundle.facts.entries()) {
    if (factIds.has(fact.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "fact IDs must be unique", path: ["facts", index, "id"] });
    }
    factIds.add(fact.id);

    const source = sourceById.get(fact.source.sourceId);
    if (!source) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `unknown source: ${fact.source.sourceId}`, path: ["facts", index, "source", "sourceId"] });
    } else if (source.kind !== fact.source.kind) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "source kind must match", path: ["facts", index, "source", "kind"] });
    }
  }

  for (const [index, unresolved] of bundle.unresolved.entries()) {
    for (const [evidenceIndex, evidenceId] of unresolved.evidenceIds.entries()) {
      if (!factIds.has(evidenceId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `unknown evidence ID: ${evidenceId}`, path: ["unresolved", index, "evidenceIds", evidenceIndex] });
      }
    }
  }
});

export function parseEvidenceBundle(input: unknown): EvidenceBundle {
  return evidenceBundleSchema.parse(input) as EvidenceBundle;
}

export function publicEvidenceSummary(bundle: EvidenceBundle): Array<{
  id: string;
  subject: string;
  predicate: string;
  value: EvidenceFact["value"];
  confidence: number;
  source: { sourceId: string; kind: EvidenceKind; name: string };
}> {
  const validatedBundle = parseEvidenceBundle(bundle);
  const sources = new Map(validatedBundle.sources.map((source) => [source.id, source]));
  return validatedBundle.facts.map((fact) => {
    const source = sources.get(fact.source.sourceId);
    if (!source) throw new Error(`unknown source: ${fact.source.sourceId}`);
    return {
      id: fact.id,
      subject: fact.subject,
      predicate: fact.predicate,
      value: fact.value,
      confidence: fact.confidence,
      source: { sourceId: source.id, kind: source.kind, name: source.name },
    };
  });
}
