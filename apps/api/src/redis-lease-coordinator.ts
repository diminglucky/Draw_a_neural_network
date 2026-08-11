import type { LeaseCoordinator, LeaseResult } from "./lease-coordinator.js";

export interface RedisEvalOptions {
  keys: string[];
  arguments: string[];
}

export interface RedisClientLike {
  eval(script: string, options: RedisEvalOptions): Promise<unknown>;
  quit(): Promise<void>;
}

export const CLAIM_LEASE_SCRIPT = `
  if redis.call('EXISTS', KEYS[1]) == 1 then
    return { 0, 0 }
  end
  local token = redis.call('INCR', KEYS[2])
  redis.call('HSET', KEYS[1], 'owner', ARGV[1], 'token', token)
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return { 1, token }
`;

export const RENEW_LEASE_SCRIPT = `
  if redis.call('EXISTS', KEYS[1]) == 0 then
    return { 0, 0 }
  end
  if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] then
    return { 0, 0 }
  end
  if redis.call('HGET', KEYS[1], 'token') ~= ARGV[2] then
    return { 0, 0 }
  end
  redis.call('PEXPIRE', KEYS[1], ARGV[3])
  return { 1, tonumber(ARGV[2]) }
`;

export const RELEASE_LEASE_SCRIPT = `
  if redis.call('EXISTS', KEYS[1]) == 0 then
    return 0
  end
  if redis.call('HGET', KEYS[1], 'owner') ~= ARGV[1] then
    return 0
  end
  if redis.call('HGET', KEYS[1], 'token') ~= ARGV[2] then
    return 0
  end
  return redis.call('DEL', KEYS[1])
`;

function result(raw: unknown): LeaseResult {
  if (!Array.isArray(raw) || raw.length < 2) throw new Error("Redis lease script returned an invalid result");
  if (Number(raw[0]) !== 1) return { acquired: false, fencingToken: null };
  const fencingToken = Number(raw[1]);
  if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) throw new Error("Redis lease script returned an invalid fencing token");
  return { acquired: true, fencingToken };
}

function ttlMilliseconds(ttlSeconds: number): string {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new Error("Lease TTL must be positive");
  return String(Math.max(1, Math.floor(ttlSeconds * 1000)));
}

export class RedisLeaseCoordinator implements LeaseCoordinator {
  private readonly prefix: string;

  constructor(private readonly client: RedisClientLike, options: { prefix?: string } = {}) {
    this.prefix = (options.prefix ?? "synapse:lease").replace(/:+$/, "");
  }

  async claim(key: string, owner: string, ttlSeconds: number): Promise<LeaseResult> {
    const leaseKey = this.key(key);
    const raw = await this.client.eval(CLAIM_LEASE_SCRIPT, {
      keys: [leaseKey, `${leaseKey}:seq`],
      arguments: [owner, ttlMilliseconds(ttlSeconds)],
    });
    return result(raw);
  }

  async renew(key: string, owner: string, fencingToken: number, ttlSeconds: number): Promise<LeaseResult> {
    if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) throw new Error("Fencing token must be a positive integer");
    const raw = await this.client.eval(RENEW_LEASE_SCRIPT, {
      keys: [this.key(key)],
      arguments: [owner, String(fencingToken), ttlMilliseconds(ttlSeconds)],
    });
    return result(raw);
  }

  async release(key: string, owner: string, fencingToken: number): Promise<void> {
    if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) throw new Error("Fencing token must be a positive integer");
    await this.client.eval(RELEASE_LEASE_SCRIPT, {
      keys: [this.key(key)],
      arguments: [owner, String(fencingToken)],
    });
  }

  private key(key: string): string {
    return `${this.prefix}:${key}`;
  }
}
