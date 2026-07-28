/**
 * Enhanced gas estimation service with dynamic priority fee calculation
 * based on network congestion for both Stellar and EVM chains.
 * 
 * Features:
 * - Historical gas price analysis per chain
 * - Dynamic priority fee calculation with network congestion factor
 * - Gas cost prediction with confidence intervals
 * - Priority fee recommendations (low/medium/high/urgent)
 */

import { GasPriceSample, GasPriceStats, GasPriceRecommendation } from './gas.js';

export type ChainType = 'evm' | 'stellar';
export type PriorityLevel = 'low' | 'medium' | 'high' | 'urgent';

export interface NetworkCongestionMetrics {
  chainId: number;
  chainType: ChainType;
  currentBaseFee: number;
  utilizationRate: number; // 0-1, percentage of block gas used
  pendingTransactions: number;
  congestionScore: number; // 0-100, higher = more congested
  trend: 'increasing' | 'stable' | 'decreasing';
  timestamp?: number;
}

export interface EnhancedGasRecommendation {
  chainId: number;
  chainType: ChainType;
  priorityLevel: PriorityLevel;
  baseFeeGwei: number;
  maxFeePerGasGwei: number;
  maxPriorityFeePerGasGwei: number;
  estimatedWaitTime: number; // seconds
  confidenceInterval: {
    low: number;
    high: number;
    confidence: 'high' | 'medium' | 'low';
  };
  congestionFactor: number;
  timestamp: number;
}

export interface GasPredictionResult {
  chainId: number;
  chainType: ChainType;
  predictedGasPrice: number;
  confidenceInterval: {
    min: number;
    max: number;
    confidence: number; // 0-1
  };
  timeHorizon: number; // seconds
  networkCongestion: NetworkCongestionMetrics;
}

export class GasEstimateService {
  private priceHistory: Map<number, GasPriceSample[]> = new Map();
  private congestionHistory: Map<number, NetworkCongestionMetrics[]> = new Map();
  private maxHistorySize: number = 500;
  private historyWindowMs: number = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Record gas price sample for a specific chain
   */
  recordGasSample(chainId: number, sample: GasPriceSample): void {
    if (!this.priceHistory.has(chainId)) {
      this.priceHistory.set(chainId, []);
    }

    const history = this.priceHistory.get(chainId)!;
    history.push(sample);

    // Trim old samples
    const cutoff = Date.now() - this.historyWindowMs;
    const filtered = history.filter(s => s.timestamp >= cutoff);
    
    // Keep only recent samples up to max size
    if (filtered.length > this.maxHistorySize) {
      filtered.splice(0, filtered.length - this.maxHistorySize);
    }
    
    this.priceHistory.set(chainId, filtered);
  }

  /**
   * Record network congestion metrics
   */
  recordCongestionMetrics(metrics: NetworkCongestionMetrics): void {
    const chainId = metrics.chainId;
    
    if (!this.congestionHistory.has(chainId)) {
      this.congestionHistory.set(chainId, []);
    }

    const history = this.congestionHistory.get(chainId)!;
    history.push(metrics);

    // Trim old samples
    const cutoff = Date.now() - this.historyWindowMs;
    const filtered = history.filter(m => {
      const timestamp = m.timestamp || Date.now();
      return timestamp >= cutoff;
    });
    
    if (filtered.length > this.maxHistorySize) {
      filtered.splice(0, filtered.length - this.maxHistorySize);
    }
    
    this.congestionHistory.set(chainId, filtered);
  }

  /**
   * Calculate network congestion score based on multiple factors
   */
  private calculateCongestionScore(metrics: NetworkCongestionMetrics): number {
    const utilizationWeight = 0.4;
    const pendingTxWeight = 0.3;
    const baseFeeWeight = 0.3;

    // Normalize utilization (0-100)
    const utilizationScore = metrics.utilizationRate * 100;
    
    // Normalize pending transactions (log scale to handle spikes)
    const pendingScore = Math.min(100, Math.log10(metrics.pendingTransactions + 1) * 10);
    
    // Base fee score (relative to typical values)
    const baseFeeScore = Math.min(100, metrics.currentBaseFee / 2);

    const congestionScore = 
      utilizationScore * utilizationWeight +
      pendingScore * pendingTxWeight +
      baseFeeScore * baseFeeWeight;

    return Math.min(100, Math.max(0, congestionScore));
  }

