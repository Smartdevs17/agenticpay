import { describe, it, expect } from 'vitest';
import { DatabasePoolManager } from '../pool.js';

describe('DatabasePoolManager with PgBouncer optimization', () => {
  it('initializes default pool configurations from config', () => {
    const manager = new DatabasePoolManager();
    const cfg = manager.getConfig();

    expect(cfg.min).toBeGreaterThanOrEqual(1);
    expect(cfg.max).toBeGreaterThanOrEqual(cfg.min);
    expect(cfg.idleTimeoutMillis).toBeGreaterThan(0);
    expect(cfg.connectionTimeoutMillis).toBeGreaterThan(0);
  });

  it('adjusts Prisma connection parameters when PgBouncer is enabled', () => {
    const manager = new DatabasePoolManager({
      connectionString: 'postgresql://postgres:secret@rds-proxy.internal:5432/agenticpay',
      pgbouncer: true,
      max: 15,
      connectionTimeoutMillis: 10000,
    });

    expect(manager.isPgBouncerOptimized()).toBe(true);
    const prismaUrl = manager.getPrismaDatabaseUrl();
    expect(prismaUrl).toContain('pgbouncer=true');
    expect(prismaUrl).toContain('connection_limit=15');
    expect(prismaUrl).toContain('pool_timeout=10');
  });

  it('tracks active and idle connection stats upon acquire and release', async () => {
    const manager = new DatabasePoolManager({ min: 5, max: 10 });
    const initialStats = manager.getStats();
    expect(initialStats.activeCount).toBe(0);

    const conn = await manager.acquire();
    const acquiredStats = manager.getStats();
    expect(acquiredStats.activeCount).toBe(1);

    conn.release();
    const releasedStats = manager.getStats();
    expect(releasedStats.activeCount).toBe(0);
  });

  it('performs health check and reports latency and stats', async () => {
    const manager = new DatabasePoolManager();
    const health = await manager.checkHealth();

    expect(health.healthy).toBe(true);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    expect(health.stats).toBeDefined();
  });
});
