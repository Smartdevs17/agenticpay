/**
 * quota.ts — Issue #1024
 *
 * Provider quota tracking and rate limiting to prevent exhausting
 * provider quotas during failed payout retries.
 */

export interface QuotaConfig {
  maxRequestsPerHour: number;
  maxRequestsPerDay: number;
  burstLimit: number;
}

export interface QuotaUsage {
  providerId: string;
  hourlyCount: number;
  dailyCount: number;
  lastResetHour: number;
  lastResetDay: number;
  burstRemaining: number;
}

const DEFAULT_QUOTAS: Record<string, QuotaConfig> = {
  stripe: {
    maxRequestsPerHour: 1000,
    maxRequestsPerDay: 20000,
    burstLimit: 50,
  },
  stellar: {
    maxRequestsPerHour: 500,
    maxRequestsPerDay: 10000,
    burstLimit: 25,
  },
  solana: {
    maxRequestsPerHour: 300,
    maxRequestsPerDay: 7200,
    burstLimit: 10,
  },
};

export class QuotaService {
  private quotaUsage: Map<string, QuotaUsage> = new Map();
  private quotaConfigs: Map<string, QuotaConfig> = new Map();

  constructor() {
    this.initializeQuotas();
  }

  private initializeQuotas(): void {
    for (const [provider, config] of Object.entries(DEFAULT_QUOTAS)) {
      this.quotaConfigs.set(provider, config);
      this.quotaUsage.set(provider, {
        providerId: provider,
        hourlyCount: 0,
        dailyCount: 0,
        lastResetHour: Date.now(),
        lastResetDay: Date.now(),
        burstRemaining: config.burstLimit,
      });
    }
  }

  private resetHourlyIfNeeded(usage: QuotaUsage, config: QuotaConfig): void {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    if (now - usage.lastResetHour > hourMs) {
      usage.hourlyCount = 0;
      usage.lastResetHour = now;
      usage.burstRemaining = config.burstLimit;
    }
  }

  private resetDailyIfNeeded(usage: QuotaUsage): void {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    if (now - usage.lastResetDay > dayMs) {
      usage.dailyCount = 0;
      usage.lastResetDay = now;
    }
  }

  canMakeRequest(providerId: string, isBurst: boolean = false): boolean {
    const config = this.quotaConfigs.get(providerId);
    const usage = this.quotaUsage.get(providerId);

    if (!config || !usage) {
      return true;
    }

    this.resetHourlyIfNeeded(usage, config);
    this.resetDailyIfNeeded(usage);

    if (isBurst && usage.burstRemaining > 0) {
      return true;
    }

    return (
      usage.hourlyCount < config.maxRequestsPerHour &&
      usage.dailyCount < config.maxRequestsPerDay
    );
  }

  recordRequest(providerId: string, isBurst: boolean = false): void {
    const usage = this.quotaUsage.get(providerId);
    const config = this.quotaConfigs.get(providerId);

    if (!usage || !config) {
      return;
    }

    this.resetHourlyIfNeeded(usage, config);
    this.resetDailyIfNeeded(usage);

    usage.hourlyCount++;
    usage.dailyCount++;

    if (isBurst && usage.burstRemaining > 0) {
      usage.burstRemaining--;
    }
  }

  getUsage(providerId: string): QuotaUsage | undefined {
    return this.quotaUsage.get(providerId);
  }

  setQuotaConfig(providerId: string, config: Partial<QuotaConfig>): void {
    const existing = this.quotaConfigs.get(providerId);
    if (existing) {
      this.quotaConfigs.set(providerId, { ...existing, ...config });
    }
  }

  getQuotaConfig(providerId: string): QuotaConfig | undefined {
    return this.quotaConfigs.get(providerId);
  }

  resetAll(): void {
    this.quotaUsage.clear();
    this.initializeQuotas();
  }
}

export const quotaService = new QuotaService();
