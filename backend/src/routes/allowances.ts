import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';

export const allowancesRouter = Router();

interface TokenAllowance {
  id: string;
  owner: string;
  spender: string;
  token: string;
  tokenSymbol: string;
  chainId: number;
  chainName: string;
  allowance: string;
  allowanceUsd: number;
  isUnlimited: boolean;
  lastUpdated: Date;
  riskLevel: 'low' | 'medium' | 'high';
  txHash?: string;
  blockNumber?: number;
}

interface ApprovalHistory {
  id: string;
  owner: string;
  spender: string;
  token: string;
  tokenSymbol: string;
  chainId: number;
  chainName: string;
  oldAllowance: string;
  newAllowance: string;
  txHash: string;
  timestamp: Date;
  status: 'confirmed' | 'pending' | 'failed';
}

const mockAllowances: Map<string, TokenAllowance[]> = new Map([
  ['0x1234567890123456789012345678901234567890', [
    {
      id: '1',
      owner: '0x1234567890123456789012345678901234567890',
      spender: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      token: '0xA0b86a33E6441C4C9A2eD5f5b2b2D5C2E5D5C2E5',
      tokenSymbol: 'USDC',
      chainId: 1,
      chainName: 'Ethereum Mainnet',
      allowance: '1000000000',
      allowanceUsd: 1000,
      isUnlimited: false,
      lastUpdated: new Date(Date.now() - 86400000),
      riskLevel: 'low',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    },
    {
      id: '2',
      owner: '0x1234567890123456789012345678901234567890',
      spender: '0xdefghijklmnopqrstuvwxyzabcdefghijklmnop',
      token: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
      tokenSymbol: 'AAVE',
      chainId: 1,
      chainName: 'Ethereum Mainnet',
      allowance: '115792089237316195423570985008687907853269984665640564039457.584007913129639935',
      allowanceUsd: 50000,
      isUnlimited: true,
      lastUpdated: new Date(Date.now() - 604800000),
      riskLevel: 'high',
      txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    },
    {
      id: '3',
      owner: '0x1234567890123456789012345678901234567890',
      spender: '0x111222333444555666777888999aaabbbcccddd',
      token: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      tokenSymbol: 'WBTC',
      chainId: 137,
      chainName: 'Polygon',
      allowance: '500000000',
      allowanceUsd: 25000,
      isUnlimited: false,
      lastUpdated: new Date(Date.now() - 172800000),
      riskLevel: 'medium',
      txHash: '0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
    },
  ]],
]);

const approvalHistory: ApprovalHistory[] = [
  {
    id: 'h1',
    owner: '0x1234567890123456789012345678901234567890',
    spender: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    token: '0xA0b86a33E6441C4C9A2eD5f5b2b2D5C2E5D5C2E5',
    tokenSymbol: 'USDC',
    chainId: 1,
    chainName: 'Ethereum Mainnet',
    oldAllowance: '0',
    newAllowance: '1000000000',
    txHash: '0xaaa111bbb222ccc333ddd444eee555fff666777',
    timestamp: new Date(Date.now() - 86400000),
    status: 'confirmed',
  },
  {
    id: 'h2',
    owner: '0x1234567890123456789012345678901234567890',
    spender: '0xdefghijklmnopqrstuvwxyzabcdefghijklmnop',
    token: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
    tokenSymbol: 'AAVE',
    chainId: 1,
    chainName: 'Ethereum Mainnet',
    oldAllowance: '0',
    newAllowance: '115792089237316195423570985008687907853269984665640564039457.584007913129639935',
    txHash: '0xbbb222ccc333ddd444eee555fff666777888999',
    timestamp: new Date(Date.now() - 604800000),
    status: 'confirmed',
  },
];

const tokenPrices: Record<string, number> = {
  USDC: 1.0,
  USDT: 1.0,
  DAI: 1.0,
  AAVE: 250,
  WBTC: 50000,
  ETH: 3500,
  UNI: 10,
  LINK: 15,
};

