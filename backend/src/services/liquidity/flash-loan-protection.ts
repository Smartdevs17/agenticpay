import { prisma } from '../../lib/prisma.js';
import { priceValidator } from './price-validator.js';
import { AppError } from '../../middleware/errorHandler.js';

interface FlashLoanCheckResult {
  passed: boolean;
  priceCheck: {
    executionPrice: number;
    referencePrice: number;
    deviationPct: number;
  };
  circuitBreakerStatus: string;
  twapPrice?: number;
  reason?: string;
}

export class FlashLoanProtectionService {
  private readonly DEFAULT_TWAP_LOOKBACK_MINUTES = 15;
  private readonly MAX_ANOMALIES_BEFORE_CIRCUIT_BREAKER = 5;
  private readonly CIRCUIT_BREAKER_COOLDOWN_MINUTES = 30;

  async checkTransaction(
    tenantId: string,
    poolId: string,
    tokenPair: string,
    executionPrice: number,
    referencePrice: number,
    txHash?: string,
  ): Promise<FlashLoanCheckResult> {
    const circuitBreaker = await this.getCircuitBreakerStatus(poolId, tenantId);
    if (circuitBreaker.status === 'tripped') {
      return {
        passed: false,
        priceCheck: { executionPrice, referencePrice, deviationPct: 0 },
        circuitBreakerStatus: 'tripped',
        reason: `Circuit breaker is active for pool ${poolId}. Transaction rejected.`,
      };
    }

    const priceResult = await priceValidator.validatePrice(
      tenantId, poolId, tokenPair, executionPrice, referencePrice, txHash,
    );

    if (!priceResult.isValid) {
      const recentAnomalies = await priceValidator.getRecentAnomalies(poolId, 60, 'medium');
      const totalAnomalies = recentAnomalies.length;

      if (totalAnomalies >= this.MAX_ANOMALIES_BEFORE_CIRCUIT_BREAKER) {
        await this.triggerCircuitBreaker(
          tenantId, poolId, 'price_deviation',
          `Repeated price anomalies detected: ${totalAnomalies} in last 60 minutes`,
        );
        return {
          passed: false,
          priceCheck: {
            executionPrice: priceResult.executionPrice,
            referencePrice: priceResult.referencePrice,
            deviationPct: priceResult.deviationPct,
          },
          circuitBreakerStatus: 'tripped',
          reason: `Price deviation ${priceResult.deviationPct.toFixed(2)}% exceeds threshold. Circuit breaker engaged.`,
        };
      }

      return {
        passed: false,
        priceCheck: {
          executionPrice: priceResult.executionPrice,
          referencePrice: priceResult.referencePrice,
          deviationPct: priceResult.deviationPct,
        },
        circuitBreakerStatus: 'monitoring',
        reason: priceResult.message,
      };
    }

    return {
      passed: true,
      priceCheck: {
        executionPrice: priceResult.executionPrice,
        referencePrice: priceResult.referencePrice,
        deviationPct: priceResult.deviationPct,
      },
      circuitBreakerStatus: 'monitoring',
    };
  }

  async getTWAPPrice(
    poolId: string,
    lookbackMinutes?: number,
  ): Promise<number | null> {
    const minutes = lookbackMinutes ?? this.DEFAULT_TWAP_LOOKBACK_MINUTES;
    const since = new Date(Date.now() - minutes * 60 * 1000);

    const anomalies = await prisma.priceAnomalyLog.findMany({
      where: {
        poolId,
        detectedAt: { gte: since },
      },
      orderBy: { detectedAt: 'asc' },
    });

    if (anomalies.length === 0) return null;

    const validPrices = anomalies.filter(a => a.referencePrice.gt(0));
    if (validPrices.length === 0) return null;

    const sum = validPrices.reduce((s, a) => s + Number(a.referencePrice), 0);
    return sum / validPrices.length;
  }

  async getCircuitBreakerStatus(poolId: string, tenantId: string) {
    const activeBreaker = await prisma.circuitBreakerEvent.findFirst({
      where: {
        poolId,
        tenantId,
        status: 'tripped',
      },
      orderBy: { triggeredAt: 'desc' },
    });

    if (!activeBreaker) return { status: 'monitoring', event: null };

    const cooldownEnd = new Date(activeBreaker.triggeredAt.getTime() + this.CIRCUIT_BREAKER_COOLDOWN_MINUTES * 60 * 1000);
    if (new Date() > cooldownEnd) {
      await this.recoverCircuitBreaker(activeBreaker.id);
      return { status: 'recovered', event: null };
    }

    return { status: 'tripped', event: activeBreaker };
  }

  async triggerCircuitBreaker(
    tenantId: string,
    poolId: string,
    eventType: string,
    reason: string,
  ) {
    const recentAnomalies = await priceValidator.getRecentAnomalies(poolId, 60);

    return prisma.circuitBreakerEvent.create({
      data: {
        tenantId,
        poolId,
        eventType,
        status: 'tripped',
        anomalyCount: recentAnomalies.length,
        metadata: { reason, triggeredAt: new Date().toISOString() },
      },
    });
  }

  async recoverCircuitBreaker(eventId: string) {
    return prisma.circuitBreakerEvent.update({
      where: { id: eventId },
      data: {
        status: 'recovered',
        recoveredAt: new Date(),
      },
    });
  }

  async getPoolProtectionStatus(poolId: string, tenantId: string) {
    const breaker = await this.getCircuitBreakerStatus(poolId, tenantId);
    const metrics = await priceValidator.getPoolPriceMetrics(poolId, 24);
    const recentAnomalies = await priceValidator.getRecentAnomalies(poolId, 60, 'medium');

    return {
      poolId,
      circuitBreaker: breaker.status,
      circuitBreakerEvent: breaker.event,
      metrics,
      recentAnomalyCount: recentAnomalies.length,
      recentAnomalies: recentAnomalies.slice(0, 10),
    };
  }
}

export const flashLoanProtectionService = new FlashLoanProtectionService();
