import type { AuditRecord, Device, Job, Session, Subscription, User } from "./domain.js";

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
  getSession(id: string): Promise<Session | null>;
  listSessions(): Promise<Session[]>;
  getActiveSessionByUser(userId: string): Promise<Session | null>;
  createSession(session: Session): Promise<Session>;
  updateSession(session: Session, expectedFencingToken?: number): Promise<Session | null>;
  claimActiveSession(userId: string, session: Session, now: Date): Promise<boolean>;
  createSubscription(subscription: Subscription): Promise<Subscription>;
  getCurrentSubscription(userId: string): Promise<Subscription | null>;
  createJob(job: Job): Promise<Job>;
  getJob(id: string): Promise<Job | null>;
  listJobs(): Promise<Job[]>;
  updateJob(job: Job): Promise<Job>;
  createAuditRecord(record: AuditRecord): Promise<AuditRecord>;
  listAuditRecords(): Promise<AuditRecord[]>;
}

export class InMemoryFoundationStore implements FoundationStore {
  private readonly users = new Map<string, User>();
  private readonly devices = new Map<string, Device>();
  private readonly sessions = new Map<string, Session>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly jobs = new Map<string, Job>();
  private readonly audits: AuditRecord[] = [];

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
    if (expectedFencingToken !== undefined && (!current || current.leaseFencingToken !== expectedFencingToken)) return null;
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
}
