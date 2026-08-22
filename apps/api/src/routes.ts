import { createHash, createHmac, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApiErrorCode, FoundationError, type FigureDraft, type FigureDraftRevision, type User } from "./domain.js";
import { AdminService } from "./admin-service.js";
import { JobService } from "./job-service.js";
import { SessionService } from "./session-service.js";
import { signAccessToken, verifyAccessToken, verifyPassword } from "./security.js";
import type { FoundationStore } from "./store.js";
import type { AgentDraftOutput, VisioExecutor } from "./adapters.js";
import type { VisioJobRunner } from "./visio-job-runner.js";
import { parseCanvasSnapshot, type CanvasSnapshot } from "./agent-actions.js";
import { parseCanonicalNetworkIR, type CanonicalNetworkIR } from "./network-ir-v2.js";
import type { AgentTaskIntent } from "./agent-intent.js";
import { parseEvidenceBundle, publicEvidenceSummary, type EvidenceBundle, type EvidenceKind } from "./evidence-bundle.js";
import { FigureDraftService, type FigureDraftConfirmation } from "./figure-draft-service.js";
import { FigureDraftPreviewService } from "./figure-draft-preview-service.js";
import { parseFigureDraftRevisionPayload } from "./figure-draft-payload.js";
import { PublicationVisualPreviewService } from "./publication-visual-preview-service.js";
import { AgentVisioExecutionSnapshotService } from "./agent-visio-execution-snapshot.js";
import { UniversalFigureExportService } from "./figure-export-service.js";
import { FigureAnalysisService } from "./figure-analysis-service.js";
import { parsePyTorchSourcePack, type SourcePack } from "./source-pack.js";
import { publicFigureAnalysis, type FigureAnalysisRecord } from "./figure-analysis.js";
import { FigureAnalysisPreviewServiceImpl, type FigureAnalysisPreviewResponse } from "./figure-analysis-preview-service.js";
import { compileUniversalInputToPublicationPreview, type LegacyUniversalPreviewInput } from "./universal-input-compilation-service.js";
import { projectPublicationVisualPlanPreview, type PublicationVisualPlanPreview } from "./publication-visual-plan-preview.js";

const MAX_CONVERSATION_ID_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 12_000;
const MAX_ATTACHMENTS = 6;
const MAX_CODE_CHARACTERS = 200_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_UNIVERSAL_PREVIEW_SOURCE_BYTES = 200_000;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_PROVIDER_API_KEY_LENGTH = 512;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const AGENT_USAGE_METRIC = "agentChatRequests" as const;
const TRUSTED_AGENT_PROVIDERS = new Set<AgentDraftOutput["provider"]>([
  "local-deterministic",
  "openai-responses",
]);

const CODE_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-python",
  "application/json",
  "application/x-ipynb+json",
]);

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface AgentAttachmentInput {
  name: string;
  mimeType: string;
  data: string;
  kind: "code" | "image";
}

export interface AgentChatInput {
  userId: string;
  conversationId: string;
  message: string;
  attachments: AgentAttachmentInput[];
  canvas?: CanvasSnapshot;
  providerApiKey?: string;
}

export interface AgentChatResult {
  conversationId?: string;
  status: string;
  stages: unknown[];
  response: unknown;
  networkIR?: unknown;
  diagram?: unknown;
  diagramIntent?: "replace" | "modify" | "explain";
  actions?: unknown;
  figureAnalysis?: unknown;
}

export interface AgentServiceContract {
  chat(input: AgentChatInput): Promise<AgentChatResult>;
}

interface RouteOptions {
  store: FoundationStore;
  sessionService: SessionService;
  jobService: JobService;
  adminService: AdminService;
  sessionSecret: string;
  admin: { email: string; passwordHash: string };
  agentService?: AgentServiceContract;
  figureDraftService: FigureDraftService;
  figureDraftPreviewService: FigureDraftPreviewService;
  agentVisioExecutionSnapshotService: AgentVisioExecutionSnapshotService;
  visioExecutor: VisioExecutor;
  visioJobRunner: VisioJobRunner;
  universalFigureExportService?: UniversalFigureExportService;
  universalFigureExportRunner?: { submit(jobId: string): void | Promise<void>; cancel?(jobId: string): Promise<unknown> };
  figureAnalysisService: FigureAnalysisService;
  figureAnalysisPreviewService: FigureAnalysisPreviewServiceImpl;
}

function body(request: FastifyRequest): Record<string, any> {
  return (request.body ?? {}) as Record<string, any>;
}

function bearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new FoundationError(ApiErrorCode.INVALID_TOKEN, "Authorization is required", 401);
  return header.slice("Bearer ".length);
}

async function requireUser(request: FastifyRequest, options: RouteOptions) {
  return options.sessionService.getCurrentAccess(bearer(request));
}

async function requireAdmin(request: FastifyRequest, options: RouteOptions) {
  try {
    const claims = await verifyAccessToken(bearer(request), options.sessionSecret);
    if (!claims.roles.includes("admin")) throw new Error("admin role required");
    return claims;
  } catch {
    throw new FoundationError(ApiErrorCode.FORBIDDEN, "Administrator access is required", 403);
  }
}

function publicUser(user: User) {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

function validationError(message: string, details: Record<string, unknown>): FoundationError {
  return new FoundationError(ApiErrorCode.VALIDATION_FAILED, message, 400, details);
}

function idempotencyKey(request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || !value.trim()) {
    throw validationError("Idempotency-Key is required", { field: "Idempotency-Key", reason: "required" });
  }
  const key = value.trim();
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw validationError("Idempotency-Key exceeds the maximum length", { field: "Idempotency-Key", reason: "limit_exceeded", max: MAX_IDEMPOTENCY_KEY_LENGTH });
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw validationError("Idempotency-Key contains unsupported characters", { field: "Idempotency-Key", reason: "invalid_characters" });
  }
  return key;
}

function universalFigureVersion(request: FastifyRequest): void {
  const value = request.headers["accept-figure-version"];
  if (value !== "3") {
    throw validationError("Accept-Figure-Version: 3 is required for universal figure export", {
      field: "Accept-Figure-Version",
      reason: "unsupported_version",
      supported: [3],
    });
  }
}

function figureAnalysisVersion(request: FastifyRequest): void {
  if (request.headers["accept-figure-version"] !== "3") {
    throw validationError("Accept-Figure-Version: 3 is required for figure analysis", {
      field: "Accept-Figure-Version",
      reason: "unsupported_version",
      supported: [3],
    });
  }
}

function universalPreviewVersion(request: FastifyRequest): void {
  if (request.headers["accept-figure-version"] !== "4") {
    throw validationError("Accept-Figure-Version: 4 is required for universal figure preview", {
      field: "Accept-Figure-Version",
      reason: "unsupported_version",
      supported: [4],
    });
  }
}

function parseUniversalPreviewBody(request: FastifyRequest): {
  input: LegacyUniversalPreviewInput;
  detail: "overview" | "architecture" | "operator_detail";
} {
  const input = body(request);
  assertOnlyKeys(input, ["input", "detail"], "universal figure preview");
  const detail = input.detail === undefined ? "architecture" : input.detail;
  if (detail !== "overview" && detail !== "architecture" && detail !== "operator_detail") {
    throw validationError("detail is invalid", { field: "detail", reason: "invalid_value" });
  }

  const source = objectField(input.input, "input");
  const kind = requiredStringField(source.kind, "input.kind");
  if (kind === "typed-prompt") {
    assertOnlyKeys(source, ["kind", "sourceId", "prompt", "revision"], "input");
    const sourceId = requiredIdentifierField(source.sourceId, "input.sourceId");
    const prompt = boundedRawSourceField(source.prompt, "input.prompt");
    const revisionValue = source.revision;
    if (revisionValue !== undefined && (typeof revisionValue !== "number" || !Number.isSafeInteger(revisionValue) || revisionValue < 1)) {
      throw validationError("input.revision must be a positive integer", { field: "input.revision", reason: "invalid_value" });
    }
    const revision = revisionValue as number | undefined;
    return { input: { kind, sourceId, prompt, ...(revision === undefined ? {} : { revision }) }, detail };
  }

  if (kind === "static-pytorch") {
    assertOnlyKeys(source, ["kind", "sourceId", "sourceSha256", "code"], "input");
    const sourceId = requiredIdentifierField(source.sourceId, "input.sourceId");
    const sourceSha256 = requiredSha256Field(source.sourceSha256, "input.sourceSha256");
    const code = boundedRawSourceField(source.code, "input.code");
    const actualSha256 = createHash("sha256").update(code, "utf8").digest("hex");
    if (actualSha256 !== sourceSha256) {
      throw validationError("input.sourceSha256 does not match input.code", { field: "input.sourceSha256", reason: "digest_mismatch" });
    }
    return { input: { kind, sourceId, sourceSha256, code }, detail };
  }

  throw validationError("input.kind is not supported", { field: "input.kind", reason: "unsupported_value" });
}

