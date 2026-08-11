import { randomUUID } from "node:crypto";
import { ApiErrorCode, FoundationError, type AuditRecord, type Device, type Session, type Subscription, type User } from "./domain.js";
import { hashPassword, signAccessToken, verifyAccessToken, verifyPassword } from "./security.js";
import type { FoundationStore } from "./store.js";

interface SessionServiceOptions {
  store: FoundationStore;
  now?: () => Date;
  leaseSeconds: number;
  accessTokenTtlSeconds: number;
  sessionSecret: string;
}

export class SessionService {
  private readonly now: () => Date;

  constructor(private readonly options: SessionServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async registerUser(input: { email: string; password: string }): Promise<User> {
    const email = input.email.trim().toLowerCase();
    if (await this.options.store.findUserByEmail(email)) {
      throw new FoundationError(ApiErrorCode.EMAIL_ALREADY_REGISTERED, "Email is already registered", 409);
    }
    const user: User = {
      id: randomUUID(),
      email,
      passwordHash: await hashPassword(input.password),
      status: "active",
      roles: ["user"],
      createdAt: this.now().toISOString(),
      lastLoginAt: null,
    };
    await this.options.store.createUser(user);
    const subscription: Subscription = {
      id: randomUUID(),
      userId: user.id,
      plan: "trial",
      status: "trialing",
      startsAt: user.createdAt,
      endsAt: null,
      features: ["foundation"],
      limits: { foundationJobsPerMonth: 10 },
    };
    await this.options.store.createSubscription(subscription);
    await this.audit("system", null, "user.registered", "user", user.id, null, { email });
    return user;
  }

  async registerDevice(input: {
    userId: string;
    name: string;
    publicKey: string;
    fingerprintHash: string;
    clientVersion: string;
    osVersion: string;
  }): Promise<Device> {
    const user = await this.options.store.getUser(input.userId);
    if (!user) throw new FoundationError(ApiErrorCode.USER_NOT_FOUND, "User was not found", 404);
    const device: Device = {
      id: randomUUID(),
      userId: user.id,
      name: input.name.trim() || "Windows device",
      publicKey: input.publicKey,
      fingerprintHash: input.fingerprintHash,
      status: "active",
      clientVersion: input.clientVersion,
      osVersion: input.osVersion,
      createdAt: this.now().toISOString(),
      lastSeenAt: null,
    };
    await this.options.store.createDevice(device);
    await this.audit("user", user.id, "device.registered", "device", device.id, null, { name: device.name });
    return device;
  }

  async login(input: { email: string; password: string; deviceId: string }): Promise<{ user: User; device: Device; session: Session; accessToken: string }> {
    const user = await this.options.store.findUserByEmail(input.email);
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new FoundationError(ApiErrorCode.INVALID_CREDENTIALS, "Invalid email or password", 401);
    }
    if (user.status !== "active") throw new FoundationError(ApiErrorCode.USER_DISABLED, "User is not active", 403);
    const device = await this.options.store.getDevice(input.deviceId);
    if (!device || device.userId !== user.id || device.status !== "active") {
      throw new FoundationError(ApiErrorCode.DEVICE_NOT_AUTHORIZED, "Device is not authorized for this user", 403);
    }
    const now = this.now();
    const session: Session = {
      id: randomUUID(),
      userId: user.id,
      deviceId: device.id,
      status: "active",
      accessTokenId: randomUUID(),
      startedAt: now.toISOString(),
      lastHeartbeatAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + this.options.leaseSeconds * 1000).toISOString(),
      revokedAt: null,
    };
    if (!(await this.options.store.claimActiveSession(user.id, session, now))) {
      throw new FoundationError(ApiErrorCode.ACCOUNT_ALREADY_IN_USE, "Account is already active on another device", 409);
    }
    user.lastLoginAt = now.toISOString();
    await this.options.store.updateUser(user);
    device.lastSeenAt = now.toISOString();
    await this.options.store.updateDevice(device);
    const accessToken = await signAccessToken(
      { sub: user.id, deviceId: device.id, sessionId: session.id, roles: user.roles },
      this.options.sessionSecret,
      { ttlSeconds: this.options.accessTokenTtlSeconds },
    );
    await this.audit("user", user.id, "session.created", "session", session.id, null, { deviceId: device.id });
    return { user, device, session, accessToken };
  }

  async heartbeat(input: { sessionId: string; accessToken: string }): Promise<Session> {
    const claims = await this.verifySessionToken(input.accessToken);
    if (claims.sessionId !== input.sessionId) throw new FoundationError(ApiErrorCode.INVALID_TOKEN, "Token does not match session", 401);
    const session = await this.options.store.getSession(input.sessionId);
    if (!session) throw new FoundationError(ApiErrorCode.SESSION_NOT_FOUND, "Session was not found", 404);
    const now = this.now();
    await this.assertLiveSession(session, now);
    session.lastHeartbeatAt = now.toISOString();
    session.leaseExpiresAt = new Date(now.getTime() + this.options.leaseSeconds * 1000).toISOString();
    await this.options.store.updateSession(session);
    const device = await this.options.store.getDevice(session.deviceId);
    if (device) {
      device.lastSeenAt = now.toISOString();
      await this.options.store.updateDevice(device);
    }
    return session;
  }

  async getCurrentAccess(accessToken: string): Promise<{ user: User; device: Device; session: Session; subscription: Subscription | null }> {
    const claims = await this.verifySessionToken(accessToken);
    const session = await this.options.store.getSession(claims.sessionId);
    if (!session) throw new FoundationError(ApiErrorCode.SESSION_NOT_FOUND, "Session was not found", 404);
    await this.assertLiveSession(session, this.now());
    const user = await this.options.store.getUser(session.userId);
    const device = await this.options.store.getDevice(session.deviceId);
    if (!user) throw new FoundationError(ApiErrorCode.USER_NOT_FOUND, "User was not found", 404);
    if (!device) throw new FoundationError(ApiErrorCode.DEVICE_NOT_FOUND, "Device was not found", 404);
    return { user, device, session, subscription: await this.options.store.getCurrentSubscription(user.id) };
  }

  async logout(input: { sessionId: string; accessToken: string }): Promise<void> {
    const claims = await this.verifySessionToken(input.accessToken);
    if (claims.sessionId !== input.sessionId) throw new FoundationError(ApiErrorCode.INVALID_TOKEN, "Token does not match session", 401);
    const session = await this.options.store.getSession(input.sessionId);
    if (!session) return;
    session.status = "logged_out";
    session.revokedAt = this.now().toISOString();
    await this.options.store.updateSession(session);
    await this.audit("user", session.userId, "session.logged_out", "session", session.id, null, {});
  }

  async revokeSession(input: { sessionId: string; actorId: string; reason: string }): Promise<void> {
    const session = await this.options.store.getSession(input.sessionId);
    if (!session) throw new FoundationError(ApiErrorCode.SESSION_NOT_FOUND, "Session was not found", 404);
    session.status = "revoked";
    session.revokedAt = this.now().toISOString();
    await this.options.store.updateSession(session);
    await this.audit("admin", input.actorId, "session.revoked", "session", session.id, input.reason, { userId: session.userId, deviceId: session.deviceId });
  }

  private async verifySessionToken(token: string) {
    try {
      return await verifyAccessToken(token, this.options.sessionSecret);
    } catch {
      throw new FoundationError(ApiErrorCode.INVALID_TOKEN, "Access token is invalid", 401);
    }
  }

  private async assertLiveSession(session: Session, now: Date): Promise<void> {
    if (session.status === "revoked" || session.status === "logged_out") {
      throw new FoundationError(ApiErrorCode.SESSION_REVOKED, "Session is no longer active", 401);
    }
    if (session.status !== "active" || new Date(session.leaseExpiresAt).getTime() <= now.getTime()) {
      session.status = "expired";
      await this.options.store.updateSession(session);
      throw new FoundationError(ApiErrorCode.SESSION_EXPIRED, "Session lease has expired", 401);
    }
  }

  private async audit(actorType: AuditRecord["actorType"], actorId: string | null, action: string, targetType: string, targetId: string | null, reason: string | null, metadata: Record<string, unknown>): Promise<void> {
    await this.options.store.createAuditRecord({
      id: randomUUID(),
      actorType,
      actorId,
      action,
      targetType,
      targetId,
      reason,
      metadata,
      createdAt: this.now().toISOString(),
    });
  }
}
