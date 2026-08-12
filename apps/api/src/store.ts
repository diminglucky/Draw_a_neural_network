import { randomUUID } from "node:crypto";
import type {
  AgentUsageDuplicate,
  AgentUsageFinalizationInput,
  AgentUsageReservation,
  AgentUsageReservationInput,
  AuditRecord,
  Device,
  DeviceChallenge,
  Job,
  Session,
  Subscription,
  User,
  VisioJobCreationResult,
} from "./domain.js";

export interface FoundationStore {
  createUser(user: User): Promise<User>;
  findUserByEmail(email: string): Promise<User | null>;
  getUser(id: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  updateUser(user: User): Promise<User>;
  createDevice(device: Device): Promise<Device>;
  getDevice(id: string): Promise<Device | null>;
  listDevicesByUser(userId: string): Promise<Device[]>;
  updateDevice(device: Device): Promise<Device>;
  createDeviceChallenge(challenge: DeviceChallenge): Promise<DeviceChallenge>;
  getDeviceChallenge(id: string): Promise<DeviceChallenge | null>;
  consumeDeviceChallenge(id: string, now: Date): Promise<DeviceChallenge | null>;
  getSession(id: string): Promise<Session | null>;
  listSessions(): Promise<Session[]>;
  getActiveSessionByUser(userId: string): Promise<Session | null>;
  createSession(session: Session): Promise<Session>;
  updateSession(session: Session, expectedFencingToken?: number): Promise<Session | null>;
  claimActiveSession(userId: string, session: Session, now: Date): Promise<boolean>;
  createSubscription(subscription: Subscription): Promise<Subscription>;
  getCurrentSubscription(userId: string): Promise<Subscription | null>;
  createJob(job: Job): Promise<Job>;
  createVisioJobIdempotent(input: { job: Job; idempotencyKey: string; requestHash: string }): Promise<VisioJobCreationResult>;
  getJob(id: string): Promise<Job | null>;
  listJobs(): Promise<Job[]>;
  updateJob(job: Job): Promise<Job>;
  createAuditRecord(record: AuditRecord): Promise<AuditRecord>;
  listAuditRecords(): Promise<AuditRecord[]>;
  reserveAgentUsage(input: AgentUsageReservationInput): Promise<AgentUsageReservation | AgentUsageDuplicate | null>;
  finalizeAgentUsage(input: AgentUsageFinalizationInput): Promise<AgentUsageReservation | null>;
}

export class InMemoryFoundationStore implements FoundationStore {
  private readonly users = new Map<string, User>();
  private readonly devices = new Map<string, Device>();
  private readonly deviceChallenges = new Map<string, DeviceChallenge>();
  private readonly sessions = new Map<string, Session>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly jobs = new Map<string, Job>();
  private readonly visioJobsByIdempotency = new Map<string, string>();
  private readonly audits: AuditRecord[] = [];
  private readonly agentUsagePeriods = new Map<string, { limit: number; consumed: number }>();
  private readonly agentUsageReservations = new Map<string, AgentUsageReservation>();
  private readonly agentUsageByIdempotency = new Map<string, string>();

  async createUser(user: User): Promise<User> {
    this.users.set(user.id, user);
    return user;
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    return [...this.users.values()].find((user) => user.email === normalized) ?? null;
  }

  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async listUsers(): Promise<User[]> {
    return [...this.users.values()];
  }

  async updateUser(user: User): Promise<User> {
    this.users.set(user.id, user);
    return user;
  }

  async createDevice(device: Device): Promise<Device> {
    this.devices.set(device.id, device);
    return device;
  }

  async getDevice(id: string): Promise<Device | null> {
    return this.devices.get(id) ?? null;
  }

  async listDevicesByUser(userId: string): Promise<Device[]> {
    return [...this.devices.values()].filter((device) => device.userId === userId);
  }

  async updateDevice(device: Device): Promise<Device> {
    this.devices.set(device.id, device);
    return device;
  }

  async createDeviceChallenge(challenge: DeviceChallenge): Promise<DeviceChallenge> {
    this.deviceChallenges.set(challenge.id, challenge);
    return challenge;
  }

  async getDeviceChallenge(id: string): Promise<DeviceChallenge | null> {
    return this.deviceChallenges.get(id) ?? null;
  }

  async consumeDeviceChallenge(id: string, now: Date): Promise<DeviceChallenge | null> {
    const challenge = this.deviceChallenges.get(id);
    if (!challenge || challenge.consumedAt || new Date(challenge.expiresAt).getTime() <= now.getTime()) return null;
    challenge.consumedAt = now.toISOString();
    this.deviceChallenges.set(id, challenge);
    return challenge;
  }

  async getSession(id: string): Promise<Session | null> {
    return this.sessions.get(id) ?? null;
  }

  async listSessions(): Promise<Session[]> {
    return [...this.sessions.values()];
  }

