import type { AuditRecord, Device, Job, Session, Subscription, User } from "./domain.js";

export interface FoundationStore {
  createUser(user: User): User;
  findUserByEmail(email: string): User | null;
  getUser(id: string): User | null;
  listUsers(): User[];
  updateUser(user: User): User;
  createDevice(device: Device): Device;
  getDevice(id: string): Device | null;
  listDevicesByUser(userId: string): Device[];
  updateDevice(device: Device): Device;
  getSession(id: string): Session | null;
  listSessions(): Session[];
  getActiveSessionByUser(userId: string): Session | null;
  createSession(session: Session): Session;
  updateSession(session: Session): Session;
  claimActiveSession(userId: string, session: Session, now: Date): boolean;
  createSubscription(subscription: Subscription): Subscription;
  getCurrentSubscription(userId: string): Subscription | null;
  createJob(job: Job): Job;
  getJob(id: string): Job | null;
  listJobs(): Job[];
  updateJob(job: Job): Job;
  createAuditRecord(record: AuditRecord): AuditRecord;
  listAuditRecords(): AuditRecord[];
}

export class InMemoryFoundationStore implements FoundationStore {
  private readonly users = new Map<string, User>();
  private readonly devices = new Map<string, Device>();
  private readonly sessions = new Map<string, Session>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly jobs = new Map<string, Job>();
  private readonly audits: AuditRecord[] = [];

  createUser(user: User): User {
    this.users.set(user.id, user);
    return user;
  }

  findUserByEmail(email: string): User | null {
    const normalized = email.trim().toLowerCase();
    return [...this.users.values()].find((user) => user.email === normalized) ?? null;
  }

  getUser(id: string): User | null {
    return this.users.get(id) ?? null;
  }

  listUsers(): User[] {
    return [...this.users.values()];
  }

  updateUser(user: User): User {
    this.users.set(user.id, user);
    return user;
  }

  createDevice(device: Device): Device {
    this.devices.set(device.id, device);
    return device;
  }

  getDevice(id: string): Device | null {
    return this.devices.get(id) ?? null;
  }

  listDevicesByUser(userId: string): Device[] {
    return [...this.devices.values()].filter((device) => device.userId === userId);
  }

  updateDevice(device: Device): Device {
    this.devices.set(device.id, device);
    return device;
  }

  getSession(id: string): Session | null {
    return this.sessions.get(id) ?? null;
  }

  listSessions(): Session[] {
    return [...this.sessions.values()];
  }

  getActiveSessionByUser(userId: string): Session | null {
    return [...this.sessions.values()].find((session) => session.userId === userId && session.status === "active") ?? null;
  }

  createSession(session: Session): Session {
    this.sessions.set(session.id, session);
    return session;
  }

  updateSession(session: Session): Session {
    this.sessions.set(session.id, session);
    return session;
  }

  claimActiveSession(userId: string, session: Session, now: Date): boolean {
    const active = this.getActiveSessionByUser(userId);
    if (active) {
      if (new Date(active.leaseExpiresAt).getTime() > now.getTime()) return false;
      active.status = "expired";
      this.sessions.set(active.id, active);
    }
    this.sessions.set(session.id, session);
    return true;
  }

  createSubscription(subscription: Subscription): Subscription {
    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  getCurrentSubscription(userId: string): Subscription | null {
    return [...this.subscriptions.values()].find((item) => item.userId === userId && ["trialing", "active"].includes(item.status)) ?? null;
  }

  createJob(job: Job): Job {
    this.jobs.set(job.id, job);
    return job;
  }

  getJob(id: string): Job | null {
    return this.jobs.get(id) ?? null;
  }

  listJobs(): Job[] {
    return [...this.jobs.values()];
  }

  updateJob(job: Job): Job {
    this.jobs.set(job.id, job);
    return job;
  }

  createAuditRecord(record: AuditRecord): AuditRecord {
    this.audits.push(record);
    return record;
  }

  listAuditRecords(): AuditRecord[] {
    return [...this.audits];
  }
}
