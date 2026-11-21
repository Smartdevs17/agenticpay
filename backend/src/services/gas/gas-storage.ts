/**
 * Persistent storage service for historical gas price data
 * 
 * Provides database operations for storing and retrieving gas price history,
 * network congestion metrics, and accuracy benchmarks.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface GasPriceHistoryEntry {
  network: string;
  chainId: number;
  baseFeeGwei: number;
  priorityFeeGwei?: number;
  gasUsed?: bigint;
  blockNumber?: number;
  timestamp?: Date;
}

export interface NetworkCongestionEntry {
  network: string;
  chainId: number;
  currentBaseFee: number;
  utilizationRate: number;
  pendingTransactions: number;
  congestionScore: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  timestamp?: Date;
}

export interface AccuracyBenchmarkEntry {
  network: string;
  chainId: number;
  operation: string;
  estimatedGas: bigint;
  actualGas: bigint;
  timestamp?: Date;
}

export class GasStorageService {
  /**
   * Store gas price history entry
   */
  async storeGasPriceHistory(entry: GasPriceHistoryEntry): Promise<void> {
    try {
      await prisma.gasPriceHistory.create({
        data: {
          network: entry.network,
          chainId: entry.chainId,
          baseFeeGwei: entry.baseFeeGwei,
          priorityFeeGwei: entry.priorityFeeGwei,
          gasUsed: entry.gasUsed,
          blockNumber: entry.blockNumber,
          timestamp: entry.timestamp || new Date(),
        },
      });
    } catch (error) {
      console.error('Failed to store gas price history:', error);
      throw error;
    }
  }

  /**
   * Batch store gas price history entries
   */
  async batchStoreGasPriceHistory(entries: GasPriceHistoryEntry[]): Promise<void> {
    try {
      await prisma.gasPriceHistory.createMany({
        data: entries.map(entry => ({
          network: entry.network,
          chainId: entry.chainId,
          baseFeeGwei: entry.baseFeeGwei,
          priorityFeeGwei: entry.priorityFeeGwei,
          gasUsed: entry.gasUsed,
          blockNumber: entry.blockNumber,
          timestamp: entry.timestamp || new Date(),
        })),
      });
    } catch (error) {
      console.error('Failed to batch store gas price history:', error);
      throw error;
    }
  }

  /**
   * Get gas price history for a network and chain
   */
  async getGasPriceHistory(
    network: string,
    chainId: number,
    startDate?: Date,
    endDate?: Date,
    limit: number = 100
  ): Promise<GasPriceHistoryEntry[]> {
    try {
      const where: any = {
        network,
        chainId,
      };

      if (startDate || endDate) {
        where.timestamp = {};
        if (startDate) where.timestamp.gte = startDate;
        if (endDate) where.timestamp.lte = endDate;
      }

      const records = await prisma.gasPriceHistory.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
      });

      return records.map((record: any) => ({
        network: record.network,
        chainId: record.chainId,
        baseFeeGwei: Number(record.baseFeeGwei),
        priorityFeeGwei: record.priorityFeeGwei ? Number(record.priorityFeeGwei) : undefined,
        gasUsed: record.gasUsed,
        blockNumber: record.blockNumber,
        timestamp: record.timestamp,
      }));
    } catch (error) {
      console.error('Failed to get gas price history:', error);
      throw error;
    }
  }

  /**
   * Store network congestion metrics
   */
  async storeNetworkCongestion(entry: NetworkCongestionEntry): Promise<void> {
    try {
      await prisma.networkCongestion.create({
        data: {
          network: entry.network,
          chainId: entry.chainId,
          currentBaseFee: entry.currentBaseFee,
          utilizationRate: entry.utilizationRate,
          pendingTransactions: entry.pendingTransactions,
          congestionScore: entry.congestionScore,
          trend: entry.trend,
          timestamp: entry.timestamp || new Date(),
        },
      });
    } catch (error) {
      console.error('Failed to store network congestion:', error);
      throw error;
    }
  }

  /**
   * Get network congestion history
   */
  async getNetworkCongestion(
    network: string,
    chainId: number,
    startDate?: Date,
    endDate?: Date,
    limit: number = 100
  ): Promise<NetworkCongestionEntry[]> {
    try {
      const where: any = {
        network,
        chainId,
      };

      if (startDate || endDate) {
        where.timestamp = {};
        if (startDate) where.timestamp.gte = startDate;
        if (endDate) where.timestamp.lte = endDate;
      }

      const records = await prisma.networkCongestion.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
      });

      return records.map((record: any) => ({
        network: record.network,
        chainId: record.chainId,
        currentBaseFee: Number(record.currentBaseFee),
        utilizationRate: record.utilizationRate,
        pendingTransactions: record.pendingTransactions,
        congestionScore: record.congestionScore,
        trend: record.trend as 'increasing' | 'stable' | 'decreasing',
        timestamp: record.timestamp,
      }));
    } catch (error) {
      console.error('Failed to get network congestion:', error);
      throw error;
    }
  }

  /**
   * Store accuracy benchmark entry
   */
  async storeAccuracyBenchmark(entry: AccuracyBenchmarkEntry): Promise<void> {
    try {
      const errorPct = entry.actualGas > 0n
        ? Math.abs(Number((entry.estimatedGas - entry.actualGas) * 100n / entry.actualGas))
        : 0;

      await prisma.gasAccuracyBenchmark.create({
        data: {
          network: entry.network,
          chainId: entry.chainId,
          operation: entry.operation,
          estimatedGas: entry.estimatedGas,
          actualGas: entry.actualGas,
          errorPct,
          timestamp: entry.timestamp || new Date(),
        },
      });
    } catch (error) {
      console.error('Failed to store accuracy benchmark:', error);
      throw error;
    }
  }

  /**
   * Get accuracy benchmarks for analysis
   */
  async getAccuracyBenchmarks(
    network: string,
    chainId: number,
    operation?: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 100
  ): Promise<Array<AccuracyBenchmarkEntry & { errorPct: number }>> {
    try {
      const where: any = {
        network,
        chainId,
      };

      if (operation) {
        where.operation = operation;
      }

      if (startDate || endDate) {
        where.timestamp = {};
        if (startDate) where.timestamp.gte = startDate;
        if (endDate) where.timestamp.lte = endDate;
      }

      const records = await prisma.gasAccuracyBenchmark.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
      });

      return records.map((record: any) => ({
        network: record.network,
        chainId: record.chainId,
        operation: record.operation,
        estimatedGas: record.estimatedGas,
        actualGas: record.actualGas,
        errorPct: record.errorPct,
        timestamp: record.timestamp,
      }));
    } catch (error) {
      console.error('Failed to get accuracy benchmarks:', error);
      throw error;
    }
  }

  /**
   * Get accuracy statistics for a network/chain/operation
   */
  async getAccuracyStats(
    network: string,
    chainId: number,
    operation?: string
  ): Promise<{
    avgErrorPct: number;
    medianErrorPct: number;
    maxErrorPct: number;
    minErrorPct: number;
    sampleCount: number;
  }> {
    try {
      const where: any = {
        network,
        chainId,
      };

      if (operation) {
        where.operation = operation;
      }

      const records = await prisma.gasAccuracyBenchmark.findMany({
        where,
        select: { errorPct: true },
      });

      if (records.length === 0) {
        return {
          avgErrorPct: 0,
          medianErrorPct: 0,
          maxErrorPct: 0,
          minErrorPct: 0,
          sampleCount: 0,
        };
      }

      const errors = records.map((r: any) => r.errorPct).sort((a: number, b: number) => a - b);
      const avgError = errors.reduce((a: number, b: number) => a + b, 0) / errors.length;
      const medianError = errors[Math.floor(errors.length / 2)];

      return {
        avgErrorPct: avgError,
        medianErrorPct: medianError,
        maxErrorPct: errors[errors.length - 1],
        minErrorPct: errors[0],
        sampleCount: records.length,
      };
    } catch (error) {
      console.error('Failed to get accuracy stats:', error);
      throw error;
    }
  }

  /**
   * Clean up old records to prevent database bloat
   */
  async cleanupOldRecords(retentionDays: number = 30): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Delete old gas price history
      await prisma.gasPriceHistory.deleteMany({
        where: {
          timestamp: {
            lt: cutoffDate,
          },
        },
      });

      // Delete old network congestion records
      await prisma.networkCongestion.deleteMany({
        where: {
          timestamp: {
            lt: cutoffDate,
          },
        },
      });

      // Delete old accuracy benchmarks (keep longer for analysis)
      const benchmarkCutoff = new Date();
      benchmarkCutoff.setDate(benchmarkCutoff.getDate() - retentionDays * 2);
      
      await prisma.gasAccuracyBenchmark.deleteMany({
        where: {
          timestamp: {
            lt: benchmarkCutoff,
          },
        },
      });

      console.log(`Cleaned up gas records older than ${retentionDays} days`);
    } catch (error) {
      console.error('Failed to cleanup old records:', error);
      throw error;
    }
  }

  /**
   * Get aggregated gas price statistics for a time period
   */
  async getAggregatedGasStats(
    network: string,
    chainId: number,
    startDate: Date,
    endDate: Date
  ): Promise<{
    avgBaseFee: number;
    minBaseFee: number;
    maxBaseFee: number;
    avgPriorityFee: number;
    sampleCount: number;
  }> {
    try {
      const records = await prisma.gasPriceHistory.findMany({
        where: {
          network,
          chainId,
          timestamp: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      if (records.length === 0) {
        return {
          avgBaseFee: 0,
          minBaseFee: 0,
          maxBaseFee: 0,
          avgPriorityFee: 0,
          sampleCount: 0,
        };
      }

      const baseFees = records.map((r: any) => Number(r.baseFeeGwei));
      const priorityFees = records
        .map((r: any) => r.priorityFeeGwei ? Number(r.priorityFeeGwei) : 0)
        .filter((f: number) => f > 0);

      return {
        avgBaseFee: baseFees.reduce((a: number, b: number) => a + b, 0) / baseFees.length,
        minBaseFee: Math.min(...baseFees),
        maxBaseFee: Math.max(...baseFees),
        avgPriorityFee: priorityFees.length > 0 
          ? priorityFees.reduce((a: number, b: number) => a + b, 0) / priorityFees.length 
          : 0,
        sampleCount: records.length,
      };
    } catch (error) {
      console.error('Failed to get aggregated gas stats:', error);
      throw error;
    }
  }
}

// Singleton instance
export const gasStorageService = new GasStorageService();
