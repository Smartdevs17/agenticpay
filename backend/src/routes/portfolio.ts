import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';

export const portfolioRouter = Router();

interface TokenPrice {
  symbol: string;
  price: number;
  change24h: number;
  lastUpdated: Date;
}

interface WalletBalance {
  address: string;
  chain: string;
  token: string;
  balance: string;
  balanceUsd?: number;
}

const mockPrices: Map<string, TokenPrice> = new Map([
  ['XLM', { symbol: 'XLM', price: 0.12, change24h: 2.5, lastUpdated: new Date() }],
  ['USDC', { symbol: 'USDC', price: 1.0, change24h: 0.01, lastUpdated: new Date() }],
  ['USDT', { symbol: 'USDT', price: 1.0, change24h: -0.02, lastUpdated: new Date() }],
  ['BTC', { symbol: 'BTC', price: 67500, change24h: 1.2, lastUpdated: new Date() }],
  ['ETH', { symbol: 'ETH', price: 3450, change24h: -0.8, lastUpdated: new Date() }],
  ['SOL', { symbol: 'SOL', price: 145, change24h: 3.2, lastUpdated: new Date() }],
]);

const chainRpcUrls: Record<string, string> = {
  stellar: 'https://horizon.stellar.org',
  ethereum: 'https://eth.llamarpc.com',
  solana: 'https://api.mainnet-beta.solana.com',
};

function getTokenPrice(symbol: string): TokenPrice | undefined {
  return mockPrices.get(symbol.toUpperCase());
}

async function fetchChainBalance(address: string, chain: string, token: string): Promise<WalletBalance> {
  const price = getTokenPrice(token);
  const balance = Math.random() * 1000;
  const balanceUsd = price ? balance * price.price : 0;
  
  return {
    address,
    chain,
    token,
    balance: balance.toFixed(6),
    balanceUsd: Math.round(balanceUsd * 100) / 100,
  };
}

function calculatePortfolioAllocation(balances: WalletBalance[]): { token: string; percentage: number; valueUSD: number }[] {
  const totalUsd = balances.reduce((sum, b) => sum + (b.balanceUsd || 0), 0);
  if (totalUsd === 0) return [];
  
  const tokenMap = new Map<string, number>();
  for (const balance of balances) {
    const current = tokenMap.get(balance.token) || 0;
    tokenMap.set(balance.token, current + (balance.balanceUsd || 0));
  }
  
  const allocations: { token: string; percentage: number; valueUSD: number }[] = [];
  for (const [token, valueUsd] of tokenMap) {
    allocations.push({
      token,
      percentage: Math.round((valueUsd / totalUsd) * 10000) / 100,
      valueUSD: Math.round(valueUsd * 100) / 100,
    });
  }
  
  return allocations.sort((a, b) => b.valueUSD - a.valueUSD);
}

portfolioRouter.get('/prices', asyncHandler(async (req, res) => {
  const prices = Array.from(mockPrices.values());
  res.json({ prices, timestamp: new Date() });
}));

portfolioRouter.get('/prices/:symbol', asyncHandler(async (req, res) => {
  const { symbol } = req.params;
  const price = getTokenPrice(symbol);
  if (!price) {
    res.status(404).json({ error: 'Token price not found' });
    return;
  }
  res.json(price);
}));

portfolioRouter.post('/prices', asyncHandler(async (req, res) => {
  const { symbol, price, change24h } = req.body;
  if (!symbol || price === undefined) {
    res.status(400).json({ error: 'symbol and price are required' });
    return;
  }
  const tokenPrice: TokenPrice = {
    symbol: symbol.toUpperCase(),
    price,
    change24h: change24h || 0,
    lastUpdated: new Date(),
  };
  mockPrices.set(symbol.toUpperCase(), tokenPrice);
  res.json(tokenPrice);
}));

portfolioRouter.get('/balance', asyncHandler(async (req, res) => {
  const { address, chains, tokens } = req.query;
  
  if (!address) {
    res.status(400).json({ error: 'address is required' });
    return;
  }
  
  const chainList = chains ? (chains as string).split(',') : ['stellar'];
  const tokenList = tokens ? (tokens as string).split(',') : ['XLM'];
  
  const balances = await Promise.all(
    chainList.flatMap(chain =>
      tokenList.map(token => fetchChainBalance(address as string, chain, token))
    )
  );
  
  const totalUsd = balances.reduce((sum, b) => sum + (b.balanceUsd || 0), 0);
  
  res.json({
    address,
    balances,
    totalUsd: Math.round(totalUsd * 100) / 100,
    lastUpdated: new Date(),
  });
}));

portfolioRouter.get('/', asyncHandler(async (req, res) => {
  const { address, chains, tokens } = req.query;
  
  if (!address) {
    res.status(400).json({ error: 'address is required' });
    return;
  }
  
  const chainList = chains ? (chains as string).split(',') : ['stellar'];
  const tokenList = tokens ? (tokens as string).split(',') : ['XLM', 'USDC'];
  
  const balances = await Promise.all(
    chainList.flatMap(chain =>
      tokenList.map(token => fetchChainBalance(address as string, chain, token))
    )
  );
  
  const totalUsd = balances.reduce((sum, b) => sum + (b.balanceUsd || 0), 0);
  const totalChange24h = balances.reduce((sum, b) => {
    const price = getTokenPrice(b.token);
    return sum + (price ? price.change24h * (b.balanceUsd || 0) : 0);
  }, 0) / totalUsd;
  
  const allocation = calculatePortfolioAllocation(balances);
  
  res.json({
    address,
    chains: chainList,
    tokens: tokenList,
    balances,
    totalUsd: Math.round(totalUsd * 100) / 100,
    change24h: Math.round(totalChange24h * 100) / 100,
    allocation,
    lastUpdated: new Date(),
  });
}));

portfolioRouter.get('/history', asyncHandler(async (req, res) => {
  const { address, days = '30' } = req.query;
  
  const daysNum = parseInt(days as string, 10) || 30;
  const history = [];
  const baseValue = 10000;
  
  for (let i = daysNum; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const randomChange = 1 + (Math.random() - 0.5) * 0.1;
    history.push({
      date: date.toISOString().split('T')[0],
      valueUsd: Math.round(baseValue * randomChange * (1 - i / daysNum * 0.2)),
    });
  }
  
  res.json({
    address,
    history,
    days: daysNum,
  });
}));