  /**
   * Determine trend from historical data
   */
  private determineTrend(samples: number[]): 'increasing' | 'stable' | 'decreasing' {
    if (samples.length < 3) return 'stable';

    const recent = samples.slice(-10);
    const older = samples.slice(0, -10);

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

    const change = (recentAvg - olderAvg) / olderAvg;

    if (change > 0.1) return 'increasing';
    if (change < -0.1) return 'decreasing';
    return 'stable';
  }

  /**
   * Get current network congestion metrics
   */
  async getCurrentCongestion(chainId: number, chainType: ChainType): Promise<NetworkCongestionMetrics> {
    // In production, this would fetch from blockchain RPC
    // For now, we'll use historical data or defaults
    
    const history = this.congestionHistory.get(chainId);
    const priceHistory = this.priceHistory.get(chainId) || [];
    
    const latestPrice = priceHistory.length > 0 
      ? priceHistory[priceHistory.length - 1].baseFeeGwei 
      : 10;

    const latestCongestion = history && history.length > 0 
      ? history[history.length - 1] 
      : null;

    const utilizationRate = latestCongestion?.utilizationRate || 0.5;
    const pendingTransactions = latestCongestion?.pendingTransactions || 1000;

    const metrics: NetworkCongestionMetrics = {
      chainId,
      chainType,
      currentBaseFee: latestPrice,
      utilizationRate,
      pendingTransactions,
      congestionScore: 0,
      trend: 'stable',
    };

    metrics.congestionScore = this.calculateCongestionScore(metrics);
    
    if (priceHistory.length >= 3) {
      const prices = priceHistory.slice(-20).map(s => s.baseFeeGwei);
      metrics.trend = this.determineTrend(prices);
    }

    return metrics;
  }

  /**
   * Calculate priority fee based on congestion level
   */
  private calculatePriorityFee(
    baseFee: number,
    congestionScore: number,
    priorityLevel: PriorityLevel
  ): number {
    const basePriority = 1.0; // Minimum 1 Gwei
    
    // Congestion multiplier (0-2x based on score 0-100)
    const congestionMultiplier = 1 + (congestionScore / 100);
    
    // Priority level multipliers
    const priorityMultipliers: Record<PriorityLevel, number> = {
      low: 1.0,
      medium: 1.5,
      high: 2.5,
      urgent: 4.0,
    };

    const priorityMultiplier = priorityMultipliers[priorityLevel];
    
    return basePriority * congestionMultiplier * priorityMultiplier;
  }

  /**
   * Calculate confidence interval for gas price prediction
   */
  private calculateConfidenceInterval(
    samples: GasPriceSample[],
    predictedPrice: number,
    confidenceLevel: number = 0.95
  ): { low: number; high: number; confidence: 'high' | 'medium' | 'low' } {
    if (samples.length < 5) {
      const margin = predictedPrice * 0.5;
      return {
        low: Math.max(0, predictedPrice - margin),
        high: predictedPrice + margin,
        confidence: 'low',
      };
    }

    const prices = samples.map(s => s.baseFeeGwei);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);

    // Z-score for 95% confidence
    const zScore = 1.96;
    const margin = zScore * (stdDev / Math.sqrt(samples.length));

    const confidenceRating: 'high' | 'medium' | 'low' = 
      samples.length >= 20 ? 'high' : samples.length >= 10 ? 'medium' : 'low';

