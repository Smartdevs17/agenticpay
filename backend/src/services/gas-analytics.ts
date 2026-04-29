// Gas analytics and aggregation service
import {
  GasTransaction,
  GasAggregation,
  GasAnomaly,
  OptimizationRecommendation,
  GasTrendData,
  NetworkCostComparison,
} from '../types/gas.js';

export class GasAnalytics {
  private transactions: GasTransaction[] = [];
  private anomalyThreshold = 2.5; // Standard deviations

  addTransactions(txs: GasTransaction[]): void {
    this.transactions.push(...txs);
  }

  aggregateByPeriod(
    period: 'hour' | 'day' | 'week' | 'month',
    startDate?: Date,
    endDate?: Date
  ): GasAggregation[] {
    const filtered = this.filterByDateRange(startDate, endDate);
    const grouped = this.groupByPeriod(filtered, period);

    return Array.from(grouped.entries()).map(([periodKey, txs]) => {
      const totalGasUsed = txs.reduce((sum, tx) => sum + tx.gasUsed, BigInt(0));
      const totalCostWei = txs.reduce((sum, tx) => sum + tx.totalCost, BigInt(0));
      const totalCostUSD = txs.reduce((sum, tx) => sum + (tx.totalCostUSD || 0), 0);
      const successCount = txs.filter(tx => tx.status === 'success').length;

      return {
        period: periodKey,
        network: txs[0]?.network || 'unknown',
        totalTransactions: txs.length,
        totalGasUsed,
        totalCostWei,
        totalCostUSD,
        avgGasUsed: totalGasUsed / BigInt(txs.length || 1),
        avgCostWei: totalCostWei / BigInt(txs.length || 1),
        avgCostUSD: totalCostUSD / (txs.length || 1),
        minGasUsed: txs.reduce((min, tx) => (tx.gasUsed < min ? tx.gasUsed : min), txs[0]?.gasUsed || BigInt(0)),
        maxGasUsed: txs.reduce((max, tx) => (tx.gasUsed > max ? tx.gasUsed : max), BigInt(0)),
        successRate: txs.length > 0 ? successCount / txs.length : 0,
      };
    });
  }

  aggregateByContract(contractAddress?: string): GasAggregation[] {
    const filtered = contractAddress
      ? this.transactions.filter(tx => tx.contractAddress === contractAddress)
      : this.transactions;

    const grouped = new Map<string, GasTransaction[]>();
    filtered.forEach(tx => {
      const key = tx.contractAddress;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(tx);
    });

    return Array.from(grouped.entries()).map(([address, txs]) => {
      const totalGasUsed = txs.reduce((sum, tx) => sum + tx.gasUsed, BigInt(0));
      const totalCostWei = txs.reduce((sum, tx) => sum + tx.totalCost, BigInt(0));
      const totalCostUSD = txs.reduce((sum, tx) => sum + (tx.totalCostUSD || 0), 0);
      const successCount = txs.filter(tx => tx.status === 'success').length;

      return {
        period: 'all-time',
        network: txs[0]?.network || 'unknown',
        contractAddress: address,
        totalTransactions: txs.length,
        totalGasUsed,
        totalCostWei,
        totalCostUSD,
        avgGasUsed: totalGasUsed / BigInt(txs.length || 1),
        avgCostWei: totalCostWei / BigInt(txs.length || 1),
        avgCostUSD: totalCostUSD / (txs.length || 1),
        minGasUsed: txs.reduce((min, tx) => (tx.gasUsed < min ? tx.gasUsed : min), txs[0]?.gasUsed || BigInt(0)),
        maxGasUsed: txs.reduce((max, tx) => (tx.gasUsed > max ? tx.gasUsed : max), BigInt(0)),
        successRate: txs.length > 0 ? successCount / txs.length : 0,
      };
    });
  }

  compareNetworks(): NetworkCostComparison[] {
    const grouped = new Map<string, GasTransaction[]>();
    this.transactions.forEach(tx => {
      if (!grouped.has(tx.network)) grouped.set(tx.network, []);
      grouped.get(tx.network)!.push(tx);
    });

    return Array.from(grouped.entries()).map(([network, txs]) => {
      const totalCostUSD = txs.reduce((sum, tx) => sum + (tx.totalCostUSD || 0), 0);
      const totalGasPrice = txs.reduce((sum, tx) => sum + tx.gasPrice, BigInt(0));

      return {
        network,
        chainId: txs[0]?.chainId || 0,
        totalTransactions: txs.length,
        totalCostUSD,
        avgCostUSD: totalCostUSD / (txs.length || 1),
        avgGasPrice: totalGasPrice / BigInt(txs.length || 1),
        timestamp: new Date(),
      };
    });
  }

