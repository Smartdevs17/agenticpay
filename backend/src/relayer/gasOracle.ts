/**
 * EVM Gas Oracle Service
 * Fetches dynamic gas prices from EVM chains and converts to ERC-20 token fees.
 */

export interface EVMGasQuote {
  baseFee: bigint;
  priorityFee: bigint;
  maxFeePerGas: bigint;
  estimatedGasCostWei: bigint;
  tokenFee?: bigint;
  token?: string;
  validUntil: number;
}

export interface PriceFeed {
  token: string;
  pricePerEth: number; // token units per 1 ETH
  updatedAt: number;
  source: string;
}

// In-memory price feed cache
const priceFeeds = new Map<string, PriceFeed>();
const PRICE_FEED_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Default EVM chain gas parameters
const CHAIN_DEFAULTS: Record<number, { baseFeePremium: bigint; priorityFee: bigint }> = {
  1: { baseFeePremium: 1_000_000_000n, priorityFee: 2_000_000_000n },     // Ethereum mainnet
  137: { baseFeePremium: 500_000_000n, priorityFee: 30_000_000_000n },    // Polygon
  42161: { baseFeePremium: 100_000_000n, priorityFee: 100_000_000n },     // Arbitrum
  10: { baseFeePremium: 50_000_000n, priorityFee: 50_000_000n },          // Optimism
  8453: { baseFeePremium: 100_000_000n, priorityFee: 100_000_000n },      // Base
};

/**
 * Fetch current base fee from an EVM chain via JSON-RPC.
 */
export async function fetchBaseFee(rpcUrl: string): Promise<bigint> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_gasPrice',
        params: [],
        id: 1,
      }),
    });

    const data = await response.json() as { result?: string };
    if (data.result) {
      return BigInt(data.result);
    }
    return 0n;
  } catch {
    return 0n;
  }
}

/**
 * Fetch the EIP-1559 base fee specifically.
 */
export async function fetchEIP1559BaseFee(rpcUrl: string): Promise<{ baseFee: bigint; priorityFee: bigint }> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_feeHistory',
        params: ['0x1', 'latest', [25, 75]],
        id: 1,
      }),
    });

    const data = await response.json() as {
      result?: {
        baseFeePerGas?: string[];
        reward?: string[][];
      };
    };

    if (data.result?.baseFeePerGas?.length) {
      const baseFee = BigInt(data.result.baseFeePerGas[data.result.baseFeePerGas.length - 1]);
      const rewards = data.result.reward?.[0];
      const priorityFee = rewards?.[0] ? BigInt(rewards[0]) : 1_500_000_000n;
      return { baseFee, priorityFee };
    }

    return { baseFee: 0n, priorityFee: 1_500_000_000n };
  } catch {
    return { baseFee: 0n, priorityFee: 1_500_000_000n };
  }
}

/**
 * Set a price feed entry for an ERC-20 token.
 */
export function setPriceFeed(token: string, pricePerEth: number, source: string = 'manual'): void {
  priceFeeds.set(token.toLowerCase(), {
    token: token.toLowerCase(),
    pricePerEth,
    updatedAt: Date.now(),
    source,
  });
}

/**
 * Get the current price feed for a token.
 */
export function getPriceFeed(token: string): PriceFeed | undefined {
  const feed = priceFeeds.get(token.toLowerCase());
  if (!feed) return undefined;
  if (Date.now() - feed.updatedAt > PRICE_FEED_TTL_MS) return undefined;
  return feed;
}

/**
 * Generate a gas quote for a meta-transaction.
 */
export async function generateGasQuote(params: {
  rpcUrl: string;
  chainId: number;
  gasLimit: number;
  token?: string;
  ttlSeconds?: number;
}): Promise<EVMGasQuote> {
  const { rpcUrl, chainId, gasLimit, token, ttlSeconds = 300 } = params;

  // Fetch gas prices from chain
  const { baseFee, priorityFee: chainPriorityFee } = await fetchEIP1559BaseFee(rpcUrl);
  const chainDefaults = CHAIN_DEFAULTS[chainId] ?? { baseFeePremium: 500_000_000n, priorityFee: 1_500_000_000n };

  const effectiveBaseFee = baseFee > 0n ? baseFee : 20_000_000_000n; // fallback 20 gwei
  const effectivePriorityFee = chainPriorityFee > 0n ? chainPriorityFee : chainDefaults.priorityFee;
  const maxFeePerGas = effectiveBaseFee + chainDefaults.baseFeePremium + effectivePriorityFee;
  const estimatedGasCostWei = maxFeePerGas * BigInt(gasLimit);

  // Convert to token fee if applicable
  let tokenFee: bigint | undefined;
  if (token) {
    const feed = getPriceFeed(token);
    if (feed) {
      // tokenFee = gasCostWei * pricePerEth / 1e18
      const pricePerEthScaled = BigInt(Math.round(feed.pricePerEth * 1e18));
      tokenFee = (estimatedGasCostWei * pricePerEthScaled) / (10n ** 18n);
    }
  }

  return {
    baseFee: effectiveBaseFee,
    priorityFee: effectivePriorityFee,
    maxFeePerGas,
    estimatedGasCostWei,
    tokenFee,
    token: token?.toLowerCase(),
    validUntil: Date.now() + ttlSeconds * 1000,
  };
}

/**
 * Validate that a gas quote is still valid (not expired).
 */
export function isQuoteValid(quote: EVMGasQuote): boolean {
  return Date.now() < quote.validUntil;
}