    return {
      low: Math.max(0, predictedPrice - margin),
      high: predictedPrice + margin,
      confidence: confidenceRating,
    };
  }

  /**
   * Get enhanced gas recommendation with priority levels
   */
  async getGasRecommendation(
    chainId: number,
    chainType: ChainType,
    priorityLevel: PriorityLevel = 'medium'
  ): Promise<EnhancedGasRecommendation> {
    const congestion = await this.getCurrentCongestion(chainId, chainType);
    const priceHistory = this.priceHistory.get(chainId) || [];
    
    const baseFee = congestion.currentBaseFee;
    const priorityFee = this.calculatePriorityFee(baseFee, congestion.congestionScore, priorityLevel);
    const maxFeePerGas = baseFee * 2 + priorityFee;

    // Estimate wait time based on priority and congestion
    const baseWaitTimes: Record<PriorityLevel, number> = {
      low: 300,      // 5 minutes
      medium: 60,    // 1 minute
      high: 15,     // 15 seconds
      urgent: 5,     // 5 seconds
    };
    
    const congestionDelay = congestion.congestionScore * 2; // Additional delay per congestion point
    const estimatedWaitTime = baseWaitTimes[priorityLevel] + congestionDelay;

    // Calculate confidence interval
    const confidenceInterval = this.calculateConfidenceInterval(priceHistory, baseFee);

    return {
      chainId,
      chainType,
      priorityLevel,
      baseFeeGwei: Math.round(baseFee * 100) / 100,
      maxFeePerGasGwei: Math.round(maxFeePerGas * 100) / 100,
      maxPriorityFeePerGasGwei: Math.round(priorityFee * 100) / 100,
      estimatedWaitTime,
      confidenceInterval,
      congestionFactor: congestion.congestionScore,
      timestamp: Date.now(),
    };
  }

  /**
   * Get gas recommendations for all priority levels
   */
  async getAllPriorityRecommendations(
    chainId: number,
    chainType: ChainType
  ): Promise<EnhancedGasRecommendation[]> {
    const levels: PriorityLevel[] = ['low', 'medium', 'high', 'urgent'];
    
    return Promise.all(
      levels.map(level => this.getGasRecommendation(chainId, chainType, level))
    );
  }

  /**
   * Predict gas price for a future time horizon
   */
  async predictGasPrice(
    chainId: number,
    chainType: ChainType,
    timeHorizonSeconds: number = 60
  ): Promise<GasPredictionResult> {
    const congestion = await this.getCurrentCongestion(chainId, chainType);
    const priceHistory = this.priceHistory.get(chainId) || [];

    // Simple exponential smoothing for prediction
    const alpha = 0.3; // Smoothing factor
    let predictedPrice = congestion.currentBaseFee;

    if (priceHistory.length > 0) {
      const prices = priceHistory.slice(-20).map(s => s.baseFeeGwei);
      
      // Apply exponential smoothing
      for (let i = 1; i < prices.length; i++) {
        predictedPrice = alpha * prices[i] + (1 - alpha) * predictedPrice;
      }

      // Adjust for trend
      if (congestion.trend === 'increasing') {
        predictedPrice *= 1.05;
      } else if (congestion.trend === 'decreasing') {
        predictedPrice *= 0.95;
      }
    }

    // Calculate confidence interval
    const confidenceIntervalData = this.calculateConfidenceInterval(priceHistory, predictedPrice);
    const confidence = confidenceIntervalData.confidence === 'high' ? 0.95 
      : confidenceIntervalData.confidence === 'medium' ? 0.8 : 0.6;

    return {
      chainId,
      chainType,
      predictedGasPrice: Math.round(predictedPrice * 100) / 100,
      confidenceInterval: {
        min: confidenceIntervalData.low,
        max: confidenceIntervalData.high,
        confidence,
      },
      timeHorizon: timeHorizonSeconds,
      networkCongestion: congestion,
    };
  }

  /**
   * Get gas price statistics for a chain
   */
  getGasPriceStats(chainId: number): GasPriceStats {
    const history = this.priceHistory.get(chainId) || [];
    
    if (history.length === 0) {
      return {
        p10: 0,
        p50: 0,
        p90: 0,
        mean: 0,
        min: 0,
        max: 0,
        sampleCount: 0,
        windowMs: this.historyWindowMs,
      };
    }

    const fees = history.map(s => s.baseFeeGwei).sort((a, b) => a - b);
    const mean = fees.reduce((a, b) => a + b, 0) / fees.length;

    return {
      p10: this.percentile(fees, 10),
      p50: this.percentile(fees, 50),
      p90: this.percentile(fees, 90),
      mean,
      min: fees[0],
      max: fees[fees.length - 1],
      sampleCount: fees.length,
      windowMs: this.historyWindowMs,
    };
  }

  /**
   * Check if network is currently surging
   */
  isNetworkSurging(chainId: number, threshold: number = 70): boolean {
    const history = this.congestionHistory.get(chainId);
    
    if (!history || history.length === 0) {
      return false;
    }

    const latest = history[history.length - 1];
    return latest.congestionScore >= threshold;
  }

  /**
   * Get historical samples for a chain
   */
  getHistory(chainId: number): GasPriceSample[] {
    return this.priceHistory.get(chainId) || [];
  }

  /**
   * Clear history for a chain
   */
  clearHistory(chainId: number): void {
    this.priceHistory.delete(chainId);
    this.congestionHistory.delete(chainId);
  }

  /**
   * Helper: Calculate percentile
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[idx];
  }
}

// Singleton instance
export const gasEstimateService = new GasEstimateService();
