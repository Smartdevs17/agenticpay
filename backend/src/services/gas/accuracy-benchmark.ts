/**
 * Gas estimation accuracy benchmarking service
 * 
 * Compares estimated gas costs against actual gas usage to measure
 * prediction accuracy and improve estimation algorithms.
 */

import { gasStorageService } from './gas-storage.js';
import { estimate, type EstimateInput, type GasEstimate } from '../gas.js';

export interface BenchmarkResult {
  operation: string;
  estimatedGas: bigint;
  actualGas: bigint;
  errorPct: number;
  errorGas: bigint;
  timestamp: Date;
}

export interface BenchmarkStats {
  avgErrorPct: number;
  medianErrorPct: number;
  maxErrorPct: number;
  minErrorPct: number;
  sampleCount: number;
  operations: Record<string, {
    avgErrorPct: number;
    sampleCount: number;
  }>;
}

export interface AccuracyReport {
  network: string;
  chainId: number;
  period: {
    start: Date;
    end: Date;
  };
  overall: BenchmarkStats;
  byOperation: Record<string, BenchmarkStats>;
  recommendations: string[];
}

export class GasAccuracyBenchmark {
  /**
   * Record a benchmark comparison
   */
  async recordBenchmark(
    network: string,
    chainId: number,
    operation: string,
    estimatedGas: bigint,
    actualGas: bigint
  ): Promise<BenchmarkResult> {
    const errorGas = estimatedGas > actualGas 
      ? estimatedGas - actualGas 
      : actualGas - estimatedGas;
    
    const errorPct = actualGas > 0n 
      ? Number((errorGas * 100n) / actualGas) 
      : 0;

    await gasStorageService.storeAccuracyBenchmark({
      network,
      chainId,
      operation,
      estimatedGas,
      actualGas,
    });

    return {
      operation,
      estimatedGas,
      actualGas,
      errorPct,
      errorGas,
      timestamp: new Date(),
    };
  }

  /**
   * Benchmark an estimate against actual usage
   */
  async benchmarkEstimate(
    network: string,
    chainId: number,
    estimateInput: EstimateInput,
    actualGas: bigint
  ): Promise<BenchmarkResult> {
    const estimateResult = estimate(estimateInput);
    
    return this.recordBenchmark(
      network,
      chainId,
      estimateInput.operation,
      BigInt(estimateResult.estimated),
      actualGas
    );
  }

