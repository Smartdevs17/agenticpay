/**
 * Issue #487 — Redis cache-backed repository
 *
 * Stores serialised JSON in Redis hashes. Suitable for session/cache workloads.
 */

import type Redis from 'ioredis';
import type { FindManyOptions, Repository } from '../interfaces/Repository.js';

export class RedisRepository<T extends { id: string }> implements Repository<T> {
  /**
   * @param redis  — connected ioredis client
   * @param prefix — Redis key prefix, e.g. "session"  → keys like "session:{id}"
   * @param ttlSec — optional TTL in seconds; no expiry if omitted
   */
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
    private readonly ttlSec?: number,
  ) {}

  private key(id: string): string {
    return `${this.prefix}:${id}`;
  }

  async findById(id: string): Promise<T | null> {
    const raw = await this.redis.get(this.key(id));
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async findMany(options: FindManyOptions<T> = {}): Promise<T[]> {
    const keys = await this.redis.keys(`${this.prefix}:*`);
    if (keys.length === 0) return [];

    const raws = await this.redis.mget(...keys);
    let items = raws
      .filter((r): r is string => r !== null)
      .map((r) => JSON.parse(r) as T);

    if (options.where) {
      const filter = options.where;
      items = items.filter((item) =>
        (Object.entries(filter) as [keyof T, unknown][]).every(([k, v]) => item[k] === v),
      );
    }

    const offset = options.offset ?? 0;
    const limit = options.limit ?? items.length;
    return items.slice(offset, offset + limit);
  }

  async create(data: Omit<T, 'id'>): Promise<T> {
    const id = `${this.prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const entity = { ...data, id } as T;
    if (this.ttlSec) {
      await this.redis.setex(this.key(id), this.ttlSec, JSON.stringify(entity));
    } else {
      await this.redis.set(this.key(id), JSON.stringify(entity));
    }
    return entity;
  }

  async update(id: string, data: Partial<T>): Promise<T | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const updated: T = { ...existing, ...data, id };
    if (this.ttlSec) {
      await this.redis.setex(this.key(id), this.ttlSec, JSON.stringify(updated));
    } else {
      await this.redis.set(this.key(id), JSON.stringify(updated));
    }
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.redis.del(this.key(id));
    return result > 0;
  }

  async query(_raw: string, _params?: unknown[]): Promise<T[]> {
    throw new Error('Raw queries are not supported by RedisRepository');
  }
}
