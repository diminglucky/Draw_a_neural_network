export interface LeaseResult {
  acquired: boolean;
  fencingToken: number | null;
}

export interface LeaseCoordinator {
  claim(key: string, value: string, ttlSeconds: number): Promise<LeaseResult>;
  renew(key: string, value: string, fencingToken: number, ttlSeconds: number): Promise<LeaseResult>;
  release(key: string, value: string, fencingToken: number): Promise<void>;
}

interface LeaseRecord {
  owner: string;
  fencingToken: number;
  expiresAt: number;
}

export class InMemoryLeaseCoordinator implements LeaseCoordinator {
  private readonly leases = new Map<string, LeaseRecord>();
  private readonly sequences = new Map<string, number>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async claim(key: string, value: string, ttlSeconds: number): Promise<LeaseResult> {
    const current = this.leases.get(key);
    if (current && current.expiresAt > this.now().getTime()) return { acquired: false, fencingToken: null };
    const fencingToken = (this.sequences.get(key) ?? 0) + 1;
    this.sequences.set(key, fencingToken);
    this.leases.set(key, { owner: value, fencingToken, expiresAt: this.now().getTime() + ttlSeconds * 1000 });
    return { acquired: true, fencingToken };
  }

  async renew(key: string, value: string, fencingToken: number, ttlSeconds: number): Promise<LeaseResult> {
    const current = this.leases.get(key);
    if (!current || current.owner !== value || current.fencingToken !== fencingToken || current.expiresAt <= this.now().getTime()) {
      return { acquired: false, fencingToken: null };
    }
    current.expiresAt = this.now().getTime() + ttlSeconds * 1000;
    return { acquired: true, fencingToken: current.fencingToken };
  }

  async release(key: string, value: string, fencingToken: number): Promise<void> {
    const current = this.leases.get(key);
    if (current?.owner === value && current.fencingToken === fencingToken) this.leases.delete(key);
  }
}