function universalPreviewUpdateIdentity(
  serverSecret: string,
  userId: string,
  deviceId: string,
  input: LegacyUniversalPreviewInput,
  detail: "overview" | "architecture" | "operator_detail",
) {
  const fingerprint = input.kind === "typed-prompt"
    ? { kind: input.kind, sourceId: input.sourceId, sourceHash: createHash("sha256").update(input.prompt, "utf8").digest("hex"), revision: input.revision ?? 1, detail }
    : { kind: input.kind, sourceId: input.sourceId, sourceHash: input.sourceSha256, detail };
  const key = universalPreviewOpaqueKey(serverSecret, "update-identity", { userId, deviceId, ...fingerprint });
  return {
    ownerId: userId,
    deviceId,
    workflowId: `universal-preview-${key}`,
    documentId: `preview-${key}`,
    pageId: "pvp-preview",
    expectedRevision: input.kind === "typed-prompt" ? input.revision ?? 1 : 1,
  };
}

function serverBoundUniversalPreviewInput(serverSecret: string, userId: string, deviceId: string, input: LegacyUniversalPreviewInput): LegacyUniversalPreviewInput {
  const sourceHash = input.kind === "typed-prompt"
    ? createHash("sha256").update(input.prompt, "utf8").digest("hex")
    : input.sourceSha256;
  const sourceId = `preview-source-${universalPreviewOpaqueKey(serverSecret, "compile-source", { userId, deviceId, kind: input.kind, sourceId: input.sourceId, sourceHash })}`;
  return input.kind === "typed-prompt"
    ? { ...input, sourceId }
    : { ...input, sourceId };
}

function universalPreviewOpaqueKey(serverSecret: string, domain: string, value: Record<string, unknown>): string {
  return createHmac("sha256", serverSecret).update(`${domain}\n${JSON.stringify(value)}`, "utf8").digest("hex").slice(0, 48);
}

async function auditUniversalPreview(
  store: FoundationStore,
  userId: string,
  inputKind: LegacyUniversalPreviewInput["kind"],
  preview: PublicationVisualPlanPreview,
): Promise<void> {
  await store.createAuditRecord({
    id: randomUUID(),
    actorType: "user",
    actorId: userId,
    action: "universal-figure.preview.read",
    targetType: "universal-figure-preview",
    targetId: preview.plan.identity.canonicalHash,
    reason: null,
    metadata: {
      version: 4,
      inputKind,
      kind: preview.kind,
      exportEligible: preview.exportEligible,
      planId: preview.plan.identity.planId,
      planHash: preview.plan.identity.canonicalHash,
    },
    createdAt: new Date().toISOString(),
  });
}

function parseFigureAnalysisBody(request: FastifyRequest): Record<string, unknown> {
  const input = body(request);
  const allowed = new Set(["source"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw validationError("Figure analysis accepts only a source descriptor", { field: key, reason: "forbidden" });
  }
  const source = record(input.source);
  if (!source) throw validationError("source is required", { field: "source", reason: "required" });
  return source;
}

function figureAnalysisRequestHash(source: SourcePack): string {
  return createHash("sha256").update(JSON.stringify({
    kind: source.kind,
    sourceId: source.sourceId,
    name: source.name,
    mimeType: source.mimeType,
    sourceSha256: source.sourceSha256.toLowerCase(),
    bytes: source.bytes,
  })).digest("hex");
}

async function auditFigureAnalysis(
  store: FoundationStore,
  userId: string,
  record: FigureAnalysisRecord,
  duplicate: boolean,
): Promise<void> {
  await store.createAuditRecord({
    id: randomUUID(),
    actorType: "user",
    actorId: userId,
    action: "figure.analysis.completed",
    targetType: "figure-analysis",
    targetId: record.id,
    reason: null,
    metadata: {
      analysisId: record.id,
      sourceSha256: record.sourceSha256,
      sourceBytes: record.sourceBytes,
      capabilityVersion: record.capabilityVersion,
      status: record.status,
      blockingQuestionCode: record.blockingQuestion?.code ?? null,
      unresolvedCount: record.unresolved.length,
      duplicate,
    },
    createdAt: new Date().toISOString(),
  });
}

async function auditFigureAnalysisPreview(
  store: FoundationStore,
  userId: string,
  preview: FigureAnalysisPreviewResponse,
): Promise<void> {
  const metadata = preview.kind === "candidate_structure"
    ? {
      analysisId: preview.analysis.id,
      kind: preview.kind,
      capabilityVersion: preview.analysis.capabilityVersion,
      version: preview.version,
      confirmedNodeCount: preview.confirmedNodeIds.length,
      componentCount: 0,
      connectionCount: 0,
      qaStatus: null,
    }
    : {
      analysisId: preview.analysis.id,
      kind: preview.kind,
      capabilityVersion: preview.analysis.capabilityVersion,
      version: preview.version,
      confirmedNodeCount: 0,
      componentCount: preview.publicationPlan.components.length,
      connectionCount: preview.publicationPlan.connections.length,
      qaStatus: preview.visualQa.status,
    };
  await store.createAuditRecord({
    id: randomUUID(),
    actorType: "user",
    actorId: userId,
    action: "figure.analysis.preview.read",
    targetType: "figure-analysis",
    targetId: preview.analysis.id,
    reason: null,
    metadata,
    createdAt: new Date().toISOString(),
  });
}

function parseUniversalFigureExportBody(request: FastifyRequest): { confirmationToken: string; idempotencyKey: string } {
  const input = body(request);
  const allowed = new Set(["confirmationToken", "idempotencyKey"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw validationError("Universal figure export accepts only a confirmation token and idempotency key", {
        field: key,
        reason: "forbidden",
      });
    }
  }
  if (typeof input.confirmationToken !== "string" || !input.confirmationToken.trim()) {
    throw validationError("confirmationToken is required", { field: "confirmationToken", reason: "required" });
  }
  if (typeof input.idempotencyKey !== "string" || !input.idempotencyKey.trim()) {
    throw validationError("idempotencyKey is required", { field: "idempotencyKey", reason: "required" });
  }
  const key = input.idempotencyKey.trim();
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw validationError("idempotencyKey is invalid", { field: "idempotencyKey", reason: "invalid" });
  }
  return { confirmationToken: input.confirmationToken.trim(), idempotencyKey: key };
}

function universalOwner(userId: string): { tenantId: string; userId: string } {
  return { tenantId: `tenant-${userId}`, userId };
}

function publicUniversalFigureExportJob(job: Extract<import("./domain.js").Job, { type: "universal-figure-export" }> | import("./domain.js").Job) {
  const base = {
    id: job.id,
    type: job.type,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    pollUrl: `/api/jobs/${job.id}`,
  };
  if (job.status === "succeeded") {
    const output = publicUniversalOutput(job.output);
    return output ? { ...base, ...output } : { ...base, status: "failed", error: { code: ApiErrorCode.VISIO_EXECUTION_FAILED, message: "Universal figure export result was invalid" } };
  }
  if (job.status === "failed" || job.status === "expired") {
    return { ...base, error: { code: ApiErrorCode.VISIO_EXECUTION_FAILED, message: "Universal figure export did not complete" } };
  }
  return base;
}

function publicUniversalOutput(value: unknown): { artifacts: Array<{ format: "vsdx" | "pdf" | "png"; sha256: string; bytes: number }>; readback: { valid: true; shapeCount: number; connectorCount: number }; rendererQa: Record<string, { passed: boolean }> } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const output = value as Record<string, unknown>;
  if (!Array.isArray(output.artifacts) || !output.readback || typeof output.readback !== "object" || Array.isArray(output.readback) || !output.rendererQa || typeof output.rendererQa !== "object" || Array.isArray(output.rendererQa)) return null;
  const artifacts = output.artifacts.map((artifact) => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return null;
    const candidate = artifact as Record<string, unknown>;
    if ((candidate.format !== "vsdx" && candidate.format !== "pdf" && candidate.format !== "png") || typeof candidate.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(candidate.sha256) || !isSafeNonNegativeInteger(candidate.bytes) || candidate.bytes <= 0) return null;
    return { format: candidate.format, sha256: candidate.sha256, bytes: candidate.bytes };
  });
  if (artifacts.some((artifact) => artifact === null)) return null;
  const readback = output.readback as Record<string, unknown>;
  if (readback.valid !== true || !isSafeNonNegativeInteger(readback.shapeCount) || !isSafeNonNegativeInteger(readback.connectorCount)) return null;
  const rendererQa: Record<string, { passed: boolean }> = {};
  for (const [name, check] of Object.entries(output.rendererQa as Record<string, unknown>)) {
    if (!check || typeof check !== "object" || Array.isArray(check) || typeof (check as Record<string, unknown>).passed !== "boolean") return null;
    rendererQa[name] = { passed: (check as Record<string, boolean>).passed };
  }
  return { artifacts: artifacts as Array<{ format: "vsdx" | "pdf" | "png"; sha256: string; bytes: number }>, readback: { valid: true, shapeCount: readback.shapeCount, connectorCount: readback.connectorCount }, rendererQa };
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function providerApiKey(request: FastifyRequest): string | undefined {
  const value = request.headers["x-synapse-provider-api-key"];
  if (value == null) return undefined;
  if (Array.isArray(value) || typeof value !== "string") {
    throw validationError("Provider API key must be a string", { field: "x-synapse-provider-api-key", reason: "invalid_type" });
  }
  const key = value.trim();
  if (!key) return undefined;
  if (key.length > MAX_PROVIDER_API_KEY_LENGTH) {
    throw validationError("Provider API key exceeds the maximum length", { field: "x-synapse-provider-api-key", reason: "limit_exceeded", max: MAX_PROVIDER_API_KEY_LENGTH });
  }
  return key;
}

