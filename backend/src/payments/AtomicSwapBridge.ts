import type { NetworkId } from './NetworkRegistry.js';

export interface SwapIntent {
  fromNetwork: NetworkId;
  toNetwork: NetworkId;
  fromAsset: string;
  toAsset: string;
  amount: string;
  recipientAddress: string;
  refundAddress: string;
  timeoutMinutes: number;
  price: string;
  expiresAt: number;
}

export interface SwapState {
  intentId: string;
  status: 'pending' | 'locked' | 'claimed' | 'refunded' | 'expired';
  fromTxHash?: string;
  toTxHash?: string;
  createdAt: number;
  updatedAt: number;
  secretHash: string;
}

export class AtomicSwapBridge {
  private swaps = new Map<string, SwapState>();

  async createSwap(intent: Omit<SwapIntent, 'expiresAt'>): Promise<{ intentId: string; secretHash: string }> {
    const intentId = `swap_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const secret = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
    const secretHash = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');

    this.swaps.set(intentId, {
      intentId, status: 'pending', createdAt: Date.now(), updatedAt: Date.now(), secretHash,
    });

    return { intentId, secretHash };
  }

  async lockSwap(intentId: string, fromTxHash: string): Promise<SwapState | null> {
    const swap = this.swaps.get(intentId);
    if (!swap || swap.status !== 'pending') return null;
    swap.status = 'locked';
    swap.fromTxHash = fromTxHash;
    swap.updatedAt = Date.now();
    this.swaps.set(intentId, swap);
    return swap;
  }

  async claimSwap(intentId: string, secret: string, toTxHash: string): Promise<SwapState | null> {
    const swap = this.swaps.get(intentId);
    if (!swap || swap.status !== 'locked') return null;
    swap.status = 'claimed';
    swap.toTxHash = toTxHash;
    swap.updatedAt = Date.now();
    this.swaps.set(intentId, swap);
    return swap;
  }

  async refundSwap(intentId: string): Promise<SwapState | null> {
    const swap = this.swaps.get(intentId);
    if (!swap || swap.status !== 'locked') return null;
    swap.status = 'refunded';
    swap.updatedAt = Date.now();
    this.swaps.set(intentId, swap);
    return swap;
  }

  getSwap(intentId: string): SwapState | undefined {
    return this.swaps.get(intentId);
  }

  listSwaps(status?: SwapState['status']): SwapState[] {
    const all = Array.from(this.swaps.values());
    return status ? all.filter(s => s.status === status) : all;
  }
}

export const atomicSwapBridge = new AtomicSwapBridge();
