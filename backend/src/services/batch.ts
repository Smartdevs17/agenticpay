import * as StellarSdk from '@stellar/stellar-sdk';
import { config } from '../config/env.js';
import { featureFlags } from '../config/featureFlags.js';
import { server, getNonceManager, getGasEstimator, UnitOfWorkError } from './stellar.js';

const NETWORK = config().STELLAR_NETWORK;
const networkPassphrase =
  NETWORK === 'public'
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

export interface BatchItem<T = unknown> {
  id: string;
  type: string;
  data: T;
  priority: number;
  createdAt: number;
}

export interface BatchConfig {
  maxSize: number;
  maxWaitMs: number;
  flushIntervalMs: number;
  maxRetries: number;
}

export const DEFAULT_BATCH_CONFIG: BatchConfig = {
  maxSize: 50,
  maxWaitMs: 5000,
  flushIntervalMs: 1000,
  maxRetries: 3,
};

export interface BatchResult {
  batchId: string;
  successCount: number;
  failedCount: number;
  errors: Array<{ id: string; error: string }>;
  txHash?: string;
  durationMs: number;
}

export class BatchProcessor {
  private queue: BatchItem[] = [];
  private config: BatchConfig;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private batchCounter = 0;

  constructor(config: Partial<BatchConfig> = {}) {
    this.config = { ...DEFAULT_BATCH_CONFIG, ...config };
  }

  isEnabled(): boolean {
    return featureFlags.evaluate('batch-operations');
  }

  enqueue<T>(item: Omit<BatchItem<T>, 'createdAt'>): void {
    this.queue.push({
      ...item,
      createdAt: Date.now(),
    });

    if (this.queue.length >= this.config.maxSize) {
      this.flush().catch((err) => {
        console.error('[BatchProcessor] Auto-flush failed:', err);
      });
    }
  }

  get queueLength(): number {
    return this.queue.length;
  }

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      if (this.queue.length > 0 && !this.processing) {
        this.flush().catch((err) => {
          console.error('[BatchProcessor] Interval flush failed:', err);
        });
      }
    }, this.config.flushIntervalMs);
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  async flush(): Promise<BatchResult[]> {
    if (this.processing || this.queue.length === 0) return [];

    this.processing = true;
    const batch = this.queue.splice(0, this.config.maxSize);
    const results: BatchResult[] = [];

    try {
      const result = await this.processBatch(batch);
      results.push(result);
    } catch (error) {
      console.error('[BatchProcessor] Batch processing error:', error);
      results.push({
        batchId: `batch_${++this.batchCounter}`,
        successCount: 0,
        failedCount: batch.length,
        errors: batch.map((item) => ({
          id: item.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        })),
        durationMs: 0,
      });
    }

    this.processing = false;
    return results;
  }

  private async processBatch(batch: BatchItem[]): Promise<BatchResult> {
    const batchId = `batch_${++this.batchCounter}_${Date.now()}`;
    const startTime = Date.now();
    const errors: Array<{ id: string; error: string }> = [];
    let successCount = 0;
    let txHash: string | undefined;

    const feeEstimate = await getGasEstimator().estimateFee(batch.length + 1);
    const baseFee = feeEstimate.recommended;

    try {
      const paymentOps = batch
        .filter((item) => item.type === 'payment')
        .map((item) => {
          const data = item.data as { to: string; amount: string; asset?: string };
          const asset = data.asset
            ? new StellarSdk.Asset(data.asset, data.to)
            : StellarSdk.Asset.native();
          return StellarSdk.Operation.payment({
            destination: data.to,
            asset,
            amount: data.amount,
          });
        });

      if (paymentOps.length > 0) {
        const sourceAddress = config().STELLAR_NETWORK === 'testnet'
          ? process.env.STELLAR_SOURCE_ADDRESS
          : process.env.STELLAR_SOURCE_ADDRESS;

        if (!sourceAddress) {
          throw new UnitOfWorkError('No source address configured for batch', 'batch-payment');
        }

        const nonce = await getNonceManager().acquire(sourceAddress);

        const account = await server.loadAccount(sourceAddress);
        const transaction = new StellarSdk.TransactionBuilder(account, {
          fee: baseFee.toString(),
          networkPassphrase,
        });

        for (const op of paymentOps) {
          transaction.addOperation(op);
        }

        const tx = transaction.setTimeout(30).build();
        txHash = tx.hash.toString('hex');

        successCount = paymentOps.length;
        getNonceManager().increment(sourceAddress);
        getNonceManager().release(sourceAddress);
      } else {
        successCount = batch.filter((item) => item.type !== 'payment').length;
      }
    } catch (error) {
      for (const item of batch) {
        errors.push({
          id: item.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return {
      batchId,
      successCount,
      failedCount: errors.length,
      errors,
      txHash,
      durationMs: Date.now() - startTime,
    };
  }
}

export const batchProcessor = new BatchProcessor();
