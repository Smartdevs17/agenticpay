import { prisma } from '../../lib/prisma.js';

interface PriceValidationResult {
  isValid: boolean;
  executionPrice: number;
  referencePrice: number;
  deviationPct: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
}

export class PriceValidator {
  private readonly DEFAULT_DEVIATION_THRESHOLD = 5; // 5%
  private readonly WARNING_THRESHOLD = 3; // 3%

  async validatePrice(
    tenantId: string,
    poolId: string,
    tokenPair: string,
    executionPrice: number,
    referencePrice: number,
    txHash?: string,
    customThreshold?: number,
  ): Promise<PriceValidationResult> {
    if (referencePrice <= 0) {
      return {
        isValid: false,
        executionPrice,
        referencePrice,
        deviationPct: 100,
        severity: 'critical',
        message: 'Reference price is zero or negative, cannot validate',
      };
    }

    const deviationPct = Math.abs(((executionPrice - referencePrice) / referencePrice) * 100);
    const threshold = customThreshold ?? this.DEFAULT_DEVIATION_THRESHOLD;

    let severity: PriceValidationResult['severity'] = 'low';
    let isValid = true;
    let message = `Price deviation ${deviationPct.toFixed(2)}% within threshold ${threshold}%`;

    if (deviationPct > threshold) {
      isValid = false;
      severity = deviationPct > 15 ? 'critical' : deviationPct > 10 ? 'high' : 'medium';
      message = `Price deviation ${deviationPct.toFixed(2)}% exceeds threshold ${threshold}%`;
    } else if (deviationPct > this.WARNING_THRESHOLD) {
      severity = 'low';
      message = `Price deviation ${deviationPct.toFixed(2)}% exceeds warning threshold ${this.WARNING_THRESHOLD}%`;
    }

    await prisma.priceAnomalyLog.create({
      data: {
        tenantId,
        poolId,
        tokenPair,
        executionPrice,
        referencePrice,
        deviationPct,
        txHash,
        severity,
        metadata: {
          threshold,
          warningThreshold: this.WARNING_THRESHOLD,
          isValid,
          message,
        },
      },
    });

    return { isValid, executionPrice, referencePrice, deviationPct, severity, message };
  }

  async getRecentAnomalies(
    poolId: string,
    minutes: number = 60,
    minSeverity?: string,
  ) {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    const where: any = {
      poolId,
      detectedAt: { gte: since },
    };
    if (minSeverity) {
      where.severity = { in: ['medium', 'high', 'critical'] };
    }
    return prisma.priceAnomalyLog.findMany({
      where,
      orderBy: { detectedAt: 'desc' },
    });
  }

  async getPoolPriceMetrics(poolId: string, hours: number = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const anomalies = await prisma.priceAnomalyLog.findMany({
      where: {
        poolId,
        detectedAt: { gte: since },
      },
      orderBy: { detectedAt: 'asc' },
    });

    if (anomalies.length === 0) return null;

    const totalDeviations = anomalies.length;
    const criticalCount = anomalies.filter(a => a.severity === 'critical').length;
    const highCount = anomalies.filter(a => a.severity === 'high').length;
    const avgDeviation = anomalies.reduce((s, a) => s + a.deviationPct, 0) / anomalies.length;
    const maxDeviation = Math.max(...anomalies.map(a => a.deviationPct));

    return {
      poolId,
      periodHours: hours,
      totalAnomalies: totalDeviations,
      criticalCount,
      highCount,
      avgDeviationPct: parseFloat(avgDeviation.toFixed(2)),
      maxDeviationPct: parseFloat(maxDeviation.toFixed(2)),
      lastAnomaly: anomalies[anomalies.length - 1],
    };
  }
}

export const priceValidator = new PriceValidator();
