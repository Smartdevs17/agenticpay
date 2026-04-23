export interface TokenBalance {
  token: string;
  symbol: string;
  amount: string;
  decimals: number;
  usdValue: number;
  chain: string;
}

export interface WalletPortfolio {
  walletAddress: string;
  totalUsdValue: number;
  change24h: number;
  changePercent24h: number;
  balances: TokenBalance[];
  lastUpdated: Date;
}

export class PortfolioService {
  private portfolioCache: Map<string, WalletPortfolio> = new Map();

  async getPortfolio(walletAddress: string, chains: string[] = ['stellar', 'ethereum']): Promise<WalletPortfolio> {
    const cacheKey = `${walletAddress}-${chains.join(',')}`;
    const cached = this.portfolioCache.get(cacheKey);
    
    if (cached && Date.now() - cached.lastUpdated.getTime() < 30000) {
      return cached;
    }

    const balances: TokenBalance[] = [];

    for (const chain of chains) {
      const chainBalances = await this.fetchChainBalances(walletAddress, chain);
      balances.push(...chainBalances);
    }

    for (const balance of balances) {
      balance.usdValue = this.calculateUsdValue(balance.amount, balance.decimals);
    }

    const totalUsdValue = balances.reduce((sum, b) => sum + b.usdValue, 0);

    const portfolio: WalletPortfolio = {
      walletAddress,
      totalUsdValue,
      change24h: 0,
      changePercent24h: 0,
      balances,
      lastUpdated: new Date(),
    };

    this.portfolioCache.set(cacheKey, portfolio);
    return portfolio;
  }

  private async fetchChainBalances(walletAddress: string, chain: string): Promise<TokenBalance[]> {
    if (chain === 'stellar') {
      return [{ token: 'XLM', symbol: 'XLM', amount: '0', decimals: 7, usdValue: 0, chain: 'stellar' }];
    } else if (chain === 'ethereum') {
      return [{ token: 'ETH', symbol: 'ETH', amount: '0', decimals: 18, usdValue: 0, chain: 'ethereum' }];
    }
    return [];
  }

  private calculateUsdValue(amount: string, decimals: number): number {
    const rawAmount = parseFloat(amount);
    const adjustedAmount = rawAmount / Math.pow(10, decimals);
    return adjustedAmount * 0.5;
  }

  generateAllocationChart(portfolio: WalletPortfolio): { label: string; value: number }[] {
    const byChain: Record<string, number> = {};
    
    for (const balance of portfolio.balances) {
      if (!byChain[balance.chain]) byChain[balance.chain] = 0;
      byChain[balance.chain] += balance.usdValue;
    }

    return Object.entries(byChain).map(([chain, value]) => ({ label: chain, value }));
  }

  exportToCsv(portfolio: WalletPortfolio): string {
    const headers = ['Token', 'Symbol', 'Chain', 'Amount', 'USD Value'];
    const rows = portfolio.balances.map((b) => [b.token, b.symbol, b.chain, b.amount, b.usdValue.toFixed(2)]);
    return [headers, ...rows].map((row) => row.join(',')).join('\n');
  }
}

export const portfolioService = new PortfolioService();