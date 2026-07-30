import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';

export interface QuotaConfig {
  requestsPerHour: number;
  requestsPerDay: number;
  alertAt50Pct: boolean;
  alertAt80Pct: boolean;
  alertAt100Pct: boolean;
}

export class QuotaManagerService {
  async getOrCreateQuota(keyId: string): Promise<QuotaConfig> {
    let quota = await prisma.apiKeyQuota.findUnique({ where: { keyId } });
    if (!quota) {
      quota = await prisma.apiKeyQuota.create({
        data: { keyId },
      });
    }
    return {
      requestsPerHour: quota.requestsPerHour,
      requestsPerDay: quota.requestsPerDay,
      alertAt50Pct: quota.alertAt50Pct,
      alertAt80Pct: quota.alertAt80Pct,
      alertAt100Pct: quota.alertAt100Pct,
    };
  }

  async updateQuota(keyId: string, data: Partial<QuotaConfig>) {
    return prisma.apiKeyQuota.upsert({
      where: { keyId },
      create: { keyId, ...data },
      update: data,
    });
  }

  async getUsageSummary(keyId: string) {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 3600_000);
    const dayAgo = new Date(now.getTime() - 86400_000);

    const [hourlyCount, dailyCount, recentUsage, quota] = await Promise.all([
      prisma.apiKeyUsage.count({
        where: { keyId, recordedAt: { gte: hourAgo } },
      }),
      prisma.apiKeyUsage.count({
        where: { keyId, recordedAt: { gte: dayAgo } },
      }),
      prisma.apiKeyUsage.findMany({
        where: { keyId, recordedAt: { gte: dayAgo } },
        orderBy: { recordedAt: 'desc' },
        take: 100,
      }),
      prisma.apiKeyQuota.findUnique({ where: { keyId } }),
    ]);

    return {
      keyId,
      hourlyCount,
      dailyCount,
      hourlyLimit: quota?.requestsPerHour ?? 1000,
      dailyLimit: quota?.requestsPerDay ?? 10000,
      usage: recentUsage,
    };
  }

  /**
   * Issue #631 (minimal slice): request counts for a given key, bucketed by
   * calendar day, for the last `days` days. Deferred: dashboard UI,
   * forecasting/trending, alerts, and cross-key comparison tools — those
   * remain follow-up work on top of this counting primitive.
   */
  async getDailyUsage(keyId: string, days = 7) {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));

    const usage = await prisma.apiKeyUsage.findMany({
      where: { keyId, recordedAt: { gte: since } },
      select: { recordedAt: true },
    });

    const counts = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setUTCDate(d.getUTCDate() + i);
      counts.set(d.toISOString().slice(0, 10), 0);
    }

    for (const row of usage) {
      const day = row.recordedAt.toISOString().slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }

    return Array.from(counts.entries()).map(([date, count]) => ({ date, count }));
  }

  async getTenantUsageSummary(tenantId: string) {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 3600_000);

    const [totalHourly, keys, topEndpoints] = await Promise.all([
      prisma.apiKeyUsage.count({
        where: { tenantId, recordedAt: { gte: hourAgo } },
      }),
      prisma.apiKey.findMany({
        where: { tenantId, isActive: true },
        include: {
          _count: { select: { usage: true } },
          quota: true,
        },
      }),
      prisma.apiKeyUsage.groupBy({
        by: ['endpoint'],
        where: { tenantId, recordedAt: { gte: hourAgo } },
        _count: { id: true },
        _avg: { latencyMs: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      totalHourlyRequests: totalHourly,
      activeKeys: keys.length,
      keys,
      topEndpoints,
    };
  }
}

export const quotaManagerService = new QuotaManagerService();
