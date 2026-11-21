import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { prisma } from '../../lib/prisma.js';

type RedisCacheClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: 'EX', seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

let redisClient: RedisCacheClient | null = null;
const memoryFallback = new Map<string, { value: string; expiresAt: number }>();

async function getRedis(): Promise<RedisCacheClient | null> {
  if (redisClient !== null) return redisClient;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: true });
    await client.connect();
    redisClient = client as unknown as RedisCacheClient;
    return redisClient;
  } catch {
    return null;
  }
}

function cacheKey(tenantId: string, walletAddress: string, chainId: number): string {
  return `gas:budget:${tenantId}:${walletAddress}:${chainId}`;
}

async function cacheGet(key: string): Promise<string | null> {
  const redis = await getRedis();
  if (redis) return redis.get(key);
  const entry = memoryFallback.get(key);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.value;
}

async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const redis = await getRedis();
  if (redis) { await redis.set(key, value, 'EX', ttlSeconds); return; }
  memoryFallback.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function cacheDel(key: string): Promise<void> {
  const redis = await getRedis();
  if (redis) { await redis.del(key); return; }
  memoryFallback.delete(key);
}

export interface CreateBudgetInput {
  tenantId: string;
  walletAddress: string;
  chainId: number;
  limitGwei: number;
  resetAt: Date;
}

export interface BudgetCheckResult {
  allowed: boolean;
  remainingGwei: number;
  limitGwei: number;
  usedGwei: number;
}

const CACHE_TTL = 300; // 5 minutes

export class GasBudgetManager extends BaseService {
  async upsertBudget(input: CreateBudgetInput): Promise<Result<(typeof prisma)['gasBudget'] extends { upsert: (...a: never[]) => infer R } ? Awaited<R> : unknown>> {
    try {
      const budget = await prisma.gasBudget.upsert({
        where: { tenantId_walletAddress_chainId: { tenantId: input.tenantId, walletAddress: input.walletAddress, chainId: input.chainId } },
        update: { limitGwei: input.limitGwei, resetAt: input.resetAt },
        create: { tenantId: input.tenantId, walletAddress: input.walletAddress, chainId: input.chainId, limitGwei: input.limitGwei, usedGwei: 0, resetAt: input.resetAt },
      });
      await cacheDel(cacheKey(input.tenantId, input.walletAddress, input.chainId));
      return this.ok(budget);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async getBudget(tenantId: string, walletAddress: string, chainId: number): Promise<Result<unknown>> {
    const key = cacheKey(tenantId, walletAddress, chainId);
    const cached = await cacheGet(key);
    if (cached) {
      try { return this.ok(JSON.parse(cached)); } catch { /* fall through to DB */ }
    }

    try {
      const budget = await prisma.gasBudget.findUnique({
        where: { tenantId_walletAddress_chainId: { tenantId, walletAddress, chainId } },
      });
      if (!budget) return this.notFoundFailure('GasBudget', `${walletAddress}:${chainId}`);
      await cacheSet(key, JSON.stringify(budget), CACHE_TTL);
      return this.ok(budget);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async deleteBudget(id: string, tenantId: string): Promise<Result<void>> {
    try {
      const budget = await prisma.gasBudget.findFirst({ where: { id, tenantId, deletedAt: null } });
      if (!budget) return this.notFoundFailure('GasBudget', id);
      await prisma.gasBudget.update({ where: { id }, data: { deletedAt: new Date() } });
      await cacheDel(cacheKey(tenantId, budget.walletAddress, budget.chainId));
      return this.ok(undefined);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async checkBudget(tenantId: string, walletAddress: string, chainId: number, estimatedGwei: number): Promise<Result<BudgetCheckResult>> {
    const result = await this.getBudget(tenantId, walletAddress, chainId);
    if (!result.ok) {
      // No budget configured = no restriction
      return this.ok({ allowed: true, remainingGwei: Infinity, limitGwei: 0, usedGwei: 0 });
    }
    const b = result.value as { limitGwei: number; usedGwei: number; resetAt: string | Date };

    // Auto-reset if past reset date
    const now = new Date();
    const resetAt = new Date(b.resetAt);
    if (now >= resetAt) {
      try {
        await prisma.gasBudget.update({
          where: { tenantId_walletAddress_chainId: { tenantId, walletAddress, chainId } },
          data: { usedGwei: 0 },
        });
      } catch { /* best-effort reset */ }
      return this.ok({ allowed: estimatedGwei <= b.limitGwei, remainingGwei: b.limitGwei - estimatedGwei, limitGwei: b.limitGwei, usedGwei: 0 });
    }

    const remaining = b.limitGwei - b.usedGwei;
    return this.ok({
      allowed: estimatedGwei <= remaining,
      remainingGwei: remaining,
      limitGwei: b.limitGwei,
      usedGwei: b.usedGwei,
    });
  }

  async recordUsage(tenantId: string, walletAddress: string, chainId: number, usedGwei: number): Promise<Result<void>> {
    try {
      await prisma.gasBudget.update({
        where: { tenantId_walletAddress_chainId: { tenantId, walletAddress, chainId } },
        data: { usedGwei: { increment: usedGwei } },
      });
      await cacheDel(cacheKey(tenantId, walletAddress, chainId));
      return this.ok(undefined);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }
}

export const gasBudgetManager = new GasBudgetManager();
