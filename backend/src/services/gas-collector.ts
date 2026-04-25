// Gas data collection service
import { GasTransaction } from '../types/gas.js';

interface CollectorConfig {
  networks: Array<{
    name: string;
    chainId: number;
    rpcUrl: string;
    nativeCurrency: string;
  }>;
  contracts: Array<{
    address: string;
    name: string;
    network: string;
  }>;
}

class GasCollector {
  private config: CollectorConfig;
  private storage: GasTransaction[] = [];
  private priceCache: Map<string, { price: number; timestamp: number }> = new Map();

  constructor(config: CollectorConfig) {
    this.config = config;
  }

  async collectTransaction(txHash: string, network: string): Promise<GasTransaction | null> {
    try {
      // In production, this would fetch from blockchain RPC
      // For now, we'll create a mock implementation
      const networkConfig = this.config.networks.find(n => n.name === network);
      if (!networkConfig) {
        throw new Error(`Network ${network} not configured`);
      }

      // Mock transaction data - replace with actual RPC calls
      const transaction: GasTransaction = {
        id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        transactionHash: txHash,
        contractAddress: this.config.contracts[0]?.address || '0x0',
        contractName: this.config.contracts[0]?.name,
        functionName: 'transfer',
        network: network,
        chainId: networkConfig.chainId,
        gasUsed: BigInt(21000),
        gasPrice: BigInt(50000000000), // 50 gwei
        effectiveGasPrice: BigInt(48000000000),
        totalCost: BigInt(21000) * BigInt(48000000000),
        totalCostUSD: 0.05,
        blockNumber: 12345678,
        timestamp: new Date(),
        from: '0x1234567890123456789012345678901234567890',
        to: '0x0987654321098765432109876543210987654321',
        status: 'success',
        metadata: {},
      };

      this.storage.push(transaction);
      return transaction;
    } catch (error) {
      console.error(`Failed to collect transaction ${txHash}:`, error);
      return null;
    }
  }

  async batchCollect(txHashes: string[], network: string): Promise<GasTransaction[]> {
    const results = await Promise.allSettled(
      txHashes.map(hash => this.collectTransaction(hash, network))
    );

    return results
      .filter((r): r is PromiseFulfilledResult<GasTransaction> => 
        r.status === 'fulfilled' && r.value !== null
      )
      .map(r => r.value);
  }

  async getEthPrice(): Promise<number> {
    const cached = this.priceCache.get('ETH');
    if (cached && Date.now() - cached.timestamp < 60000) {
      return cached.price;
    }

    // Mock price - in production, fetch from price oracle
    const price = 2000 + Math.random() * 100;
    this.priceCache.set('ETH', { price, timestamp: Date.now() });
    return price;
  }

  getStoredTransactions(): GasTransaction[] {
    return [...this.storage];
  }

  clearStorage(): void {
    this.storage = [];
  }
}

export const gasCollector = new GasCollector({
  networks: [
    { name: 'ethereum', chainId: 1, rpcUrl: '', nativeCurrency: 'ETH' },
    { name: 'polygon', chainId: 137, rpcUrl: '', nativeCurrency: 'MATIC' },
    { name: 'arbitrum', chainId: 42161, rpcUrl: '', nativeCurrency: 'ETH' },
    { name: 'optimism', chainId: 10, rpcUrl: '', nativeCurrency: 'ETH' },
  ],
  contracts: [],
});
