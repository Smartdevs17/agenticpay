// Gas tracking types and interfaces

export interface GasTransaction {
  id: string;
  transactionHash: string;
  contractAddress: string;
  contractName?: string;
  functionName: string;
  network: string;
  chainId: number;
  gasUsed: bigint;
  gasPrice: bigint;
  effectiveGasPrice?: bigint;
  totalCost: bigint; // in wei
  totalCostUSD?: number;
  blockNumber: number;
  timestamp: Date;
  from: string;
  to: string;
  status: 'success' | 'failed' | 'pending';
  metadata?: Record<string, any>;
}

export interface GasAggregation {
  period: string; // ISO date or period identifier
  network: string;
  contractAddress?: string;
  totalTransactions: number;
  totalGasUsed: bigint;
  totalCostWei: bigint;
  totalCostUSD: number;
  avgGasUsed: bigint;
  avgCostWei: bigint;
  avgCostUSD: number;
  minGasUsed: bigint;
  maxGasUsed: bigint;
  successRate: number;
}

export interface NetworkCostComparison {
  network: string;
  chainId: number;
  totalTransactions: number;
  totalCostUSD: number;
  avgCostUSD: number;
  avgGasPrice: bigint;
  timestamp: Date;
}

export interface GasAnomaly {
  id: string;
  transactionHash: string;
  network: string;
  contractAddress: string;
  functionName: string;
  gasUsed: bigint;
  expectedGasRange: { min: bigint; max: bigint };
  deviation: number; // percentage
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  reason: string;
}

export interface OptimizationRecommendation {
  id: string;
  type: 'gas_spike' | 'inefficient_contract' | 'network_switch' | 'batch_opportunity' | 'timing';
  severity: 'info' | 'warning' | 'critical';
  contractAddress?: string;
  functionName?: string;
  network?: string;
  title: string;
  description: string;
  potentialSavings: number; // USD
  actionItems: string[];
  createdAt: Date;
}

export interface GasTrendData {
  timestamp: Date;
  avgGasPrice: bigint;
  avgCostUSD: number;
  transactionCount: number;
  network: string;
}

export interface GasReport {
  id: string;
  reportType: 'daily' | 'weekly' | 'monthly' | 'custom';
  startDate: Date;
  endDate: Date;
  networks: string[];
  summary: {
    totalTransactions: number;
    totalCostUSD: number;
    avgCostPerTransaction: number;
    topContract: { address: string; cost: number };
    costTrend: 'increasing' | 'decreasing' | 'stable';
  };
  aggregations: GasAggregation[];
  anomalies: GasAnomaly[];
  recommendations: OptimizationRecommendation[];
  generatedAt: Date;
}

export interface GasQueryParams {
  startDate?: string;
  endDate?: string;
  network?: string;
  contractAddress?: string;
  functionName?: string;
  limit?: number;
  offset?: number;
  groupBy?: 'hour' | 'day' | 'week' | 'month' | 'contract' | 'function' | 'network';
}

export interface GasAlertConfig {
  id: string;
  name: string;
  enabled: boolean;
  conditions: {
    type: 'threshold' | 'spike' | 'anomaly';
    metric: 'gas_price' | 'total_cost' | 'gas_used';
    operator: 'gt' | 'lt' | 'eq';
    value: number;
    network?: string;
    contractAddress?: string;
  };
  actions: {
    type: 'email' | 'webhook' | 'log';
    config: Record<string, any>;
  }[];
  createdAt: Date;
  lastTriggered?: Date;
}