const supportedChains: Record<number, { name: string; rpcUrl: string }> = {
  1: { name: 'Ethereum Mainnet', rpcUrl: 'https://eth.llamarpc.com' },
  137: { name: 'Polygon', rpcUrl: 'https://polygon-rpc.com' },
  56: { name: 'BSC', rpcUrl: 'https://bsc-dataseed.binance.org' },
  42161: { name: 'Arbitrum One', rpcUrl: 'https://arb1.arbitrum.io/rpc' },
  10: { name: 'Optimism', rpcUrl: 'https://mainnet.optimism.io' },
};

function calculateRiskLevel(allowance: string, token: string, isUnlimited: boolean): 'low' | 'medium' | 'high' {
  if (isUnlimited) return 'high';
  
  const price = tokenPrices[token] || 0;
  const allowanceUsd = parseFloat(allowance) * price;
  
  if (allowanceUsd > 10000) return 'high';
  if (allowanceUsd > 1000) return 'medium';
  return 'low';
}

function estimateGas(allowance: string, isIncrease: boolean): { gasEstimate: string; gasPrice: string; totalUsd: number } {
  const gasLimit = isIncrease ? 100000 : 80000;
  const gasPrice = '20000000000';
  const gasUsd = (gasLimit * parseInt(gasPrice)) / 1e18 * 3500;
  
  return {
    gasEstimate: gasLimit.toString(),
    gasPrice,
    totalUsd: Math.round(gasUsd * 100) / 100,
  };
}

const recommendedAllowances: Record<string, { amount: string; label: string; usdValue: number }> = {
  USDC: { amount: '1000', label: 'Small Payment', usdValue: 1000 },
  WBTC: { amount: '0.05', label: 'Small Payment', usdValue: 2500 },
  AAVE: { amount: '10', label: 'Small Payment', usdValue: 2500 },
};

allowancesRouter.get('/', asyncHandler(async (req, res) => {
  const { owner, chainIds } = req.query;
  
  if (!owner) {
    res.status(400).json({ error: 'owner address is required' });
    return;
  }
  
  const ownerLower = (owner as string).toLowerCase();
  let allowances = mockAllowances.get(ownerLower) || [];
  
  if (chainIds) {
    const chainIdList = (chainIds as string).split(',').map(id => parseInt(id, 10));
    allowances = allowances.filter(a => chainIdList.includes(a.chainId));
  }
  
  const totalAllowancesUsd = allowances.reduce((sum, a) => sum + a.allowanceUsd, 0);
  const riskCounts = { low: 0, medium: 0, high: 0 };
  allowances.forEach(a => riskCounts[a.riskLevel]++);
  
  res.json({
    owner: ownerLower,
    allowances,
    summary: {
      totalAllowances: allowances.length,
      totalAllowancesUsd: Math.round(totalAllowancesUsd * 100) / 100,
      highRisk: riskCounts.high,
      mediumRisk: riskCounts.medium,
      lowRisk: riskCounts.low,
      unlimitedAllowances: allowances.filter(a => a.isUnlimited).length,
    },
    supportedChains,
    timestamp: new Date(),
  });
}));

allowancesRouter.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  for (const allowances of mockAllowances.values()) {
    const allowance = allowances.find(a => a.id === id);
    if (allowance) {
      const gasEstimate = estimateGas(allowance.allowance, false);
      res.json({ ...allowance, gasEstimate });
      return;
    }
  }
  
  res.status(404).json({ error: 'Allowance not found' });
}));

