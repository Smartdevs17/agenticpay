/**
 * Issue #487 — Repository factory
 *
 * Resolves the correct Repository<T> implementation based on configuration.
 */

import type { Repository } from './interfaces/Repository.js';
import { PrismaRepository } from './implementations/PrismaRepository.js';
import { RedisRepository } from './implementations/RedisRepository.js';
import { TimescaleRepository } from './implementations/TimescaleRepository.js';
import type Redis from 'ioredis';

export type RepositoryBackend = 'prisma' | 'redis' | 'timescale';

interface PgPool {
  query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrismaDelegate = any;

export interface RepositoryFactoryOptions {
  backend: RepositoryBackend;
  /** Required when backend === 'prisma' */
  prismaDelegate?: AnyPrismaDelegate;
  /** Required when backend === 'redis' */
  redis?: Redis;
  redisPrefix?: string;
  redisTtlSec?: number;
  /** Required when backend === 'timescale' */
  pgPool?: PgPool;
  table?: string;
}

export function createRepository<T extends { id: string }>(
  opts: RepositoryFactoryOptions,
): Repository<T> {
  switch (opts.backend) {
    case 'prisma':
      if (!opts.prismaDelegate) throw new Error('prismaDelegate required for prisma backend');
      return new PrismaRepository<T>(opts.prismaDelegate);

    case 'redis':
      if (!opts.redis) throw new Error('redis client required for redis backend');
      return new RedisRepository<T>(opts.redis, opts.redisPrefix ?? 'entity', opts.redisTtlSec);

    case 'timescale':
      if (!opts.pgPool) throw new Error('pgPool required for timescale backend');
      if (!opts.table) throw new Error('table required for timescale backend');
      return new TimescaleRepository<T>(opts.pgPool, opts.table);

    default:
      throw new Error(`Unknown repository backend: ${String(opts.backend)}`);
  }
}
