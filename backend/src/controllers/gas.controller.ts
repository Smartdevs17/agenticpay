import { Route, Get, Post, Delete, Query, Path, Body, Tags, OperationId } from 'tsoa';
import { gasEstimateService } from '../services/gasEstimate.js';
import { gasAccuracyBenchmark } from '../services/gas/accuracy-benchmark.js';
import { gasStorageService } from '../services/gas/gas-storage.js';
import { getGasEstimateCache } from '../services/gas/cache-service.js';

interface NetworkCongestionMetrics {
  chainId: number;
  chainType: 'evm' | 'stellar';
  currentBaseFee: number;
  utilizationRate: number;
  pendingTransactions: number;
  congestionScore: number;
  trend: 'increasing' | 'stable' | 'decreasing';
}

interface EnhancedGasRecommendation {
  chainId: number;
  chainType: 'evm' | 'stellar';
  priorityLevel: 'low' | 'medium' | 'high' | 'urgent';
  baseFeeGwei: number;
  maxFeePerGasGwei: number;
  maxPriorityFeePerGasGwei: number;
  estimatedWaitTime: number;
  confidenceInterval: {
    low: number;
    high: number;
    confidence: 'high' | 'medium' | 'low';
  };
  congestionFactor: number;
  timestamp: number;
}

interface GasPredictionResult {
  chainId: number;
  chainType: 'evm' | 'stellar';
  predictedGasPrice: number;
  confidenceInterval: {
    min: number;
    max: number;
    confidence: number;
  };
  timeHorizon: number;
  networkCongestion: NetworkCongestionMetrics;
}

interface GasPriceHistoryEntry {
  network: string;
  chainId: number;
  baseFeeGwei: number;
  priorityFeeGwei?: number;
  gasUsed?: string;
  blockNumber?: number;
  timestamp: Date;
}

interface BenchmarkResult {
  operation: string;
  estimatedGas: string;
  actualGas: string;
  errorPct: number;
  errorGas: string;
  timestamp: Date;
}

interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalKeys: number;
}

@Tags('Gas')
@Route('gas')
export class GasController {
  /**
   * Get current network congestion metrics
   */
  @Get('congestion/{chainId}')
  @OperationId('getGasCongestion')
  public async getCongestion(
    @Path() chainId: number,
    @Query('chainType') chainType: 'evm' | 'stellar' = 'evm'
  ): Promise<NetworkCongestionMetrics> {
    return await gasEstimateService.getCurrentCongestion(chainId, chainType);
  }

  /**
   * Get gas recommendation for specific priority level
   */
  @Get('recommendation/{chainId}')
  @OperationId('getGasRecommendation')
  public async getRecommendation(
    @Path() chainId: number,
    @Query('chainType') chainType: 'evm' | 'stellar' = 'evm',
    @Query('priority') priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium'
  ): Promise<EnhancedGasRecommendation> {
    return await gasEstimateService.getGasRecommendation(chainId, chainType, priority);
  }

  /**
   * Get all priority level recommendations
   */
  @Get('recommendations/{chainId}/all')
  @OperationId('getAllGasRecommendations')
  public async getAllRecommendations(
    @Path() chainId: number,
    @Query('chainType') chainType: 'evm' | 'stellar' = 'evm'
  ): Promise<EnhancedGasRecommendation[]> {
    return await gasEstimateService.getAllPriorityRecommendations(chainId, chainType);
  }

  /**
   * Predict gas price for future time horizon
   */
  @Get('predict/{chainId}')
  @OperationId('predictGasPrice')
  public async predictGasPrice(
    @Path() chainId: number,
    @Query('chainType') chainType: 'evm' | 'stellar' = 'evm',
    @Query('horizon') timeHorizon: number = 60
  ): Promise<GasPredictionResult> {
    return await gasEstimateService.predictGasPrice(chainId, chainType, timeHorizon);
  }

  /**
   * Check if network is surging
   */
  @Get('surge/{chainId}')
  @OperationId('isNetworkSurging')
  public async isSurging(
    @Path() chainId: number,
    @Query('threshold') threshold: number = 70
  ): Promise<{ surging: boolean; chainId: number; threshold: number }> {
    const surging = gasEstimateService.isNetworkSurging(chainId, threshold);
    return { surging, chainId, threshold };
  }

  /**
   * Get gas price history
   */
  @Get('history/{chainId}')
  @OperationId('getGasPriceHistory')
  public async getHistory(
    @Path() chainId: number,
    @Query('network') network: string = 'ethereum',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit: number = 100
  ): Promise<GasPriceHistoryEntry[]> {
    const history = await gasStorageService.getGasPriceHistory(
      network,
      chainId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      limit
    );
    return history.map(entry => ({
      network: entry.network,
      chainId: entry.chainId,
      baseFeeGwei: entry.baseFeeGwei,
      priorityFeeGwei: entry.priorityFeeGwei,
      gasUsed: entry.gasUsed?.toString(),
      blockNumber: entry.blockNumber,
      timestamp: entry.timestamp || new Date(),
    }));
  }

  /**
   * Store gas price history entry
   */
  @Post('history')
  @OperationId('storeGasPriceHistory')
  public async storeHistory(
    @Body() body: {
      network: string;
      chainId: number;
      baseFeeGwei: number;
      priorityFeeGwei?: number;
      gasUsed?: string;
      blockNumber?: number;
    }
  ): Promise<{ recorded: boolean }> {
    await gasStorageService.storeGasPriceHistory({
      network: body.network,
      chainId: body.chainId,
      baseFeeGwei: body.baseFeeGwei,
      priorityFeeGwei: body.priorityFeeGwei,
      gasUsed: body.gasUsed ? BigInt(body.gasUsed) : undefined,
      blockNumber: body.blockNumber,
    });
    return { recorded: true };
  }

  /**
   * Record accuracy benchmark
   */
  @Post('benchmark')
  @OperationId('recordGasBenchmark')
  public async recordBenchmark(
    @Body() body: {
      network: string;
      chainId: number;
      operation: string;
      estimatedGas: string;
      actualGas: string;
    }
  ): Promise<BenchmarkResult> {
    const result = await gasAccuracyBenchmark.recordBenchmark(
      body.network,
      body.chainId,
      body.operation,
      BigInt(body.estimatedGas),
      BigInt(body.actualGas)
    );
    return {
      operation: result.operation,
      estimatedGas: result.estimatedGas.toString(),
      actualGas: result.actualGas.toString(),
      errorPct: result.errorPct,
      errorGas: result.errorGas.toString(),
      timestamp: result.timestamp,
    };
  }

  /**
   * Get cache statistics
   */
  @Get('cache/stats')
  @OperationId('getCacheStats')
  public async getCacheStats(): Promise<CacheStats> {
    const cache = getGasEstimateCache();
    return await cache.getStats();
  }

  /**
   * Clear cache
   */
  @Delete('cache')
  @OperationId('clearCache')
  public async clearCache(): Promise<{ cleared: boolean }> {
    const cache = getGasEstimateCache();
    await cache.clear();
    return { cleared: true };
  }
}
