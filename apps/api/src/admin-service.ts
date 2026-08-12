import { randomUUID } from "node:crypto";
import { ApiErrorCode, FoundationError } from "./domain.js";
import type { FoundationStore } from "./store.js";
import { SessionService } from "./session-service.js";

type AdminMutableStatus = "active" | "disabled";

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

  async setUserStatus(userId: string, status: string, actorId: string, reason: string) {
    const nextStatus = this.validateStatus(status, reason);
    const user = await this.store.getUser(userId);
    if (!user) throw new FoundationError(ApiErrorCode.USER_NOT_FOUND, "User was not found", 404);

    const updatedUser = await this.store.updateUser({ ...user, status: nextStatus });
    if (nextStatus === "disabled") {
      await this.revokeAffectedSessions((session) => session.userId === user.id, actorId, reason);
    }
    await this.audit(actorId, `user.${nextStatus}`, "user", user.id, reason, { status: nextStatus });
    return updatedUser;
  }

  async setDeviceStatus(deviceId: string, status: string, actorId: string, reason: string) {
    const nextStatus = this.validateStatus(status, reason);
    const device = await this.store.getDevice(deviceId);
    if (!device) throw new FoundationError(ApiErrorCode.DEVICE_NOT_FOUND, "Device was not found", 404);

    const updatedDevice = await this.store.updateDevice({ ...device, status: nextStatus });
    if (nextStatus === "disabled") {
      await this.revokeAffectedSessions((session) => session.deviceId === device.id, actorId, reason);
    }
    await this.audit(actorId, `device.${nextStatus}`, "device", device.id, reason, { status: nextStatus, userId: device.userId });
    return updatedDevice;
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

  private validateStatus(status: string, reason: string): AdminMutableStatus {
    if (!reason.trim()) throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "A reason is required", 400);
    if (status !== "active" && status !== "disabled") {
      throw new FoundationError(ApiErrorCode.VALIDATION_FAILED, "Status must be active or disabled", 400);
    }
    return status;
  }

  private async revokeAffectedSessions(predicate: (session: { userId: string; deviceId: string; status: string }) => boolean, actorId: string, reason: string): Promise<void> {
    const sessions = await this.store.listSessions();
    for (const session of sessions) {
      if (session.status === "active" && predicate(session)) {
        await this.sessions.revokeSession({ sessionId: session.id, actorId, reason });
      }
    }
  }

  private async audit(actorId: string, action: string, targetType: string, targetId: string, reason: string, metadata: Record<string, unknown>): Promise<void> {
    await this.store.createAuditRecord({
      id: randomUUID(),
      actorType: "admin",
      actorId,
      action,
      targetType,
      targetId,
      reason,
      metadata,
      createdAt: new Date().toISOString(),
    });
  }
}