  /**
   * Get benchmark statistics for a network and chain
   */
  async getBenchmarkStats(
    network: string,
    chainId: number,
    operation?: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<BenchmarkStats> {
    const stats = await gasStorageService.getAccuracyStats(
      network,
      chainId,
      operation
    );

    // Get per-operation breakdown
    const benchmarks = await gasStorageService.getAccuracyBenchmarks(
      network,
      chainId,
      operation,
      startDate,
      endDate,
      1000
    );

    const operations: Record<string, { avgErrorPct: number; sampleCount: number }> = {};
    
    const grouped = benchmarks.reduce((acc, bench) => {
      if (!acc[bench.operation]) {
        acc[bench.operation] = [];
      }
      acc[bench.operation].push(bench.errorPct);
      return acc;
    }, {} as Record<string, number[]>);

    for (const [op, errors] of Object.entries(grouped)) {
      operations[op] = {
        avgErrorPct: errors.reduce((a, b) => a + b, 0) / errors.length,
        sampleCount: errors.length,
      };
    }

    return {
      ...stats,
      operations,
    };
  }

  /**
   * Generate a comprehensive accuracy report
   */
  async generateAccuracyReport(
    network: string,
    chainId: number,
    startDate: Date,
    endDate: Date
  ): Promise<AccuracyReport> {
    const overall = await this.getBenchmarkStats(network, chainId, undefined, startDate, endDate);
    
    // Get per-operation stats
    const benchmarks = await gasStorageService.getAccuracyBenchmarks(
      network,
      chainId,
      undefined,
      startDate,
      endDate,
      1000
    );

    const byOperation: Record<string, BenchmarkStats> = {};
    const operations = [...new Set(benchmarks.map(b => b.operation))];

    for (const op of operations) {
      byOperation[op] = await this.getBenchmarkStats(network, chainId, op, startDate, endDate);
    }

    // Generate recommendations
    const recommendations = this.generateRecommendations(overall, byOperation);

    return {
      network,
      chainId,
      period: { start: startDate, end: endDate },
      overall,
      byOperation,
      recommendations,
    };
  }

  /**
   * Generate recommendations based on accuracy metrics
   */
  private generateRecommendations(
    overall: BenchmarkStats,
    byOperation: Record<string, BenchmarkStats>
  ): string[] {
    const recommendations: string[] = [];

    if (overall.avgErrorPct > 20) {
      recommendations.push('Overall estimation accuracy is below 80%. Consider recalibrating baseline gas values.');
    }

    if (overall.medianErrorPct > 15) {
      recommendations.push('Median error is high. Review estimation algorithm for systematic bias.');
    }

    for (const [operation, stats] of Object.entries(byOperation)) {
      if (stats.avgErrorPct > 30) {
        recommendations.push(`Operation '${operation}' has poor accuracy (${stats.avgErrorPct.toFixed(1)}% error). Review contract implementation.`);
      }
      
      if (stats.sampleCount < 10) {
        recommendations.push(`Operation '${operation}' has insufficient benchmark data (${stats.sampleCount} samples). Collect more data.`);
      }
    }

    if (overall.maxErrorPct > 100) {
      recommendations.push('Some estimates have >100% error. Investigate edge cases and outliers.');
    }

    if (recommendations.length === 0) {
      recommendations.push('Estimation accuracy is within acceptable ranges. Continue monitoring.');
    }

    return recommendations;
  }

  /**
   * Compare accuracy between different time periods
   */
  async comparePeriods(
    network: string,
    chainId: number,
    period1: { start: Date; end: Date },
    period2: { start: Date; end: Date }
  ): Promise<{
    period1: BenchmarkStats;
    period2: BenchmarkStats;
    change: {
      avgErrorPct: number;
      medianErrorPct: number;
    };
  }> {
    const [stats1, stats2] = await Promise.all([
      this.getBenchmarkStats(network, chainId, undefined, period1.start, period1.end),
      this.getBenchmarkStats(network, chainId, undefined, period2.start, period2.end),
    ]);

    return {
      period1: stats1,
      period2: stats2,
      change: {
        avgErrorPct: stats2.avgErrorPct - stats1.avgErrorPct,
        medianErrorPct: stats2.medianErrorPct - stats1.medianErrorPct,
      },
    };
  }

  /**
   * Identify operations with poor accuracy
   */
  async identifyPoorAccuracy(
    network: string,
    chainId: number,
    threshold: number = 25
  ): Promise<Array<{ operation: string; avgErrorPct: number; sampleCount: number }>> {
    const overall = await this.getBenchmarkStats(network, chainId);
    
    return Object.entries(overall.operations)
      .filter(([_, stats]) => stats.avgErrorPct > threshold)
      .map(([operation, stats]) => ({
        operation,
        avgErrorPct: stats.avgErrorPct,
        sampleCount: stats.sampleCount,
      }))
      .sort((a, b) => b.avgErrorPct - a.avgErrorPct);
  }

  /**
   * Get accuracy trend over time
   */
  async getAccuracyTrend(
    network: string,
    chainId: number,
    operation?: string,
    days: number = 7
  ): Promise<Array<{ date: Date; avgErrorPct: number; sampleCount: number }>> {
    const trend: Array<{ date: Date; avgErrorPct: number; sampleCount: number }> = [];
    
    for (let i = days; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      const stats = await gasStorageService.getAccuracyStats(
        network,
        chainId,
        operation
      );

      trend.push({
        date: startDate,
        avgErrorPct: stats.avgErrorPct,
        sampleCount: stats.sampleCount,
      });
    }

    return trend;
  }

  /**
   * Calibrate baseline values based on benchmark data
   */
  async calibrateBaselines(
    network: string,
    chainId: number,
    operation: string
  ): Promise<{ suggestedBaseline: number; confidence: number }> {
    const benchmarks = await gasStorageService.getAccuracyBenchmarks(
      network,
      chainId,
      operation,
      undefined,
      undefined,
      100
    );

    if (benchmarks.length < 5) {
      return {
        suggestedBaseline: 0,
        confidence: 0,
      };
    }

    const actualGasValues = benchmarks.map(b => Number(b.actualGas));
    const estimatedGasValues = benchmarks.map(b => Number(b.estimatedGas));

    const avgActual = actualGasValues.reduce((a, b) => a + b, 0) / actualGasValues.length;
    const avgEstimated = estimatedGasValues.reduce((a, b) => a + b, 0) / estimatedGasValues.length;

    // Calculate adjustment factor
    const adjustmentFactor = avgActual / avgEstimated;
    
    // Confidence based on sample size and variance
    const variance = actualGasValues.reduce((sum, val) => sum + Math.pow(val - avgActual, 2), 0) / actualGasValues.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariolation = stdDev / avgActual;
    
    const confidence = Math.max(0, Math.min(1, 1 - coefficientOfVariolation)) * Math.min(1, benchmarks.length / 20);

    return {
      suggestedBaseline: Math.round(avgActual),
      confidence,
    };
  }
}

// Singleton instance
export const gasAccuracyBenchmark = new GasAccuracyBenchmark();