allowancesRouter.post('/approve', asyncHandler(async (req, res) => {
  const { owner, spender, token, tokenSymbol, chainId, amount, isUnlimited } = req.body;
  
  if (!owner || !spender || !token || !chainId) {
    res.status(400).json({ error: 'owner, spender, token, and chainId are required' });
    return;
  }
  
  const chainInfo = supportedChains[chainId];
  if (!chainInfo) {
    res.status(400).json({ error: 'Unsupported chain' });
    return;
  }
  
  const allowanceAmount = isUnlimited 
    ? '115792089237316195423570985008687907853269984665640564039457.584007913129639935'
    : amount;
  
  const tokenPrice = tokenPrices[tokenSymbol] || 0;
  const allowanceUsd = isUnlimited 
    ? 999999999 
    : parseFloat(amount) * tokenPrice;
  
  const newAllowance: TokenAllowance = {
    id: `allowance_${Date.now()}`,
    owner: owner.toLowerCase(),
    spender: spender.toLowerCase(),
    token,
    tokenSymbol: tokenSymbol || 'UNKNOWN',
    chainId,
    chainName: chainInfo.name,
    allowance: allowanceAmount,
    allowanceUsd: Math.round(allowanceUsd * 100) / 100,
    isUnlimited: !!isUnlimited,
    lastUpdated: new Date(),
    riskLevel: calculateRiskLevel(allowanceAmount, tokenSymbol, !!isUnlimited),
    txHash: `0x${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`,
  };
  
  const ownerLower = owner.toLowerCase();
  const ownerAllowances = mockAllowances.get(ownerLower) || [];
  ownerAllowances.push(newAllowance);
  mockAllowances.set(ownerLower, ownerAllowances);
  
  approvalHistory.unshift({
    id: `h${Date.now()}`,
    owner: newAllowance.owner,
    spender: newAllowance.spender,
    token: newAllowance.token,
    tokenSymbol: newAllowance.tokenSymbol,
    chainId: newAllowance.chainId,
    chainName: newAllowance.chainName,
    oldAllowance: '0',
    newAllowance: allowanceAmount,
    txHash: newAllowance.txHash!,
    timestamp: new Date(),
    status: 'confirmed',
  });
  
  res.json({
    success: true,
    allowance: newAllowance,
    message: isUnlimited ? 'Unlimited approval granted' : `Approved ${amount} ${tokenSymbol}`,
  });
}));

