import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

describe('Docker integration services', () => {
  it('connects to PostgreSQL and Redis provided by the integration environment', async () => {
    const prisma = new PrismaClient();
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

    try {
      const result = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
      expect(result[0]?.ok).toBe(1);
      expect(await redis.ping()).toBe('PONG');
    } finally {
      await prisma.$disconnect();
      await redis.quit();
    }
  });
});