import { z } from "zod";
import { parseEvidenceBundle, type EvidenceBundle, type EvidenceFact, type EvidenceKind, type EvidenceSource, type ProposedUnresolved } from "./evidence-bundle.js";
import type { AgentTaskIntent } from "./agent-intent.js";

export interface AnalysisProposal {
  provider: "local-deterministic" | "openai-responses";
  responseText: string;
  summary: string;
  overallConfidence: number;
  taskIntentSuggestion: Partial<AgentTaskIntent>;
  evidence: EvidenceFact[];
  networkCandidate: unknown;
  unresolved: ProposedUnresolved[];
  figureIntentSuggestion: Record<string, unknown>;
  warnings: string[];
}

const unsafeTextPatterns = [
  /<\/?(?:svg|xml|visio|shape|connects?)\b|<\?xml|<!doctype\b/i,
  /\bdata:[^\s,]+(?:;base64)?[,:]|\bbase64(?:\s+payload)?\s*[:=,]/i,
  /-----BEGIN[^\r\n-]*(?:PRIVATE KEY|CERTIFICATE)-----|\b(?:api[_-]?key|access[_-]?token|secret[_-]?key|password)\b\s*[:=]/i,
  /\b(?:bearer\s+[a-z0-9._-]{8,}|(?:sk|pk|ghp|github_pat|xox[bp]|AIza|AKIA)[-_]?[a-z0-9_-]{6,})\b/i,
  /\b(?:visio\s+com|visio\.application|createobject\s*\(|comobject|vba|sub\s+\w+|end\s+sub|shell(?:command)?\s*[:=(]|powershell|cmd(?:\.exe)?\s*[/\\-]|bash\s+-c|sh\s+-c|os\.system|subprocess\.(?:run|popen)|python\s+-[cm]|import\s+(?:os|subprocess)|from\s+(?:os|subprocess)\s+import|javascript:|eval\s*\(|process\.env|document\.)\b/i,
  /\b(?:moveto|lineto|bezier(?:to)?|addshape|addconnector|connector|beginx|endx)\s*\(/i,
  /\b(?:primitive(?:ids?|\s*ids?)|(?:output|render)\s*path|geometry|coordinates?)\s*[:=]\s*(?:\[|\{|["']|[-+]?\d)/i,
  /\b(?:x|y|width|height)\s*[:=]\s*[-+]?\d+(?:\.\d+)?\b/i,
  /(?:^[A-Za-z]:[\\/]|(?:^|\s)\/(?:[^\s/]+\/)*[^\s]+\.(?:vsdx|svg|pdf|png|jpe?g|bmp)\b)/i,
];

function isSafeProviderText(value: string): boolean {
  return !unsafeTextPatterns.some((pattern) => pattern.test(value));
}

const safeText = (max: number) => z.string().trim().min(1).max(max).refine(isSafeProviderText, {
  message: "text contains a forbidden transport, credential, execution, output-path, or geometry payload",
});
const safeNullableText = (max: number) => safeText(max).nullable();
const safeId = (max = 128) => safeText(max);
const boundedIds = (maxItems: number, maxText = 128) => z.array(safeId(maxText)).max(maxItems);
const evidenceKindSchema = z.enum(["text", "code", "model", "image"]);
const confidenceSchema = z.number().finite().min(0).max(1);

const candidateEvidenceSchema = z.object({
  type: evidenceKindSchema,
  value: safeText(256),
  locator: safeNullableText(256),
  excerpt: safeNullableText(512),
}).strict();

const evidenceFactSchema = z.object({
  id: safeId(),
  subject: safeText(128),
  predicate: safeText(128),
  value: z.union([safeText(512), z.number().finite(), z.boolean(), z.array(safeText(128)).max(32), z.null()]),
  confidence: confidenceSchema,
  source: z.object({
    sourceId: safeId(),
    kind: evidenceKindSchema,
    locator: safeNullableText(256),
    excerpt: safeNullableText(512),
  }).strict(),
}).strict();

const unresolvedSchema = z.object({
  id: safeId(),
  question: safeText(512),
  severity: z.enum(["blocking", "warning"]),
  candidateValues: z.array(safeText(256)).max(8),
  evidenceIds: boundedIds(256),
}).strict();

const tensorSchema = z.object({
  id: safeId(),
  name: safeText(256),
  shape: z.array(z.union([z.number().int().min(-1).max(1_000_000), safeText(64)])).max(8).default([]),
  axes: boundedIds(8, 64).default([]),
  semanticRole: z.enum(["input", "activation", "output", "logits", "state", "unknown"]).optional(),
  dtype: safeNullableText(64).optional().default(null),
  producerNodeId: safeNullableText(128).optional().default(null),
  consumerNodeIds: boundedIds(128).default([]),
}).strict();

const candidateNodeSchema = z.object({
  id: safeId(),
  kind: safeText(64).optional(),
  op: safeText(64).optional(),
  label: safeText(256).optional(),
  subtitle: safeNullableText(256).optional(),
  stage: z.number().int().min(0).max(256).optional(),
  tensor: z.object({
    shape: z.array(z.union([z.number().int().min(-1).max(1_000_000), safeText(64)])).max(8),
    dtype: safeNullableText(64),
  }).strict().nullable().optional(),
  inputTensorIds: boundedIds(64).optional(),
  outputTensorIds: boundedIds(64).optional(),
  confidence: confidenceSchema.nullable().optional(),
  sourceEvidence: z.array(candidateEvidenceSchema).max(32).optional(),
  sourceEvidenceIds: boundedIds(256).optional(),
  repeats: z.object({ count: z.number().int().positive().max(256), unitNodeIds: boundedIds(64).min(1) }).strict().nullable().optional(),
}).strict().superRefine((node, context) => {
  if (!node.kind && !node.op) context.addIssue({ code: z.ZodIssueCode.custom, message: "node requires kind or op" });
});

const candidateEdgeSchema = z.object({
  source: safeId().optional(),
  target: safeId().optional(),
  sourceNodeId: safeId().optional(),
  targetNodeId: safeId().optional(),
  kind: safeText(64).optional(),
  relation: safeText(64).optional(),
  label: safeNullableText(256).optional(),
  skip: z.boolean().optional(),
  confidence: confidenceSchema.nullable().optional(),
  sourceEvidence: z.array(candidateEvidenceSchema).max(32).optional(),
  tensorIds: boundedIds(64).optional(),
  evidenceIds: boundedIds(256).optional(),
}).strict().superRefine((edge, context) => {
  if (!((edge.source && edge.target) || (edge.sourceNodeId && edge.targetNodeId))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "edge requires a source/target pair" });
  }
  if (!edge.kind && !edge.relation) context.addIssue({ code: z.ZodIssueCode.custom, message: "edge requires kind or relation" });
});

const candidateGroupSchema = z.object({
  id: safeId(),
  label: safeText(256),
  nodeIds: boundedIds(128),
  confidence: confidenceSchema.nullable().optional(),
  sourceEvidence: z.array(candidateEvidenceSchema).max(32).optional(),
  sourceEvidenceIds: boundedIds(256).optional(),
}).strict();

const networkCandidateSchema = z.object({
  figure: z.object({ id: safeId(), title: safeText(256), description: safeNullableText(512) }).strict(),
  tensors: z.array(tensorSchema).max(128).default([]),
  nodes: z.array(candidateNodeSchema).min(1).max(128),
  edges: z.array(candidateEdgeSchema).max(256).default([]),
  groups: z.array(candidateGroupSchema).max(64).default([]),
}).strict();

const taskIntentSuggestionSchema = z.object({
  action: z.enum(["analyze_network", "create_figure", "revise_figure", "explain_structure", "render_to_visio", "export_preview"]).optional(),
  sourceMode: z.enum(["text", "code", "model", "sketch", "reference_image", "mixed"]).optional(),
  requestedArtifact: z.enum(["structure_only", "paper_overview", "architecture_detail", "module_detail", "visio_document"]).optional(),
  referencesDraftId: z.null().optional(),
  userConstraints: z.object({
    orientation: z.enum(["auto", "landscape", "portrait"]).optional(),
    density: z.enum(["compact", "standard", "detailed"]).optional(),
    printMode: z.enum(["auto", "color", "grayscale"]).optional(),
    requiresNativeVisio: z.boolean().optional(),
  }).strict().optional(),
}).strict();

const figureIntentSuggestionSchema = z.object({
  purpose: safeText(256).optional(),
  density: z.enum(["compact", "standard", "detailed"]).optional(),
  orientation: z.enum(["auto", "landscape", "portrait"]).optional(),
  printMode: z.enum(["auto", "color", "grayscale"]).optional(),
  emphasis: z.array(safeText(128)).max(8).optional(),
}).strict();

const analysisProposalSchema = z.object({
  provider: z.enum(["local-deterministic", "openai-responses"]),
  responseText: safeText(4000),
  summary: safeText(1200),
  overallConfidence: confidenceSchema,
  taskIntentSuggestion: taskIntentSuggestionSchema,
  evidence: z.array(evidenceFactSchema).max(256),
  networkCandidate: networkCandidateSchema,
  unresolved: z.array(unresolvedSchema).max(16),
  figureIntentSuggestion: figureIntentSuggestionSchema,
  warnings: z.array(safeText(512)).max(16),
}).strict();

export function parseAnalysisProposal(input: unknown): AnalysisProposal {
  return analysisProposalSchema.parse(input) as AnalysisProposal;
}

export function proposalEvidenceBundle(proposal: AnalysisProposal, sources: EvidenceSource[]): EvidenceBundle {
  const parsedProposal = parseAnalysisProposal(proposal);
  return parseEvidenceBundle({
    version: 1,
    sources,
    facts: parsedProposal.evidence,
    unresolved: parsedProposal.unresolved,
  });
}