  async getActiveSessionByUser(userId: string): Promise<Session | null> {
    return [...this.sessions.values()].find((session) => session.userId === userId && session.status === "active") ?? null;
  }

  async createSession(session: Session): Promise<Session> {
    this.sessions.set(session.id, session);
    return session;
  }

  async updateSession(session: Session, expectedFencingToken?: number): Promise<Session | null> {
    const current = this.sessions.get(session.id);
    if (expectedFencingToken !== undefined && (!current || current.status !== "active" || current.leaseFencingToken !== expectedFencingToken)) return null;
    this.sessions.set(session.id, session);
    return session;
  }

  async claimActiveSession(userId: string, session: Session, now: Date): Promise<boolean> {
    const active = [...this.sessions.values()].find((item) => item.userId === userId && item.status === "active") ?? null;
    if (active) {
      if (new Date(active.leaseExpiresAt).getTime() > now.getTime()) return false;
      active.status = "expired";
      this.sessions.set(active.id, active);
    }
    this.sessions.set(session.id, session);
    return true;
  }

  async createSubscription(subscription: Subscription): Promise<Subscription> {
    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  async getCurrentSubscription(userId: string): Promise<Subscription | null> {
    return [...this.subscriptions.values()].find((item) => item.userId === userId && ["trialing", "active"].includes(item.status)) ?? null;
  }

  async createJob(job: Job): Promise<Job> {
    this.jobs.set(job.id, job);
    return job;
  }

  async createVisioJobIdempotent(input: { job: Job; idempotencyKey: string; requestHash: string }): Promise<VisioJobCreationResult> {
    const index = `${input.job.userId}:${input.job.type}:${input.idempotencyKey}`;
    const existingId = this.visioJobsByIdempotency.get(index);
    if (existingId) {
      const existing = this.jobs.get(existingId);
      if (existing) {
        const existingInput = existing.input && typeof existing.input === "object" ? existing.input as Record<string, unknown> : {};
        return { job: existing, duplicate: true, requestHashMatches: existingInput.requestHash === input.requestHash };
      }
      this.visioJobsByIdempotency.delete(index);
    }
    this.jobs.set(input.job.id, input.job);
    this.visioJobsByIdempotency.set(index, input.job.id);
    return { job: input.job, duplicate: false, requestHashMatches: true };
  }

  async getJob(id: string): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }

  async listJobs(): Promise<Job[]> {
    return [...this.jobs.values()];
  }

  async updateJob(job: Job): Promise<Job> {
    this.jobs.set(job.id, job);
    return job;
  }

  async createAuditRecord(record: AuditRecord): Promise<AuditRecord> {
    this.audits.push(record);
    return record;
  }

  async listAuditRecords(): Promise<AuditRecord[]> {
    return [...this.audits];
  }

  async reserveAgentUsage(input: AgentUsageReservationInput): Promise<AgentUsageReservation | AgentUsageDuplicate | null> {
    const idempotencyIndex = `${input.userId}:${input.idempotencyKey}`;
    const existingId = this.agentUsageByIdempotency.get(idempotencyIndex);
    if (existingId) {
      const reservation = this.agentUsageReservations.get(existingId);
      if (!reservation) return null;
      return {
        duplicate: true,
        requestHashMatches: reservation.requestHash === input.requestHash,
        reservation,
      };
    }

    const periodIndex = `${input.userId}:${input.metric}:${input.periodStart}`;
    const period = this.agentUsagePeriods.get(periodIndex) ?? { limit: input.limit, consumed: 0 };
    if (period.limit <= 0 || period.consumed + input.amount > period.limit) return null;

    period.consumed += input.amount;
    this.agentUsagePeriods.set(periodIndex, period);
    const reservation: AgentUsageReservation = {
      id: randomUUID(),
      userId: input.userId,
      metric: input.metric,
      periodStart: input.periodStart,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      amount: input.amount,
      limit: period.limit,
      consumed: period.consumed,
      remaining: Math.max(0, period.limit - period.consumed),
      state: "accepted",
      outcome: null,
      provider: null,
      errorCode: null,
      createdAt: new Date().toISOString(),
      finalizedAt: null,
    };
    this.agentUsageReservations.set(reservation.id, reservation);
    this.agentUsageByIdempotency.set(idempotencyIndex, reservation.id);
    return reservation;
  }

  async finalizeAgentUsage(input: AgentUsageFinalizationInput): Promise<AgentUsageReservation | null> {
    const current = this.agentUsageReservations.get(input.id);
    if (!current) return null;
    if (current.state !== "accepted") return current;
    const finalized: AgentUsageReservation = {
      ...current,
      state: input.state,
      outcome: input.outcome,
      provider: input.provider ?? current.provider,
      errorCode: input.errorCode ?? current.errorCode,
      finalizedAt: input.finalizedAt ?? new Date().toISOString(),
    };
    this.agentUsageReservations.set(input.id, finalized);
    return finalized;
  }
}