function agentRequestHash(input: { hashConversationId: string | null; message: string; attachments: AgentAttachmentInput[]; canvas?: CanvasSnapshot }): string {
  return createHash("sha256").update(JSON.stringify({
    conversationId: input.hashConversationId,
    message: input.message,
    attachments: input.attachments.map((attachment) => ({
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      data: attachment.data,
    })),
    canvas: input.canvas ?? null,
  })).digest("hex");
}

function currentUtcPeriodStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function usageDetails(reservation: { metric: string; periodStart: string; limit: number; consumed: number; remaining: number }) {
  return {
    metric: reservation.metric,
    periodStart: reservation.periodStart,
    limit: reservation.limit,
    consumed: reservation.consumed,
    remaining: reservation.remaining,
  };
}

function trustedAgentProvider(value: unknown): AgentDraftOutput["provider"] | undefined {
  return typeof value === "string" && TRUSTED_AGENT_PROVIDERS.has(value as AgentDraftOutput["provider"])
    ? value as AgentDraftOutput["provider"]
    : undefined;
}

async function auditAgentChat(
  store: FoundationStore,
  actorId: string,
  action: string,
  conversationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await store.createAuditRecord({
    id: randomUUID(),
    actorType: "user",
    actorId,
    action,
    targetType: "agent-chat",
    targetId: conversationId,
    reason: null,
    metadata: { conversationId, ...metadata },
    createdAt: new Date().toISOString(),
  });
}

type PublicEvidenceValue = string | number | boolean | string[] | null;

