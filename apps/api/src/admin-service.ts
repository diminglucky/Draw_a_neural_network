import { randomUUID } from "node:crypto";
import { ApiErrorCode, FoundationError } from "./domain.js";
import type { FoundationStore } from "./store.js";
import { SessionService } from "./session-service.js";

export class AdminService {
  constructor(private readonly store: FoundationStore, private readonly sessions: SessionService) {}

  dashboard() {
    const users = this.store.listUsers();
    const devices = users.flatMap((user) => this.store.listDevicesByUser(user.id));
    const sessions = this.store.listSessions();
    const jobs = this.store.listJobs();
    return {
      users: users.length,
      devices: devices.length,
      activeDevices: devices.filter((device) => device.status === "active").length,
      activeSessions: sessions.filter((session) => session.status === "active").length,
      jobs: jobs.length,
      failedJobs: jobs.filter((job) => job.status === "failed").length,
      auditRecords: this.store.listAuditRecords().length,
    };
  }

  listUsers() {
    return this.store.listUsers().map(({ passwordHash: _passwordHash, ...user }) => user);
  }

  listDevices() {
    return this.store.listUsers().flatMap((user) => this.store.listDevicesByUser(user.id));
  }

  listSessions() {
    return this.store.listSessions();
  }

  listJobs() {
    return this.store.listJobs();
  }

  listAuditRecords() {
    return this.store.listAuditRecords();
  }

  async revokeSession(sessionId: string, actorId: string, reason: string) {
    if (!reason.trim()) throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "A reason is required", 400);
    await this.sessions.revokeSession({ sessionId, actorId, reason });
    return { id: sessionId, status: "revoked" };
  }

  recordAdminLogin(adminId: string) {
    this.store.createAuditRecord({
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
