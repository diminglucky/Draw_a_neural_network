export interface LeaseCoordinator {
  claim(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  renew(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  release(key: string, value: string): Promise<void>;
}

interface LeaseRecord {
  owner: string;
  expiresAt: number;
}

export class InMemoryLeaseCoordinator implements LeaseCoordinator {
  private readonly leases = new Map<string, LeaseRecord>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async claim(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const current = this.leases.get(key);
    if (current && current.expiresAt > this.now().getTime()) return false;
    this.leases.set(key, { owner: value, expiresAt: this.now().getTime() + ttlSeconds * 1000 });
    return true;
  }

  async renew(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const current = this.leases.get(key);
    if (!current || current.owner !== value || current.expiresAt <= this.now().getTime()) return false;
    current.expiresAt = this.now().getTime() + ttlSeconds * 1000;
    return true;
  }

  async release(key: string, value: string): Promise<void> {
    const current = this.leases.get(key);
    if (current?.owner === value) this.leases.delete(key);
  }
}