interface PublicFigureAnalysis {
  status: "needs_confirmation" | "ready_for_preview";
  taskIntent: AgentTaskIntent;
  evidence: Array<{
    id: string;
    subject: string;
    predicate: string;
    value: PublicEvidenceValue;
    confidence: number;
    source: { sourceId: string; kind: EvidenceKind; name: string };
  }>;
  canonicalNetworkIR: CanonicalNetworkIR;
  blockingQuestions: Array<{ id: string; question: string; candidateValues: string[] }>;
  warnings: string[];
  readyForVisio: false;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const UNSAFE_PUBLIC_TEXT_PATTERNS = [
  /\bdata:[^\s,]+(?:;base64)?[,:]/i,
  /\bbase64(?:\s+payload)?\s*[:=,]/i,
  /-----BEGIN[^\r\n-]*PRIVATE KEY-----/i,
  /["']?\b(?:api[_-]?key|access[_-]?token)\b["']?\s*[:=]/i,
  /\b(?:bearer\s+[a-z0-9._-]{8,}|(?:sk|pk|ghp|github_pat|xox[bp]|AIza|AKIA)[-_]?[a-z0-9_-]{6,})\b/i,
  /(?:<\/?(?:svg|xml|visio|shape|connects?)\b|<\?xml|<!doctype\b)[^>]*>/i,
  /\b(?:visio\s+com|visio\.application|createobject\s*\(\s*["']visio|comobject|vba|sub\s+\w+|end\s+sub|shell\s*\(|powershell|cmd(?:\.exe)?\s*[/\\-]|bash\s+-c|sh\s+-c|os\.system|subprocess\.(?:run|popen)|python\s+-[cm]|import\s+(?:os|subprocess)|from\s+(?:os|subprocess)\s+import|javascript:|eval\s*\(|process\.env|document\.)\b/i,
  /\b(?:moveto|lineto|bezier(?:to)?|addshape|addconnector|connector|beginx|endx)\s*\(/i,
];

function safeText(value: unknown, max: number): value is string {
  return typeof value === "string" && value === value.trim() && value.length > 0 && value.length <= max
    && !UNSAFE_PUBLIC_TEXT_PATTERNS.some((pattern) => pattern.test(value));
}

function safeIdentifier(value: unknown, max = 128): value is string {
  return safeText(value, max) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function boundedArray(value: unknown, max: number): unknown[] | null {
  return Array.isArray(value) && value.length <= max ? value : null;
}

function boundedTextList(value: unknown, maxItems: number, maxTextLength: number, requireIdentifier = false): string[] | null {
  const list = boundedArray(value, maxItems);
  if (!list || !list.every((item) => requireIdentifier ? safeIdentifier(item, maxTextLength) : safeText(item, maxTextLength))) return null;
  return [...list] as string[];
}

function publicEvidenceValue(value: unknown): PublicEvidenceValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return [...value];
  return undefined;
}

function projectTaskIntent(value: unknown): AgentTaskIntent | null {
  const input = record(value);
  const constraints = record(input?.userConstraints);
  if (!input || !constraints
    || !["analyze_network", "create_figure", "revise_figure", "explain_structure", "render_to_visio", "export_preview"].includes(String(input.action))
    || !["text", "code", "model", "sketch", "reference_image", "mixed"].includes(String(input.sourceMode))
    || !["structure_only", "paper_overview", "architecture_detail", "module_detail", "visio_document"].includes(String(input.requestedArtifact))
    || (input.referencesDraftId !== null && !safeIdentifier(input.referencesDraftId))
    || !["auto", "landscape", "portrait"].includes(String(constraints.orientation))
    || !["compact", "standard", "detailed"].includes(String(constraints.density))
    || !["auto", "color", "grayscale"].includes(String(constraints.printMode))
    || typeof constraints.requiresNativeVisio !== "boolean") return null;

  return {
    action: input.action as AgentTaskIntent["action"],
    sourceMode: input.sourceMode as AgentTaskIntent["sourceMode"],
    requestedArtifact: input.requestedArtifact as AgentTaskIntent["requestedArtifact"],
    referencesDraftId: input.referencesDraftId as string | null,
    userConstraints: {
      orientation: constraints.orientation as AgentTaskIntent["userConstraints"]["orientation"],
      density: constraints.density as AgentTaskIntent["userConstraints"]["density"],
      printMode: constraints.printMode as AgentTaskIntent["userConstraints"]["printMode"],
      requiresNativeVisio: constraints.requiresNativeVisio,
    },
  };
}

function projectEvidenceBundle(value: unknown): EvidenceBundle | null {
  const incomingFacts = boundedArray(value, 256);
  if (!incomingFacts) return null;
  const sources = new Map<string, { id: string; kind: EvidenceKind; name: string }>();
  const facts: Array<Record<string, unknown>> = [];

  for (const value of incomingFacts) {
    const fact = record(value);
    const source = record(fact?.source);
    const evidenceValue = publicEvidenceValue(fact?.value);
    if (!fact || !source || evidenceValue === undefined
      || !safeIdentifier(fact.id) || !safeText(fact.subject, 128) || !safeText(fact.predicate, 128)
      || typeof fact.confidence !== "number" || !Number.isFinite(fact.confidence)
      || !safeIdentifier(source.sourceId) || !safeText(source.name, 256)
      || !["text", "code", "model", "image"].includes(String(source.kind))) return null;

    const publicSource = { id: source.sourceId, kind: source.kind as EvidenceKind, name: source.name };
    const previous = sources.get(publicSource.id);
    if (previous && (previous.kind !== publicSource.kind || previous.name !== publicSource.name)) return null;
    sources.set(publicSource.id, publicSource);
    facts.push({
      id: fact.id,
      subject: fact.subject,
      predicate: fact.predicate,
      value: evidenceValue,
      confidence: fact.confidence,
      source: { sourceId: publicSource.id, kind: publicSource.kind, locator: null, excerpt: null },
    });
  }
  if (sources.size > 6) return null;

  try {
    return parseEvidenceBundle({ version: 1, sources: [...sources.values()], facts, unresolved: [] });
  } catch {
    return null;
  }
}

function finiteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function nullableBoundedText(value: unknown, max: number): value is string | null {
  return value === null || safeText(value, max);
}

function projectCanonicalNetworkIR(value: unknown, evidence: EvidenceBundle): CanonicalNetworkIR | null {
  const input = record(value);
  if (!input) return null;
  const figure = record(input.figure);
  const tensors = boundedArray(input.tensors, 128);
  const nodes = boundedArray(input.nodes, 128);
  const edges = boundedArray(input.edges, 256);
  const groups = boundedArray(input.groups, 64);
  const unresolved = boundedArray(input.unresolved, 16);
  if (!figure || !tensors || !nodes || !edges || !groups || !unresolved
    || !safeIdentifier(figure.id) || !safeText(figure.title, 256) || !nullableBoundedText(figure.description, 512)) return null;

  const projectedTensors = tensors.map((value) => {
    const tensor = record(value);
    const shape = boundedArray(tensor?.shape, 8);
    const axes = boundedTextList(tensor?.axes, 8, 128, true);
    const consumers = boundedTextList(tensor?.consumerNodeIds, 64, 128, true);
    if (!tensor || !shape || !axes || !consumers || !safeIdentifier(tensor.id) || !safeText(tensor.name, 256)
      || !nullableBoundedText(tensor.dtype, 128) || !nullableBoundedText(tensor.producerNodeId, 128)) return null;
    return {
      id: tensor.id, name: tensor.name, shape: [...shape], axes, semanticRole: tensor.semanticRole,
      dtype: tensor.dtype, producerNodeId: tensor.producerNodeId, consumerNodeIds: consumers,
    };
  });
  if (projectedTensors.some((item) => item === null)) return null;

  const projectedNodes = nodes.map((value) => {
    const node = record(value);
    const inputs = boundedTextList(node?.inputTensorIds, 64, 128, true);
    const outputs = boundedTextList(node?.outputTensorIds, 64, 128, true);
    const evidenceIds = boundedTextList(node?.sourceEvidenceIds, 256, 128, true);
    const repeat = record(node?.repeats);
    if (!node || !inputs || !outputs || !evidenceIds || !safeIdentifier(node.id) || !finiteOrNull(node.confidence)) return null;
    if (node.repeats !== null && (!repeat || typeof repeat.count !== "number" || !Number.isFinite(repeat.count))) return null;
    const repeatUnits = node.repeats === null ? null : boundedTextList(repeat?.unitNodeIds, 128, 128, true);
    if (node.repeats !== null && !repeatUnits) return null;
    return {
      id: node.id, op: node.op, inputTensorIds: inputs, outputTensorIds: outputs,
      confidence: node.confidence, sourceEvidenceIds: evidenceIds,
      repeats: node.repeats === null ? null : { count: repeat!.count, unitNodeIds: repeatUnits! },
    };
  });
  if (projectedNodes.some((item) => item === null)) return null;

  const projectedEdges = edges.map((value) => {
    const edge = record(value);
    const tensorIds = boundedTextList(edge?.tensorIds, 64, 128, true);
    const evidenceIds = boundedTextList(edge?.evidenceIds, 256, 128, true);
    if (!edge || !tensorIds || !evidenceIds || !safeIdentifier(edge.id) || !safeIdentifier(edge.sourceNodeId)
      || !safeIdentifier(edge.targetNodeId) || !finiteOrNull(edge.confidence)) return null;
    return {
      id: edge.id, sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId, relation: edge.relation,
      tensorIds, confidence: edge.confidence, evidenceIds,
    };
  });
  if (projectedEdges.some((item) => item === null)) return null;

  const projectedGroups = groups.map((value) => {
    const group = record(value);
    const nodeIds = boundedTextList(group?.nodeIds, 128, 128, true);
    const evidenceIds = boundedTextList(group?.sourceEvidenceIds, 256, 128, true);
    if (!group || !nodeIds || !evidenceIds || !safeIdentifier(group.id) || !safeText(group.label, 256) || !finiteOrNull(group.confidence)) return null;
    return { id: group.id, label: group.label, nodeIds, confidence: group.confidence, sourceEvidenceIds: evidenceIds };
  });
  if (projectedGroups.some((item) => item === null)) return null;

  const projectedUnresolved = unresolved.map((value) => {
    const item = record(value);
    const candidates = boundedTextList(item?.candidateValues, 8, 256);
    const evidenceIds = boundedTextList(item?.evidenceIds, 256, 128, true);
    if (!item || !candidates || !evidenceIds || !safeIdentifier(item.id) || !safeText(item.question, 512)) return null;
    return { id: item.id, question: item.question, severity: item.severity, candidateValues: candidates, evidenceIds };
  });
  if (projectedUnresolved.some((item) => item === null)) return null;

  const projected = {
    version: input.version,
    figure: { id: figure.id, title: figure.title, description: figure.description },
    tensors: projectedTensors,
    nodes: projectedNodes,
    edges: projectedEdges,
    groups: projectedGroups,
    unresolved: projectedUnresolved,
  };

  try {
    return parseCanonicalNetworkIR(projected, evidence);
  } catch {
    return null;
  }
}

function projectFigureAnalysis(value: unknown): PublicFigureAnalysis | null {
  const input = record(value);
  if (!input || (input.status !== "needs_confirmation" && input.status !== "ready_for_preview")) return null;
  const taskIntent = projectTaskIntent(input.taskIntent);
  const evidenceBundle = projectEvidenceBundle(input.evidence);
  const canonicalNetworkIR = evidenceBundle ? projectCanonicalNetworkIR(input.canonicalNetworkIR, evidenceBundle) : null;
  const warnings = boundedTextList(input.warnings, 16, 512);
  const incomingQuestions = boundedArray(input.blockingQuestions, 16);
  if (!taskIntent || !evidenceBundle || !canonicalNetworkIR || !warnings || !incomingQuestions) return null;
  const validatedQuestions = incomingQuestions.map((value) => {
    const question = record(value);
    const candidates = boundedTextList(question?.candidateValues, 8, 256);
    if (!question || !candidates || candidates.length < 2 || new Set(candidates).size !== candidates.length
      || !safeIdentifier(question.id) || !safeText(question.question, 512)) return null;
    return { id: question.id, question: question.question, candidateValues: candidates };
  });
  if (validatedQuestions.some((item) => item === null)) return null;
  if ((input.status === "needs_confirmation" && validatedQuestions.length !== 1)
    || (input.status === "ready_for_preview" && validatedQuestions.length !== 0)) return null;
  const blockingQuestions = validatedQuestions as PublicFigureAnalysis["blockingQuestions"];

  return {
    status: input.status,
    taskIntent,
    evidence: publicEvidenceSummary(evidenceBundle),
    canonicalNetworkIR,
    blockingQuestions,
    warnings,
    readyForVisio: false,
  };
}

function publicFigureDraft(draft: FigureDraft) {
  return {
    id: draft.id,
    conversationId: draft.conversationId,
    status: draft.status,
    currentRevision: draft.currentRevision,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

function agentChatDraftSummary(draft: FigureDraft) {
  return {
    id: draft.id,
    status: draft.status,
    currentRevision: draft.currentRevision,
  };
}

function publicFigureDraftRevision(revision: FigureDraftRevision) {
  if (revision.status === "failed") {
    return {
      revision: revision.revision,
      status: revision.status,
      createdAt: revision.createdAt,
      analysis: null,
    };
  }
  const payload = record(revision.payload);
  const analysis = payload ? projectFigureAnalysis({ ...payload, status: revision.status }) : null;
  if (!analysis) {
    throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Figure draft revision payload is invalid", 500);
  }
  return {
    revision: revision.revision,
    status: revision.status,
    createdAt: revision.createdAt,
    analysis,
  };
}

function parseFigureDraftConfirmation(request: FastifyRequest): { expectedRevision: number; answer: FigureDraftConfirmation } {
  const input = objectField(request.body, "body");
  const expectedRevision = input.expectedRevision;
  if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw validationError("expectedRevision must be a positive integer", { field: "expectedRevision", reason: "invalid_value" });
  }
  const answer = objectField(input.answer, "answer");
  if (!safeIdentifier(answer.questionId) || !safeText(answer.value, 256)) {
    throw validationError("answer must contain a valid questionId and value", { field: "answer", reason: "invalid_value" });
  }
  return {
    expectedRevision,
    answer: { questionId: answer.questionId, value: answer.value },
  };
}

async function auditFigureDraft(
  store: FoundationStore,
  actorId: string,
  action: string,
  draftId: string,
  revision: ReturnType<typeof publicFigureDraftRevision>,
): Promise<void> {
  await store.createAuditRecord({
    id: randomUUID(),
    actorType: "user",
    actorId,
    action,
    targetType: "figure-draft",
    targetId: draftId,
    reason: null,
    metadata: {
      draftId,
      revision: revision.revision,
      status: revision.status,
      blockingQuestionCount: revision.analysis?.blockingQuestions.length ?? 0,
      warningCount: revision.analysis?.warnings.length ?? 0,
    },
    createdAt: new Date().toISOString(),
  });
}

async function auditUniversalFigureExport(
  store: FoundationStore,
  actorId: string,
  input: { draftId: string; revision: number; planId: string; planHash: string; jobId: string; duplicate: boolean },
): Promise<void> {
  await store.createAuditRecord({
    id: randomUUID(),
    actorType: "user",
    actorId,
    action: "universal-figure-export.created",
    targetType: "universal-figure-export",
    targetId: input.jobId,
    reason: null,
    metadata: { draftId: input.draftId, revision: input.revision, planId: input.planId, planHash: input.planHash, duplicate: input.duplicate },
    createdAt: new Date().toISOString(),
  });
}

async function auditFigureDraftPreview(
  store: FoundationStore,
  actorId: string,
  draftId: string,
  preview: { draft: { revision: number; status: string }; grammar: { id: string; version: number }; plan: { target: string; primitives: unknown[]; relations: unknown[]; annotations: unknown[] } },
): Promise<void> {
  await store.createAuditRecord({
    id: randomUUID(),
    actorType: "user",
    actorId,
    action: "figure-draft.preview.read",
    targetType: "figure-draft",
    targetId: draftId,
    reason: null,
    metadata: {
      draftId,
      revision: preview.draft.revision,
      status: preview.draft.status,
      grammarId: preview.grammar.id,
      grammarVersion: preview.grammar.version,
      target: preview.plan.target,
      primitiveCount: preview.plan.primitives.length,
      relationCount: preview.plan.relations.length,
      annotationCount: preview.plan.annotations.length,
    },
    createdAt: new Date().toISOString(),
  });
}

function objectField(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(`${field} must be an object`, { field, reason: "invalid_type" });
  }
  return value as Record<string, unknown>;
}

function parseVisioExportBody(request: FastifyRequest): { diagram: Record<string, unknown>; idempotencyKey: string } {
  const input = body(request);
  const diagram = objectField(input.diagram, "diagram");
  if (!Array.isArray(diagram.nodes)) {
    throw validationError("diagram.nodes must be an array", { field: "diagram.nodes", reason: "invalid_type" });
  }
  if (!Array.isArray(diagram.edges)) {
    throw validationError("diagram.edges must be an array", { field: "diagram.edges", reason: "invalid_type" });
  }
  if (Object.prototype.hasOwnProperty.call(input, "outputPath")) {
    throw validationError("outputPath is controlled by the Visio Worker", { field: "outputPath", reason: "forbidden" });
  }
  return { diagram, idempotencyKey: idempotencyKey(request) };
}

function visioRequestHash(diagram: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(diagram)).digest("hex");
}

function requiredStringField(value: unknown, field: string): string {
  if (value == null) {
    throw validationError(`${field} is required`, { field, reason: "required" });
  }
  if (typeof value !== "string") {
    throw validationError(`${field} must be a string`, { field, reason: "invalid_type" });
  }
  return value;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw validationError(`${field} contains an unsupported field`, { field: `${field}.${key}`, reason: "forbidden" });
    }
  }
}

function requiredIdentifierField(value: unknown, field: string): string {
  const identifier = requiredStringField(value, field);
  if (!safeIdentifier(identifier)) {
    throw validationError(`${field} must be a safe identifier`, { field, reason: "invalid_value" });
  }
  return identifier;
}

function boundedRawSourceField(value: unknown, field: string): string {
  const source = requiredStringField(value, field);
  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes === 0 || bytes > MAX_UNIVERSAL_PREVIEW_SOURCE_BYTES || source.includes("\0")) {
    throw validationError(`${field} is outside the allowed source bounds`, {
      field,
      reason: "invalid_value",
      maxBytes: MAX_UNIVERSAL_PREVIEW_SOURCE_BYTES,
    });
  }
  return source;
}

function requiredSha256Field(value: unknown, field: string): string {
  const digest = requiredStringField(value, field).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw validationError(`${field} must be a SHA-256 digest`, { field, reason: "invalid_value" });
  }
  return digest;
}

function optionalStringField(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  return requiredStringField(value, field);
}

function normalizedBase64(value: string, field: string): { normalized: string; bytes: Buffer } {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || normalized.length % 4 !== 0 || !BASE64_PATTERN.test(normalized)) {
    throw validationError(`${field} must be valid base64`, { field, reason: "invalid_base64" });
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== normalized) {
    throw validationError(`${field} must be valid base64`, { field, reason: "invalid_base64" });
  }
  return { normalized, bytes };
}

