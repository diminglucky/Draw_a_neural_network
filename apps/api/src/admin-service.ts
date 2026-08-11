import { randomUUID } from "node:crypto";
import { ApiErrorCode, FoundationError } from "./domain.js";
import type { FoundationStore } from "./store.js";
import { SessionService } from "./session-service.js";

export class AdminService {
  constructor(private readonly store: FoundationStore, private readonly sessions: SessionService) {}

  async dashboard() {
    const users = await this.store.listUsers();
    const devices = (await Promise.all(users.map((user) => this.store.listDevicesByUser(user.id)))).flat();
    const sessions = await this.store.listSessions();
    const jobs = await this.store.listJobs();
    return {
      users: users.length,
      devices: devices.length,
      activeDevices: devices.filter((device) => device.status === "active").length,
      activeSessions: sessions.filter((session) => session.status === "active").length,
      jobs: jobs.length,
      failedJobs: jobs.filter((job) => job.status === "failed").length,
      auditRecords: (await this.store.listAuditRecords()).length,
    };
  }

  async listUsers() {
    return (await this.store.listUsers()).map(({ passwordHash: _passwordHash, ...user }) => user);
  }

  async listDevices() {
    const users = await this.store.listUsers();
    return (await Promise.all(users.map((user) => this.store.listDevicesByUser(user.id)))).flat();
  }

  async listSessions() {
    return this.store.listSessions();
  }

  async listJobs() {
    return this.store.listJobs();
  }

  async listAuditRecords() {
    return this.store.listAuditRecords();
  }

  async revokeSession(sessionId: string, actorId: string, reason: string) {
    if (!reason.trim()) throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "A reason is required", 400);
    await this.sessions.revokeSession({ sessionId, actorId, reason });
    return { id: sessionId, status: "revoked" };
  }

  async recordAdminLogin(adminId: string): Promise<void> {
    await this.store.createAuditRecord({
      id: randomUUID(),
      actorType: "admin",
      actorId: adminId,
      action: "admin.login",
      targetType: "admin",
      targetId: adminId,
      reason: null,
      metadata: {},
      createdAt: new Date().toISOString(),
    });
  }
}
