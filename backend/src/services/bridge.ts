import { randomUUID } from 'node:crypto';

export interface BridgeTransfer {
  id: string;
  fromChain: string;
  toChain: string;
  sender: string;
  recipient: string;
  amount: number;
  minAmountOut: number;
  feeBps: number;
  status: 'created' | 'locked' | 'relayed' | 'redeemed' | 'refunded' | 'disputed' | 'paused';
  hashlock: string;
  timelockUnix: number;
  optimisticDisputeEndsAt: number;
  route: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BridgeConfig {
  feeBps: number;
  slippageBps: number;
  disputeWindowSeconds: number;
  paused: boolean;
}

const transfers = new Map<string, BridgeTransfer>();
let bridgeConfig: BridgeConfig = {
  feeBps: 30,
  slippageBps: 100,
  disputeWindowSeconds: 900,
  paused: false,
};

function nowIso(): string {
  return new Date().toISOString();
}

export function getBridgeConfig(): BridgeConfig {
  return { ...bridgeConfig };
}

export function updateBridgeConfig(input: Partial<BridgeConfig>): BridgeConfig {
  bridgeConfig = { ...bridgeConfig, ...input };
  return getBridgeConfig();
}

export function createBridgeTransfer(input: {
  fromChain: string;
  toChain: string;
  sender: string;
  recipient: string;
  amount: number;
  minAmountOut: number;
  hashlock: string;
  timelockUnix: number;
  route?: string[];
}): BridgeTransfer {
  if (bridgeConfig.paused) {
    throw new Error('Bridge paused');
  }
  if (input.amount < input.minAmountOut) {
    throw new Error('Slippage protection violated');
  }
  const ts = nowIso();
  const feeAmount = (input.amount * bridgeConfig.feeBps) / 10_000;
  const effectiveOut = input.amount - feeAmount;
  if (effectiveOut < input.minAmountOut) {
    throw new Error('Amount out below minAmountOut after fee');
  }

  const transfer: BridgeTransfer = {
    id: `bridge_${randomUUID()}`,
    fromChain: input.fromChain,
    toChain: input.toChain,
    sender: input.sender,
    recipient: input.recipient,
    amount: input.amount,
    minAmountOut: input.minAmountOut,
    feeBps: bridgeConfig.feeBps,
    status: 'created',
    hashlock: input.hashlock,
    timelockUnix: input.timelockUnix,
    optimisticDisputeEndsAt: Math.floor(Date.now() / 1000) + bridgeConfig.disputeWindowSeconds,
    route: input.route && input.route.length > 0 ? input.route : [input.fromChain, input.toChain],
    createdAt: ts,
    updatedAt: ts,
  };
  transfers.set(transfer.id, transfer);
  return transfer;
}

export function transitionBridgeTransfer(
  id: string,
  next: BridgeTransfer['status']
): BridgeTransfer | undefined {
  const transfer = transfers.get(id);
  if (!transfer) return undefined;
  if (bridgeConfig.paused) {
    transfer.status = 'paused';
  } else {
    transfer.status = next;
  }
  transfer.updatedAt = nowIso();
  transfers.set(id, transfer);
  return transfer;
}

export function getBridgeTransfer(id: string): BridgeTransfer | undefined {
  return transfers.get(id);
}

export function listBridgeTransfers(): BridgeTransfer[] {
  return Array.from(transfers.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getBridgeAnalytics(): {
  totalTransfers: number;
  volume: number;
  byStatus: Record<string, number>;
} {
  const all = listBridgeTransfers();
  const byStatus = all.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    totalTransfers: all.length,
    volume: all.reduce((sum, item) => sum + item.amount, 0),
    byStatus,
  };
}