function parseAgentBody(request: FastifyRequest): { conversationId: string; hashConversationId: string | null; message: string; attachments: AgentAttachmentInput[]; canvas?: CanvasSnapshot } {
  const input = objectField(request.body, "body");
  const message = requiredStringField(input.message, "message");
  if (!message.trim()) {
    throw validationError("message must not be empty", { field: "message", reason: "empty" });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw validationError("message exceeds the maximum length", { field: "message", reason: "limit_exceeded", max: MAX_MESSAGE_LENGTH });
  }

  const conversationId = optionalStringField(input.conversationId, "conversationId");
  const trimmedConversationId = conversationId?.trim();
  if (trimmedConversationId && trimmedConversationId.length > MAX_CONVERSATION_ID_LENGTH) {
    throw validationError("conversationId exceeds the maximum length", { field: "conversationId", reason: "limit_exceeded", max: MAX_CONVERSATION_ID_LENGTH });
  }
  if (conversationId !== undefined && !trimmedConversationId) {
    throw validationError("conversationId must not be empty", { field: "conversationId", reason: "empty" });
  }

  if (input.attachments != null && !Array.isArray(input.attachments)) {
    throw validationError("attachments must be an array", { field: "attachments", reason: "invalid_type" });
  }
  const attachmentsInput = (input.attachments ?? []) as unknown[];
  if (attachmentsInput.length > MAX_ATTACHMENTS) {
    throw validationError("attachments exceed the maximum count", { field: "attachments", reason: "limit_exceeded", max: MAX_ATTACHMENTS });
  }

  const attachments = attachmentsInput.map((item, index) => {
    const attachment = objectField(item, `attachments[${index}]`);
    const name = requiredStringField(attachment.name, `attachments[${index}].name`);
    const mimeType = requiredStringField(attachment.mimeType, `attachments[${index}].mimeType`);
    const data = requiredStringField(attachment.data, `attachments[${index}].data`);
    const kindValue = requiredStringField(attachment.kind, `attachments[${index}].kind`);
    if (kindValue !== "code" && kindValue !== "image") {
      throw validationError("attachment kind is not supported", { field: `attachments[${index}].kind`, reason: "unsupported_kind" });
    }
    const kind: AgentAttachmentInput["kind"] = kindValue;

    const allowedMimeTypes = kind === "code" ? CODE_MIME_TYPES : IMAGE_MIME_TYPES;
    if (!allowedMimeTypes.has(mimeType)) {
      throw validationError("attachment mime type is not supported", { field: `attachments[${index}].mimeType`, reason: "unsupported_mime", mimeType, kind });
    }

    const { normalized, bytes } = normalizedBase64(data, `attachments[${index}].data`);
    if (kind === "code") {
      const decoded = bytes.toString("utf8");
      if (decoded.length > MAX_CODE_CHARACTERS) {
        throw validationError("code attachment exceeds the maximum length", {
          field: `attachments[${index}].data`,
          reason: "limit_exceeded",
          max: MAX_CODE_CHARACTERS,
        });
      }
    } else if (bytes.length > MAX_IMAGE_BYTES) {
      throw validationError("image attachment exceeds the maximum size", {
        field: `attachments[${index}].data`,
        reason: "limit_exceeded",
        maxBytes: MAX_IMAGE_BYTES,
      });
    }

    return { name, mimeType, data: normalized, kind };
  });

  let canvas: CanvasSnapshot | undefined;
  if (input.canvas !== undefined) {
    try {
      canvas = parseCanvasSnapshot(input.canvas);
    } catch (error) {
      throw validationError(error instanceof Error ? error.message : "canvas is invalid", { field: "canvas", reason: "invalid_canvas" });
    }
  }

  return {
    conversationId: trimmedConversationId ?? randomUUID(),
    hashConversationId: trimmedConversationId ?? null,
    message,
    attachments,
    ...(canvas ? { canvas } : {}),
  };
}