  detectAnomalies(): GasAnomaly[] {
    const anomalies: GasAnomaly[] = [];
    const grouped = this.groupByFunction();

    grouped.forEach((txs, functionKey) => {
      if (txs.length < 3) return; // Need minimum data points

      const gasValues = txs.map(tx => Number(tx.gasUsed));
      const mean = gasValues.reduce((a, b) => a + b, 0) / gasValues.length;
      const variance = gasValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / gasValues.length;
      const stdDev = Math.sqrt(variance);

      txs.forEach(tx => {
        const gasUsed = Number(tx.gasUsed);
        const deviation = Math.abs(gasUsed - mean) / stdDev;

        if (deviation > this.anomalyThreshold) {
          const severity = deviation > 4 ? 'critical' : deviation > 3 ? 'high' : 'medium';
          anomalies.push({
            id: `anomaly_${tx.id}`,
            transactionHash: tx.transactionHash,
            network: tx.network,
            contractAddress: tx.contractAddress,
            functionName: tx.functionName,
            gasUsed: tx.gasUsed,
            expectedGasRange: {
              min: BigInt(Math.floor(mean - stdDev)),
              max: BigInt(Math.ceil(mean + stdDev)),
            },
            deviation: deviation,
            severity,
            timestamp: tx.timestamp,
            reason: `Gas usage ${deviation.toFixed(1)}σ from mean (${mean.toFixed(0)} gas)`,
          });
        }
      });
    });

    return anomalies;
  }

  generateRecommendations(): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    const contractAggs = this.aggregateByContract();
    const networkComparison = this.compareNetworks();

    // High cost contract recommendation
    contractAggs.forEach(agg => {
      if (agg.avgCostUSD > 10) {
        recommendations.push({
          id: `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'inefficient_contract',
          severity: 'warning',
          contractAddress: agg.contractAddress,
          network: agg.network,
          title: 'High Average Gas Cost Detected',
          description: `Contract ${agg.contractAddress} has an average cost of $${agg.avgCostUSD.toFixed(2)} per transaction`,
          potentialSavings: agg.totalCostUSD * 0.3,
          actionItems: [
            'Review contract code for optimization opportunities',
            'Consider batching transactions',
            'Evaluate alternative implementations',
          ],
          createdAt: new Date(),
        });
      }
    });

    // Network cost comparison recommendation
    if (networkComparison.length > 1) {
      const sorted = [...networkComparison].sort((a, b) => a.avgCostUSD - b.avgCostUSD);
      const cheapest = sorted[0];
      const expensive = sorted[sorted.length - 1];

      if (expensive.avgCostUSD > cheapest.avgCostUSD * 5) {
        recommendations.push({
          id: `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'network_switch',
          severity: 'info',
          network: expensive.network,
          title: 'Consider Alternative Network',
          description: `${expensive.network} costs ${(expensive.avgCostUSD / cheapest.avgCostUSD).toFixed(1)}x more than ${cheapest.network}`,
          potentialSavings: (expensive.avgCostUSD - cheapest.avgCostUSD) * expensive.totalTransactions,
          actionItems: [
            `Evaluate migrating to ${cheapest.network}`,
            'Assess security and decentralization trade-offs',
            'Test contract compatibility',
          ],
          createdAt: new Date(),
        });
      }
    }

    return recommendations;
  }

  getTrendData(period: 'hour' | 'day' | 'week' = 'day'): GasTrendData[] {
    const grouped = this.groupByPeriod(this.transactions, period);

    return Array.from(grouped.entries()).map(([periodKey, txs]) => {
      const totalGasPrice = txs.reduce((sum, tx) => sum + tx.gasPrice, BigInt(0));
      const totalCostUSD = txs.reduce((sum, tx) => sum + (tx.totalCostUSD || 0), 0);

      return {
        timestamp: new Date(periodKey),
        avgGasPrice: totalGasPrice / BigInt(txs.length || 1),
        avgCostUSD: totalCostUSD / (txs.length || 1),
        transactionCount: txs.length,
        network: txs[0]?.network || 'unknown',
      };
    });
  }

  private filterByDateRange(startDate?: Date, endDate?: Date): GasTransaction[] {
    return this.transactions.filter(tx => {
      if (startDate && tx.timestamp < startDate) return false;
      if (endDate && tx.timestamp > endDate) return false;
      return true;
    });
  }

  private groupByPeriod(
    txs: GasTransaction[],
    period: 'hour' | 'day' | 'week' | 'month'
  ): Map<string, GasTransaction[]> {
    const grouped = new Map<string, GasTransaction[]>();

    txs.forEach(tx => {
      const date = new Date(tx.timestamp);
      let key: string;

      switch (period) {
        case 'hour':
          key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}`;
          break;
        case 'day':
          key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
          break;
        case 'week':
          const weekNum = Math.floor(date.getDate() / 7);
          key = `${date.getFullYear()}-${date.getMonth() + 1}-W${weekNum}`;
          break;
        case 'month':
          key = `${date.getFullYear()}-${date.getMonth() + 1}`;
          break;
      }

      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(tx);
    });

    return grouped;
  }

  private groupByFunction(): Map<string, GasTransaction[]> {
    const grouped = new Map<string, GasTransaction[]>();

    this.transactions.forEach(tx => {
      const key = `${tx.contractAddress}:${tx.functionName}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(tx);
    });

    return grouped;
  }
}

export const gasAnalytics = new GasAnalytics();
