import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApiErrorCode, FoundationError, type User } from "./domain.js";
import { AdminService } from "./admin-service.js";
import { JobService } from "./job-service.js";
import { SessionService } from "./session-service.js";
import { signAccessToken, verifyAccessToken, verifyPassword } from "./security.js";

interface RouteOptions {
  sessionService: SessionService;
  jobService: JobService;
  adminService: AdminService;
  sessionSecret: string;
  admin: { email: string; passwordHash: string };
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

export function registerRoutes(app: FastifyInstance, options: RouteOptions): void {
  app.get("/health", async () => ({ status: "ok" }));

  app.post("/api/auth/register", async (request, reply) => {
    const input = body(request);
    const user = await options.sessionService.registerUser({ email: String(input.email ?? ""), password: String(input.password ?? "") });
    const deviceInput = input.device;
    const device = deviceInput
      ? await options.sessionService.registerDevice({ userId: user.id, ...deviceInput })
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
    return await options.jobService.cancel(id);
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

  app.get("/api/admin/devices", async (request) => {
    await requireAdmin(request, options);
    return { devices: await options.adminService.listDevices() };
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