export function registerRoutes(app: FastifyInstance, options: RouteOptions): void {
  app.get("/health", async () => ({ status: "ok" }));

  app.post("/api/universal-figure-previews", async (request, reply) => {
    universalPreviewVersion(request);
    const access = await requireUser(request, options);
    const parsed = parseUniversalPreviewBody(request);
    let compiled;
    try {
      compiled = compileUniversalInputToPublicationPreview(serverBoundUniversalPreviewInput(options.sessionSecret, access.user.id, access.device.id, parsed.input), {
        detail: parsed.detail,
        updateIdentity: universalPreviewUpdateIdentity(options.sessionSecret, access.user.id, access.device.id, parsed.input, parsed.detail),
      });
    } catch {
      throw validationError("Universal figure preview input is invalid", {
        field: "input",
        reason: "invalid",
      });
    }
    const preview = projectPublicationVisualPlanPreview(compiled);
    await auditUniversalPreview(options.store, access.user.id, parsed.input.kind, preview);
    reply.header("Figure-Version", "4");
    return reply.send(preview);
  });

  app.post("/api/figure-analyses", async (request, reply) => {
    figureAnalysisVersion(request);
    const access = await requireUser(request, options);
    const sourceInput = parseFigureAnalysisBody(request);
    const key = idempotencyKey(request);
    let source: SourcePack;
    try {
      source = parsePyTorchSourcePack(sourceInput);
    } catch (error) {
      throw validationError("Invalid figure analysis source", {
        field: "source",
        reason: "invalid",
        message: error instanceof Error ? error.message : "source validation failed",
      });
    }

    let result: { record: FigureAnalysisRecord; duplicate: boolean };
    try {
      result = await options.figureAnalysisService.analyze({
        userId: access.user.id,
        source,
        idempotencyKey: key,
        requestHash: figureAnalysisRequestHash(source),
      });
    } catch (error) {
      if (error instanceof Error && /idempotency key was reused/i.test(error.message)) {
        throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Idempotency-Key was reused for a different figure analysis source", 409, {
          field: "Idempotency-Key",
          reason: "reused",
          requestHashMatches: false,
        });
      }
      throw error;
    }
    await auditFigureAnalysis(options.store, access.user.id, result.record, result.duplicate);
    reply.header("Figure-Version", "3");
    return reply.code(result.duplicate ? 200 : 201).send(publicFigureAnalysis(result.record));
  });

  app.get("/api/figure-analyses/:id", async (request, reply) => {
    figureAnalysisVersion(request);
    const access = await requireUser(request, options);
    const params = request.params as { id?: string };
    if (!params.id || !safeIdentifier(params.id)) throw validationError("Figure analysis id is invalid", { field: "id", reason: "invalid" });
    const analysis = await options.store.getFigureAnalysis(access.user.id, params.id);
    if (!analysis) throw new FoundationError(ApiErrorCode.NOT_FOUND, "Figure analysis was not found", 404);
    reply.header("Figure-Version", "3");
    return reply.send(publicFigureAnalysis(analysis));
  });

  app.get("/api/figure-analyses/:analysisId/preview", async (request, reply) => {
    figureAnalysisVersion(request);
    const access = await requireUser(request, options);
    const params = request.params as { analysisId?: string };
    if (!params.analysisId || !safeIdentifier(params.analysisId)) {
      throw validationError("Figure analysis id is invalid", { field: "analysisId", reason: "invalid" });
    }
    const preview = await options.figureAnalysisPreviewService.preview(access.user.id, params.analysisId);
    await auditFigureAnalysisPreview(options.store, access.user.id, preview);
    reply.header("Figure-Version", "3");
    return reply.send(preview);
  });

  app.post("/api/auth/register", async (request, reply) => {
    const input = body(request);
    const user = await options.sessionService.registerUser({ email: String(input.email ?? ""), password: String(input.password ?? "") });
    const deviceInput = input.device;
    const device = deviceInput
      ? await options.sessionService.registerDevice({
        userId: user.id,
        name: String(deviceInput.name ?? "Windows device"),
        publicKey: String(deviceInput.publicKey ?? ""),
        fingerprintHash: String(deviceInput.fingerprintHash ?? ""),
        clientVersion: String(deviceInput.clientVersion ?? ""),
        osVersion: String(deviceInput.osVersion ?? ""),
      })
      : null;
    return reply.code(201).send({ user: publicUser(user), device });
  });

  app.post("/api/auth/challenge", async (request) => {
    const input = body(request);
    return options.sessionService.createLoginChallenge({
      email: String(input.email ?? ""),
      password: String(input.password ?? ""),
      deviceId: String(input.deviceId ?? ""),
    });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const input = body(request);
    const result = await options.sessionService.login({
      email: String(input.email ?? ""),
      password: String(input.password ?? ""),
      deviceId: String(input.deviceId ?? ""),
      deviceProof: input.deviceProof && { challengeId: String(input.deviceProof.challengeId ?? ""), signature: String(input.deviceProof.signature ?? "") },
    });
    return reply.send({ ...result, user: publicUser(result.user) });
  });

  app.get("/api/auth/session", async (request) => {
    const access = await requireUser(request, options);
    return { user: publicUser(access.user), device: access.device, session: access.session, subscription: access.subscription };
  });

  app.post("/api/auth/logout", async (request) => {
    const accessToken = bearer(request);
    const claims = await verifyAccessToken(accessToken, options.sessionSecret);
    await options.sessionService.logout({ sessionId: claims.sessionId, accessToken });
    return { status: "logged_out" };
  });

  app.post("/api/devices/register", async (request, reply) => {
    const access = await requireUser(request, options);
    const input = body(request);
    const device = await options.sessionService.registerDevice({
      userId: access.user.id,
      name: String(input.name ?? "Windows device"),
      publicKey: String(input.publicKey ?? ""),
      fingerprintHash: String(input.fingerprintHash ?? ""),
      clientVersion: String(input.clientVersion ?? ""),
      osVersion: String(input.osVersion ?? ""),
    });
    return reply.code(201).send({ device });
  });

  app.post("/api/devices/heartbeat", async (request) => {
    const accessToken = bearer(request);
    const claims = await verifyAccessToken(accessToken, options.sessionSecret);
    const input = body(request);
    const session = await options.sessionService.heartbeat({ sessionId: String(input.sessionId ?? claims.sessionId), accessToken });
    return { session };
  });

  app.get("/api/license/status", async (request) => {
    const access = await requireUser(request, options);
    return {
      authenticated: true,
      subscription: access.subscription,
      features: access.subscription?.features ?? [],
      limits: access.subscription?.limits ?? {},
    };
  });

  app.get("/api/figure-drafts/:draftId", async (request) => {
    const access = await requireUser(request, options);
    const draftId = (request.params as { draftId: string }).draftId;
    const snapshot = await options.figureDraftService.get(access.user.id, draftId);
    if (!snapshot) throw new FoundationError(ApiErrorCode.NOT_FOUND, "Figure draft was not found", 404);
    const revision = publicFigureDraftRevision(snapshot.revision);
    await auditFigureDraft(options.store, access.user.id, "figure-draft.read", draftId, revision);
    return { draft: publicFigureDraft(snapshot.draft), revision };
  });

  app.get("/api/figure-drafts/:draftId/preview", async (request) => {
    const access = await requireUser(request, options);
    const draftId = (request.params as { draftId: string }).draftId;
    const preview = await options.figureDraftPreviewService.compile(access.user.id, draftId);
    await auditFigureDraftPreview(options.store, access.user.id, draftId, preview);
    return preview;
  });

  app.get("/api/figure-drafts/:draftId/revisions/:revision/publication-preview", async (request) => {
    const access = await requireUser(request, options);
    universalFigureVersion(request);
    const { draftId, revision: revisionParam } = request.params as { draftId: string; revision: string };
    const revisionNumber = Number(revisionParam);
    if (!Number.isSafeInteger(revisionNumber) || revisionNumber < 1) {
      throw new FoundationError(ApiErrorCode.NOT_FOUND, "Figure draft revision was not found", 404);
    }
    const snapshot = await options.figureDraftService.getRevision(access.user.id, draftId, revisionNumber);
    if (!snapshot) throw new FoundationError(ApiErrorCode.NOT_FOUND, "Figure draft revision was not found", 404);
    const payload = parseFigureDraftRevisionPayload(snapshot.revision.payload, { statusCode: 500 });
    if (!payload.universalGraphSpec) {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Figure draft revision cannot generate a publication preview", 409, {
        reason: "universal_graph_spec_missing",
      });
    }
    const blockingQuestion = payload.blockingQuestions[0];
    if (snapshot.revision.status === "needs_confirmation" || blockingQuestion) {
      if (snapshot.revision.status !== "needs_confirmation" || !blockingQuestion) {
        throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Figure draft revision clarification state is invalid", 500);
      }
      await options.store.createAuditRecord({
        id: randomUUID(),
        actorType: "user",
        actorId: access.user.id,
        action: "figure-draft.publication-preview.read",
        targetType: "figure-draft",
        targetId: draftId,
        reason: null,
        metadata: { draftId, revision: revisionNumber, kind: "clarification" },
        createdAt: new Date().toISOString(),
      });
      return {
        kind: "clarification" as const,
        draft: { id: snapshot.draft.id, revision: snapshot.revision.revision },
        question: blockingQuestion,
        affectedRegionIds: [],
        evidenceIds: [],
      };
    }
    const preview = new PublicationVisualPreviewService().preview({
      ugs: payload.universalGraphSpec,
      detail: "architecture",
      updateIdentity: {
        ownerId: access.user.id,
        deviceId: access.device.id,
        workflowId: `draft:${draftId}`,
        documentId: `preview:${draftId}`,
        pageId: "publication-preview",
        expectedRevision: revisionNumber,
      },
    });
    await options.store.createAuditRecord({
      id: randomUUID(),
      actorType: "user",
      actorId: access.user.id,
      action: "figure-draft.publication-preview.read",
      targetType: "figure-draft",
      targetId: draftId,
      reason: null,
      metadata: {
        draftId,
        revision: revisionNumber,
        kind: preview.kind,
        exportEligible: preview.exportEligible,
        planId: preview.pvp.identity.planId,
        planHash: preview.pvp.identity.canonicalHash,
      },
      createdAt: new Date().toISOString(),
    });
    return {
      kind: preview.kind,
      exportEligible: preview.exportEligible,
      draft: { id: snapshot.draft.id, revision: snapshot.revision.revision },
      pvp: preview.pvp,
    };
  });

  app.get("/api/figure-drafts/:draftId/revisions/:revision", async (request) => {
    const access = await requireUser(request, options);
    const { draftId, revision: revisionParam } = request.params as { draftId: string; revision: string };
    const snapshot = await options.figureDraftService.get(access.user.id, draftId);
    if (!snapshot) throw new FoundationError(ApiErrorCode.NOT_FOUND, "Figure draft was not found", 404);
    const revisionNumber = Number(revisionParam);
    if (!Number.isSafeInteger(revisionNumber) || revisionNumber < 1) {
      throw new FoundationError(ApiErrorCode.NOT_FOUND, "Figure draft revision was not found", 404);
    }
    const storedRevision = await options.store.getFigureDraftRevision(access.user.id, draftId, revisionNumber);
    if (!storedRevision) throw new FoundationError(ApiErrorCode.NOT_FOUND, "Figure draft revision was not found", 404);
    const revision = publicFigureDraftRevision(storedRevision);
    await auditFigureDraft(options.store, access.user.id, "figure-draft.revision.read", draftId, revision);
    return { draft: publicFigureDraft(snapshot.draft), revision };
  });

  app.post("/api/figure-drafts/:draftId/confirm", async (request) => {
    const access = await requireUser(request, options);
    const draftId = (request.params as { draftId: string }).draftId;
    const input = parseFigureDraftConfirmation(request);
    const confirmed = await options.figureDraftService.confirm(access.user.id, draftId, input.expectedRevision, input.answer);
    if (confirmed.conflict) {
      throw new FoundationError("FIGURE_DRAFT_REVISION_CONFLICT", "Figure draft revision is no longer current", 409);
    }
    if (!confirmed.draft || !confirmed.revision) {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Figure draft confirmation did not produce a revision", 500);
    }
    const revision = publicFigureDraftRevision(confirmed.revision);
    await auditFigureDraft(options.store, access.user.id, "figure-draft.confirmed", draftId, revision);
    return { draft: publicFigureDraft(confirmed.draft), revision };
  });

  app.post("/api/figure-drafts/:draftId/revisions/:revision/exports", async (request, reply) => {
    const access = await requireUser(request, options);
    universalFigureVersion(request);
    if (!options.universalFigureExportService || !options.universalFigureExportRunner) {
      throw new FoundationError(ApiErrorCode.VISIO_EXECUTOR_NOT_CONFIGURED, "Universal figure export is not configured", 503);
    }
    const { draftId, revision: revisionParam } = request.params as { draftId: string; revision: string };
    const revision = Number(revisionParam);
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw validationError("Figure draft revision is invalid", { field: "revision", reason: "invalid" });
    }
    const input = parseUniversalFigureExportBody(request);
    let created;
    try {
      created = await options.universalFigureExportService.create({
        owner: universalOwner(access.user.id),
        deviceId: access.device.id,
        draftId,
        revision,
        confirmationToken: input.confirmationToken,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      throw validationError(error instanceof Error ? error.message : "Universal figure export request is invalid", { field: "confirmationToken", reason: "rejected" });
    }
    if (!created.duplicate) {
      await options.store.createJob({
        id: created.job.id,
        userId: access.user.id,
        deviceId: access.device.id,
        type: "universal-figure-export",
        status: "queued",
        input: created.job.input,
        output: null,
        errorCode: null,
        errorMessage: null,
        createdAt: created.job.createdAt,
        startedAt: null,
        completedAt: null,
      });
      await options.universalFigureExportRunner.submit(created.job.id);
    }
    await auditUniversalFigureExport(options.store, access.user.id, {
      draftId,
      revision,
      planId: created.job.planId,
      planHash: created.job.planHash,
      jobId: created.job.id,
      duplicate: created.duplicate,
    });
    reply.header("Figure-Version", "3");
    return reply.code(created.duplicate ? 200 : 202).send({
      id: created.job.id,
      type: created.job.type,
      status: created.job.status,
      draftId: created.job.draftId,
      revision: created.job.revision,
      planId: created.job.planId,
      planHash: created.job.planHash,
      pollUrl: `/api/jobs/${created.job.id}`,
    });
  });

  app.post("/api/jobs", async (request, reply) => {
    const access = await requireUser(request, options);
    const input = body(request);
    if (input.type === "universal-figure-export") {
      throw validationError("Universal figure exports must be created from an exact viewed FigureDraft revision", {
        field: "type",
        reason: "dedicated_route_required",
      });
    }
    const job = await options.jobService.create({ userId: access.user.id, deviceId: access.device.id, type: input.type, input: input.input });
    return reply.code(201).send(job);
  });

  const legacyVisioExportHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const access = await requireUser(request, options);
    const input = parseVisioExportBody(request);
    const health = await options.visioExecutor.healthCheck();
    if (!health.connected) {
      throw new FoundationError(health.reason === ApiErrorCode.VISIO_EXECUTION_FAILED ? ApiErrorCode.VISIO_EXECUTION_FAILED : ApiErrorCode.VISIO_EXECUTOR_NOT_CONFIGURED, "Visio Worker is not configured or unavailable", 503, { reason: health.reason });
    }
    const requestHash = visioRequestHash(input.diagram);
    const created = await options.jobService.createVisioIdempotent({
      userId: access.user.id,
      deviceId: access.device.id,
      input: { diagram: input.diagram, idempotencyKey: input.idempotencyKey, requestHash },
      idempotencyKey: input.idempotencyKey,
      requestHash,
    });
    if (created.duplicate) {
      if (!created.requestHashMatches) {
        throw new FoundationError(ApiErrorCode.VISIO_IDEMPOTENCY_KEY_REUSED, "Idempotency-Key has already been used for a different Visio diagram", 409, {
          requestHashMatches: false,
          jobId: created.job.id,
        });
      }
      return reply.code(200).send(created.job);
    }
    const job = created.job;
    options.visioJobRunner.submit(job.id);
    return reply.code(202).send({ ...job, pollUrl: `/api/jobs/${job.id}` });
  };
  app.post("/api/legacy/visio-exports", legacyVisioExportHandler);

  app.post("/api/figure-drafts/:draftId/revisions/:revision/visio-exports", async (request, reply) => {
    const access = await requireUser(request, options);
    const input = body(request);
    if (Object.keys(input).length !== 0) {
      throw validationError("Agent Visio export body must not contain drawing or Worker fields", {
        field: "body",
        reason: "server_bound_snapshot_required",
      });
    }
    const draftId = (request.params as { draftId: string }).draftId;
    const revision = Number((request.params as { revision: string }).revision);
    if (!Number.isSafeInteger(revision) || revision <= 0) {
      throw validationError("Figure draft revision is invalid", { field: "revision", reason: "invalid" });
    }
    const health = await options.visioExecutor.healthCheck();
    if (!health.connected) {
      throw new FoundationError(health.reason === ApiErrorCode.VISIO_EXECUTION_FAILED ? ApiErrorCode.VISIO_EXECUTION_FAILED : ApiErrorCode.VISIO_EXECUTOR_NOT_CONFIGURED, "Visio Worker is not configured or unavailable", 503, { reason: health.reason });
    }
    const snapshot = await options.agentVisioExecutionSnapshotService.create({
      owner: { tenantId: "synapse-local", userId: access.user.id },
      draftId,
      revision,
    });
    const key = idempotencyKey(request);
    const requestHash = visioRequestHash({ snapshotId: snapshot.snapshotId, planDigest: snapshot.planDigest });
    const created = await options.jobService.createVisioIdempotent({
      userId: access.user.id,
      deviceId: access.device.id,
      input: {
        agentVisioExecutionSnapshotId: snapshot.snapshotId,
        planDigest: snapshot.planDigest,
        draftId: snapshot.draftId,
        revision: snapshot.revision,
        requestHash,
      },
      idempotencyKey: key,
      requestHash,
    });
    if (created.duplicate) {
      if (!created.requestHashMatches) {
        throw new FoundationError(ApiErrorCode.VISIO_IDEMPOTENCY_KEY_REUSED, "Idempotency-Key has already been used for a different Agent Visio revision", 409, {
          requestHashMatches: false,
          jobId: created.job.id,
        });
      }
      return reply.code(200).send({
        id: created.job.id,
        type: created.job.type,
        status: created.job.status,
        draftId: snapshot.draftId,
        revision: snapshot.revision,
        snapshotId: snapshot.snapshotId,
        planDigest: snapshot.planDigest,
        pollUrl: `/api/jobs/${created.job.id}`,
      });
    }
    options.visioJobRunner.submit(created.job.id);
    return reply.code(202).send({
      id: created.job.id,
      type: created.job.type,
      status: created.job.status,
      draftId: snapshot.draftId,
      revision: snapshot.revision,
      snapshotId: snapshot.snapshotId,
      planDigest: snapshot.planDigest,
      pollUrl: `/api/jobs/${created.job.id}`,
    });
  });

  app.get("/api/jobs/:id", async (request) => {
    const access = await requireUser(request, options);
    const id = (request.params as { id: string }).id;
    const job = await options.jobService.get(id);
    if (!job || job.userId !== access.user.id || (job.type === "universal-figure-export" && job.deviceId !== access.device.id)) throw new FoundationError(ApiErrorCode.NOT_FOUND, "Job was not found", 404);
    if (job.type === "universal-figure-export") return publicUniversalFigureExportJob(job);
    return job;
  });

  app.post("/api/jobs/:id/cancel", async (request) => {
    const access = await requireUser(request, options);
    const id = (request.params as { id: string }).id;
    const job = await options.jobService.get(id);
    if (!job || job.userId !== access.user.id) throw new FoundationError(ApiErrorCode.NOT_FOUND, "Job was not found", 404);
    if (job.type === "visio-export") return await options.visioJobRunner.cancel(id);
    if (job.type === "universal-figure-export" && options.universalFigureExportRunner?.cancel) return await options.universalFigureExportRunner.cancel(id);
    return await options.jobService.cancel(id);
  });

  app.post("/api/agent/chat", async (request) => {
    const access = await requireUser(request, options);
    const input = parseAgentBody(request);
    const key = idempotencyKey(request);
    if (!options.agentService) {
      throw new FoundationError(ApiErrorCode.AGENT_PROVIDER_NOT_CONFIGURED, "Agent service is not configured", 503);
    }

    if (!access.subscription) {
      throw new FoundationError(ApiErrorCode.SUBSCRIPTION_REQUIRED, "An active subscription is required for Agent usage", 402);
    }
    const limit = Number(access.subscription.limits.agentChatsPerMonth ?? 0);
    const periodStart = currentUtcPeriodStart();
    const requestHash = agentRequestHash(input);
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      await auditAgentChat(options.store, access.user.id, "agent.chat.rejected", input.conversationId, {
        metric: AGENT_USAGE_METRIC,
        periodStart,
        limit: 0,
        consumed: 0,
        remaining: 0,
        reason: "quota_not_configured",
      });
      throw new FoundationError(ApiErrorCode.AGENT_QUOTA_EXCEEDED, "Agent monthly quota is not configured", 429, {
        metric: AGENT_USAGE_METRIC,
        periodStart,
        limit: 0,
        consumed: 0,
        remaining: 0,
      });
    }
    const reservationResult = await options.store.reserveAgentUsage({
      userId: access.user.id,
      metric: AGENT_USAGE_METRIC,
      periodStart,
      idempotencyKey: key,
      requestHash,
      amount: 1,
      limit,
    });
    if (!reservationResult) {
      await auditAgentChat(options.store, access.user.id, "agent.chat.rejected", input.conversationId, {
        metric: AGENT_USAGE_METRIC,
        periodStart,
        limit,
        consumed: Math.max(0, limit),
        remaining: 0,
        reason: "quota_exceeded",
      });
      throw new FoundationError(ApiErrorCode.AGENT_QUOTA_EXCEEDED, "Agent monthly quota has been exhausted", 429, {
        metric: AGENT_USAGE_METRIC,
        periodStart,
        limit,
        consumed: Math.max(0, limit),
        remaining: 0,
      });
    }
    if ("duplicate" in reservationResult) {
      await auditAgentChat(options.store, access.user.id, "agent.chat.rejected", input.conversationId, {
        reason: "idempotency_key_reused",
        requestHashMatches: reservationResult.requestHashMatches,
        reservationId: reservationResult.reservation.id,
      });
      throw new FoundationError(ApiErrorCode.AGENT_IDEMPOTENCY_KEY_REUSED, "Idempotency-Key has already been used", 409, {
        requestHashMatches: reservationResult.requestHashMatches,
        reservationId: reservationResult.reservation.id,
        state: reservationResult.reservation.state,
      });
    }
    const reservation = reservationResult;

    await auditAgentChat(options.store, access.user.id, "agent.chat.requested", input.conversationId, {
      messageChars: input.message.length,
      attachmentCount: input.attachments.length,
      attachmentKinds: input.attachments.map((attachment) => attachment.kind),
      ...(input.canvas ? { canvasNodeCount: input.canvas.nodes.length, canvasEdgeCount: input.canvas.edges.length } : {}),
      usage: usageDetails(reservation),
    });

    const requestProviderApiKey = providerApiKey(request);
    let result: AgentChatResult;
    try {
      result = await options.agentService.chat({
        userId: access.user.id,
        conversationId: input.conversationId,
        message: input.message,
        attachments: input.attachments,
        ...(input.canvas ? { canvas: input.canvas } : {}),
        ...(requestProviderApiKey ? { providerApiKey: requestProviderApiKey } : {}),
      });
    } catch (error) {
      await options.store.finalizeAgentUsage({
        id: reservation.id,
        state: "failed",
        outcome: "provider_error",
        errorCode: error instanceof FoundationError ? error.code : "INTERNAL_ERROR",
      });
      await auditAgentChat(options.store, access.user.id, "agent.chat.failed", input.conversationId, {
        errorCode: error instanceof FoundationError ? error.code : "INTERNAL_ERROR",
        usage: usageDetails(reservation),
      });
      throw error;
    }

    const provider = result.response && typeof result.response === "object" && "provider" in result.response
      ? trustedAgentProvider(result.response.provider)
      : undefined;
    const figureAnalysis = projectFigureAnalysis(result.figureAnalysis);
    const conversationId = result.conversationId ?? input.conversationId;
    let draft: ReturnType<typeof agentChatDraftSummary> | undefined;
    if (figureAnalysis) {
      try {
        const created = await options.figureDraftService.createFromAnalysis(
          access.user.id,
          conversationId,
          figureAnalysis,
        );
        draft = agentChatDraftSummary(created.draft);
      } catch (error) {
        await options.store.finalizeAgentUsage({
          id: reservation.id,
          state: "failed",
          outcome: "draft_error",
          errorCode: error instanceof FoundationError ? error.code : "INTERNAL_ERROR",
        });
        await auditAgentChat(options.store, access.user.id, "agent.chat.failed", conversationId, {
          errorCode: error instanceof FoundationError ? error.code : "INTERNAL_ERROR",
          usage: usageDetails(reservation),
        });
        throw error;
      }
    }
    const finalized = await options.store.finalizeAgentUsage({
      id: reservation.id,
      state: "completed",
      outcome: "completed",
      ...(typeof provider === "string" ? { provider } : {}),
    });
    await auditAgentChat(options.store, access.user.id, "agent.chat.completed", conversationId, {
      status: result.status,
      ...(typeof provider === "string" ? { provider } : {}),
      ...(figureAnalysis ? {
        figureAnalysisStatus: figureAnalysis.status,
        blockingQuestionCount: figureAnalysis.blockingQuestions.length,
        canonicalNodeCount: figureAnalysis.canonicalNetworkIR.nodes.length,
        canonicalEdgeCount: figureAnalysis.canonicalNetworkIR.edges.length,
      } : {}),
      ...(draft ? {
        draftId: draft.id,
        draftRevision: draft.currentRevision,
        draftStatus: draft.status,
      } : {}),
      usage: usageDetails(finalized ?? reservation),
    });

    return {
      conversationId,
      status: result.status,
      stages: result.stages ?? [],
      response: result.response,
      networkIR: result.networkIR ?? null,
      diagram: result.diagram ?? null,
      diagramIntent: result.diagramIntent ?? "replace",
      actions: result.actions ?? { actions: [] },
      ...(figureAnalysis ? { figureAnalysis } : {}),
      ...(draft ? { draft } : {}),
      usage: usageDetails(finalized ?? reservation),
    };
  });

  app.post("/api/admin/auth/login", async (request, reply) => {
    const input = body(request);
    const email = String(input.email ?? "").trim().toLowerCase();
    const valid = email === options.admin.email.toLowerCase() && await verifyPassword(String(input.password ?? ""), options.admin.passwordHash);
    if (!valid) throw new FoundationError(ApiErrorCode.INVALID_CREDENTIALS, "Invalid administrator credentials", 401);
    const sessionId = randomUUID();
    const accessToken = await signAccessToken({ sub: `admin:${email}`, deviceId: "admin-console", sessionId, roles: ["admin"] }, options.sessionSecret, { ttlSeconds: 900 });
    await options.adminService.recordAdminLogin(email);
    return reply.send({ accessToken, admin: { email, roles: ["admin"] } });
  });

  app.get("/api/admin/dashboard", async (request) => {
    await requireAdmin(request, options);
    return await options.adminService.dashboard();
  });

  app.get("/api/admin/users", async (request) => {
    await requireAdmin(request, options);
    return { users: await options.adminService.listUsers() };
  });

  app.post("/api/admin/users/:id/status", async (request) => {
    const claims = await requireAdmin(request, options);
    const id = (request.params as { id: string }).id;
    const input = body(request);
    const user = await options.adminService.setUserStatus(id, String(input.status ?? ""), claims.sub, String(input.reason ?? ""));
    return { user: publicUser(user) };
  });

  app.get("/api/admin/devices", async (request) => {
    await requireAdmin(request, options);
    return { devices: await options.adminService.listDevices() };
  });

  app.post("/api/admin/devices/:id/status", async (request) => {
    const claims = await requireAdmin(request, options);
    const id = (request.params as { id: string }).id;
    const input = body(request);
    const device = await options.adminService.setDeviceStatus(id, String(input.status ?? ""), claims.sub, String(input.reason ?? ""));
    return { device };
  });

  app.get("/api/admin/sessions", async (request) => {
    await requireAdmin(request, options);
    return { sessions: await options.adminService.listSessions() };
  });

  app.get("/api/admin/jobs", async (request) => {
    await requireAdmin(request, options);
    return { jobs: await options.adminService.listJobs() };
  });

  app.get("/api/admin/audit-logs", async (request) => {
    await requireAdmin(request, options);
    return { records: await options.adminService.listAuditRecords() };
  });

  app.post("/api/admin/sessions/:id/revoke", async (request) => {
    const claims = await requireAdmin(request, options);
    const id = (request.params as { id: string }).id;
    const input = body(request);
    return options.adminService.revokeSession(id, claims.sub, String(input.reason ?? ""));
  });
}