allowancesRouter.post('/revoke', asyncHandler(async (req, res) => {
  const { owner, spender, token, chainId } = req.body;
  
  if (!owner || !spender || !token || !chainId) {
    res.status(400).json({ error: 'owner, spender, token, and chainId are required' });
    return;
  }
  
  const ownerLower = owner.toLowerCase();
  const ownerAllowances = mockAllowances.get(ownerLower);
  
  if (!ownerAllowances) {
    res.status(404).json({ error: 'No allowances found for this owner' });
    return;
  }
  
  const allowanceIndex = ownerAllowances.findIndex(
    a => a.spender.toLowerCase() === spender.toLowerCase() && 
         a.token.toLowerCase() === token.toLowerCase() &&
         a.chainId === chainId
  );
  
  if (allowanceIndex === -1) {
    res.status(404).json({ error: 'Allowance not found' });
    return;
  }
  
  const revokedAllowance = ownerAllowances[allowanceIndex];
  const txHash = `0x${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
  
  approvalHistory.unshift({
    id: `h${Date.now()}`,
    owner: revokedAllowance.owner,
    spender: revokedAllowance.spender,
    token: revokedAllowance.token,
    tokenSymbol: revokedAllowance.tokenSymbol,
    chainId: revokedAllowance.chainId,
    chainName: revokedAllowance.chainName,
    oldAllowance: revokedAllowance.allowance,
    newAllowance: '0',
    txHash,
    timestamp: new Date(),
    status: 'confirmed',
  });
  
  ownerAllowances.splice(allowanceIndex, 1);
  
  res.json({
    success: true,
    revoked: { spender, token, chainId },
    txHash,
    message: 'Allowance revoked successfully',
  });
}));

allowancesRouter.post('/batch-revoke', asyncHandler(async (req, res) => {
  const { owner, allowances } = req.body;
  
  if (!owner || !allowances || !Array.isArray(allowances)) {
    res.status(400).json({ error: 'owner and allowances array are required' });
    return;
  }
  
  const ownerLower = owner.toLowerCase();
  const ownerAllowances = mockAllowances.get(ownerLower);
  const results: { spender: string; token: string; chainId: number; success: boolean; error?: string }[] = [];
  
  for (const item of allowances) {
    if (!ownerAllowances) {
      results.push({ ...item, success: false, error: 'No allowances found' });
      continue;
    }
    
    const index = ownerAllowances.findIndex(
      a => a.spender.toLowerCase() === item.spender.toLowerCase() && 
           a.token.toLowerCase() === item.token.toLowerCase() &&
           a.chainId === item.chainId
    );
    
    if (index !== -1) {
      ownerAllowances.splice(index, 1);
      results.push({ ...item, success: true });
    } else {
      results.push({ ...item, success: false, error: 'Allowance not found' });
    }
  }
  
  const successCount = results.filter(r => r.success).length;
  
  res.json({
    success: true,
    results,
    summary: {
      total: allowances.length,
      successful: successCount,
      failed: allowances.length - successCount,
    },
  });
}));

allowancesRouter.get('/history/:owner', asyncHandler(async (req, res) => {
  const { owner } = req.params;
  const { chainIds, limit = '50' } = req.query;
  
  const ownerLower = owner.toLowerCase();
  let history = approvalHistory.filter(h => h.owner.toLowerCase() === ownerLower);
  
  if (chainIds) {
    const chainIdList = (chainIds as string).split(',').map(id => parseInt(id, 10));
    history = history.filter(h => chainIdList.includes(h.chainId));
  }
  
  history = history.slice(0, parseInt(limit as string, 10));
  
  res.json({
    owner: ownerLower,
    history,
    total: approvalHistory.filter(h => h.owner.toLowerCase() === ownerLower).length,
    timestamp: new Date(),
  });
}));

allowancesRouter.post('/estimate-gas', asyncHandler(async (req, res) => {
  const { chainId, operation, tokenSymbol, amount } = req.body;
  
  if (!chainId || !operation) {
    res.status(400).json({ error: 'chainId and operation are required' });
    return;
  }
  
  const chainInfo = supportedChains[chainId];
  if (!chainInfo) {
    res.status(400).json({ error: 'Unsupported chain' });
    return;
  }
  
  const isIncrease = operation === 'increase' || operation === 'approve';
  const gasEstimate = estimateGas(amount || '0', isIncrease);
  
  res.json({
    chainId,
    chainName: chainInfo.name,
    operation,
    tokenSymbol,
    ...gasEstimate,
    estimatedTime: isIncrease ? '15-30 seconds' : '10-20 seconds',
  });
}));

allowancesRouter.get('/recommendations/:tokenSymbol', asyncHandler(async (req, res) => {
  const { tokenSymbol } = req.params;
  const { chainId = '1' } = req.query;
  
  const token = tokenSymbol.toUpperCase();
  const recommendations = recommendedAllowances[token];
  
  if (!recommendations) {
    res.json({
      tokenSymbol: token,
      chainId: parseInt(chainId as string, 10),
      recommendations: [
        { amount: '10', label: 'Minimum', usdValue: 10 * (tokenPrices[token] || 0) },
        { amount: '100', label: 'Small Payment', usdValue: 100 * (tokenPrices[token] || 0) },
        { amount: '1000', label: 'Medium Payment', usdValue: 1000 * (tokenPrices[token] || 0) },
      ],
    });
    return;
  }
  
  res.json({
    tokenSymbol: token,
    chainId: parseInt(chainId as string, 10),
    recommendations: [
      recommendations,
      { amount: (parseFloat(recommendations.amount) * 10).toString(), label: 'Large Payment', usdValue: recommendations.usdValue * 10 },
      { amount: (parseFloat(recommendations.amount) * 100).toString(), label: 'Custom', usdValue: recommendations.usdValue * 100 },
    ],
  });
}));