import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApiErrorCode, FoundationError, type User } from "./domain.js";
import { AdminService } from "./admin-service.js";
import { JobService } from "./job-service.js";
import { SessionService } from "./session-service.js";
import { signAccessToken, verifyAccessToken, verifyPassword } from "./security.js";
import type { FoundationStore } from "./store.js";
import type { VisioExecutor } from "./adapters.js";
import type { VisioJobRunner } from "./visio-job-runner.js";
import { parseCanvasSnapshot, type CanvasSnapshot } from "./agent-actions.js";

const MAX_CONVERSATION_ID_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 12_000;
const MAX_ATTACHMENTS = 6;
const MAX_CODE_CHARACTERS = 200_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_PROVIDER_API_KEY_LENGTH = 512;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const AGENT_USAGE_METRIC = "agentChatRequests" as const;

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
  visioExecutor: VisioExecutor;
  visioJobRunner: VisioJobRunner;
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

  app.post("/api/jobs", async (request, reply) => {
    const access = await requireUser(request, options);
    const input = body(request);
    const job = await options.jobService.create({ userId: access.user.id, deviceId: access.device.id, type: input.type, input: input.input });
    return reply.code(201).send(job);
  });

  app.post("/api/visio/export", async (request, reply) => {
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
  });

  app.get("/api/jobs/:id", async (request) => {
    const access = await requireUser(request, options);
    const id = (request.params as { id: string }).id;
    const job = await options.jobService.get(id);
    if (!job || job.userId !== access.user.id) throw new FoundationError(ApiErrorCode.NOT_FOUND, "Job was not found", 404);
    return job;
  });

  app.post("/api/jobs/:id/cancel", async (request) => {
    const access = await requireUser(request, options);
    const id = (request.params as { id: string }).id;
    const job = await options.jobService.get(id);
    if (!job || job.userId !== access.user.id) throw new FoundationError(ApiErrorCode.NOT_FOUND, "Job was not found", 404);
    if (job.type === "visio-export") return await options.visioJobRunner.cancel(id);
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
      ? result.response.provider
      : undefined;
    const finalized = await options.store.finalizeAgentUsage({
      id: reservation.id,
      state: "completed",
      outcome: "completed",
      ...(typeof provider === "string" ? { provider } : {}),
    });
    await auditAgentChat(options.store, access.user.id, "agent.chat.completed", result.conversationId ?? input.conversationId, {
      status: result.status,
      ...(typeof provider === "string" ? { provider } : {}),
      usage: usageDetails(finalized ?? reservation),
    });

    return {
      conversationId: result.conversationId ?? input.conversationId,
      status: result.status,
      stages: result.stages ?? [],
      response: result.response,
      networkIR: result.networkIR ?? null,
      diagram: result.diagram ?? null,
      diagramIntent: result.diagramIntent ?? "replace",
      actions: result.actions ?? { actions: [] },
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
