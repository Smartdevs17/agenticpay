import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { auditService } from './auditService.js';

export interface CrossChainSwap {
  id: string;
  sourceChain: 'stellar' | 'evm';
  destinationChain: 'stellar' | 'evm';
  sourceLockId: string;
  destinationLockId: string;
  sender: string;
  recipient: string;
  amount: string;
  hashlock: string;
  timelockSource: number;
  timelockDestination: number;
  status: SwapStatus;
  secret?: string;
  createdAt: number;
  updatedAt: number;
  sourceConfirmedAt?: number;
  destinationConfirmedAt?: number;
  redeemedAt?: number;
  refundedAt?: number;
}

export type SwapStatus =
  | 'initiated'
  | 'source_locked'
  | 'destination_locked'
  | 'source_confirmed'
  | 'both_locked'
  | 'redeemed'
  | 'refunded'
  | 'expired'
  | 'failed';

export interface RelayerConfig {
  pollIntervalMs: number;
  sourceChainRpc: string;
  destinationChainRpc: string;
  maxRetries: number;
  safetyMarginMs: number;
}

const DEFAULT_CONFIG: RelayerConfig = {
  pollIntervalMs: 15_000,
  sourceChainRpc: 'https://soroban-rpc.stellar.org',
  destinationChainRpc: 'https://eth-mainnet.g.alchemy.com/v2/demo',
  maxRetries: 3,
  safetyMarginMs: 300_000,
};

export class BridgeRelayerService extends EventEmitter {
  private swaps = new Map<string, CrossChainSwap>();
  private config: RelayerConfig = { ...DEFAULT_CONFIG };
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  updateConfig(input: Partial<RelayerConfig>): RelayerConfig {
    this.config = { ...this.config, ...input };
    return { ...this.config };
  }

  getConfig(): RelayerConfig {
    return { ...this.config };
  }

  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.pollSwaps();
    }, this.config.pollIntervalMs);
    this.emit('relayer:started', { interval: this.config.pollIntervalMs });
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.emit('relayer:stopped');
  }

  async initiateSwap(params: {
    sourceChain: 'stellar' | 'evm';
    destinationChain: 'stellar' | 'evm';
    sourceLockId: string;
    sender: string;
    recipient: string;
    amount: string;
    hashlock: string;
    timelockSource: number;
    timelockDestination: number;
  }): Promise<CrossChainSwap> {
    const swap: CrossChainSwap = {
      id: `swap_${randomUUID()}`,
      sourceChain: params.sourceChain,
      destinationChain: params.destinationChain,
      sourceLockId: params.sourceLockId,
      destinationLockId: '',
      sender: params.sender,
      recipient: params.recipient,
      amount: params.amount,
      hashlock: params.hashlock,
      timelockSource: params.timelockSource,
      timelockDestination: params.timelockDestination,
      status: 'initiated',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.swaps.set(swap.id, swap);
    await auditService.logAction({
      action: 'relayer.swap.initiated',
      resource: 'bridge',
      resourceId: swap.id,
      details: {
        sourceChain: params.sourceChain,
        destinationChain: params.destinationChain,
        amount: params.amount,
        sender: params.sender,
      },
    });
    this.emit('swap:initiated', swap);
    return swap;
  }

  async updateSwapStatus(swapId: string, status: Partial<CrossChainSwap>): Promise<CrossChainSwap | undefined> {
    const swap = this.swaps.get(swapId);
    if (!swap) return undefined;
    Object.assign(swap, status, { updatedAt: Date.now() });
    this.swaps.set(swapId, swap);
    this.emit('swap:updated', swap);
    return swap;
  }

  async revealSecret(swapId: string, secret: string): Promise<CrossChainSwap | undefined> {
    const swap = this.swaps.get(swapId);
    if (!swap) return undefined;
    if (swap.status !== 'both_locked' && swap.status !== 'destination_locked') return undefined;
    swap.secret = secret;
    swap.status = 'redeemed';
    swap.redeemedAt = Date.now();
    swap.updatedAt = Date.now();
    this.swaps.set(swapId, swap);

    await auditService.logAction({
      action: 'relayer.swap.redeemed',
      resource: 'bridge',
      resourceId: swapId,
      details: { sourceChain: swap.sourceChain, destinationChain: swap.destinationChain },
    });
    this.emit('swap:redeemed', swap);
    return swap;
  }

  getSwap(swapId: string): CrossChainSwap | undefined {
    return this.swaps.get(swapId);
  }

  listSwaps(status?: SwapStatus): CrossChainSwap[] {
    const all = Array.from(this.swaps.values());
    return status ? all.filter(s => s.status === status) : all.sort((a, b) => b.createdAt - a.createdAt);
  }

  getAnalytics(): { total: number; volume: string; byStatus: Record<string, number>; byDirection: Record<string, number> } {
    const all = Array.from(this.swaps.values());
    const byStatus: Record<string, number> = {};
    const byDirection: Record<string, number> = {};
    let totalVolume = 0;

    for (const swap of all) {
      byStatus[swap.status] = (byStatus[swap.status] ?? 0) + 1;
      const dir = `${swap.sourceChain}-${swap.destinationChain}`;
      byDirection[dir] = (byDirection[dir] ?? 0) + 1;
      totalVolume += Number(swap.amount) || 0;
    }

    return { total: all.length, volume: String(totalVolume), byStatus, byDirection };
  }

  private async pollSwaps(): Promise<void> {
    const now = Date.now();
    for (const swap of this.swaps.values()) {
      if (swap.status === 'redeemed' || swap.status === 'refunded' || swap.status === 'failed') continue;

      if (swap.status === 'initiated' && swap.sourceLockId) {
        swap.status = 'source_locked';
        swap.sourceConfirmedAt = now;
        swap.updatedAt = now;
        this.emit('swap:source_locked', swap);
      }

      if (
        (swap.status === 'source_locked' || swap.status === 'both_locked') &&
        swap.destinationLockId
      ) {
        if (swap.status === 'source_locked') {
          swap.status = 'both_locked';
        } else {
          swap.status = 'destination_locked';
        }
        swap.destinationConfirmedAt = now;
        swap.updatedAt = now;
        this.emit('swap:destination_locked', swap);
      }

      const effectiveTimelock = Math.min(swap.timelockSource, swap.timelockDestination);
      if (now > effectiveTimelock + this.config.safetyMarginMs) {
        if (swap.status !== 'redeemed') {
          swap.status = 'expired';
          swap.refundedAt = now;
          swap.updatedAt = now;
          await auditService.logAction({
            action: 'relayer.swap.expired',
            resource: 'bridge',
            resourceId: swap.id,
            details: { sourceChain: swap.sourceChain, destinationChain: swap.destinationChain },
          });
          this.emit('swap:expired', swap);
        }
      }
    }
  }
}

export const bridgeRelayerService = new BridgeRelayerService();
