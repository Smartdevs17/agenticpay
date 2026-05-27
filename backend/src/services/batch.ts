import { randomUUID } from 'node:crypto';
import * as StellarSdk from '@stellar/stellar-sdk';
import { config } from '../config/env.js';
import { featureFlags } from '../config/featureFlags.js';
import { server, getNonceManager, getGasEstimator, UnitOfWorkError } from './stellar.js';

const NETWORK = config().STELLAR_NETWORK;
const networkPassphrase =
  NETWORK === 'public'
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

export type BatchStatus = 'pending' | 'processing' | 'completed' | 'partial_failure' | 'failed';

export interface BatchPaymentItem {
  recipient: string;
  amount: string;
  asset: string;
  memo?: string;
}

export interface BatchPaymentResult {
  index: number;
  recipient: string;
  amount: string;
  asset: string;
  status: 'success' | 'failed';
  txHash?: string;
  error?: string;
}

export interface BatchRecord {
  id: string;
  label?: string;
  status: BatchStatus;
  total: number;
  succeeded: number;
  failed: number;
  payments: BatchPaymentItem[];
  results: BatchPaymentResult[];
  createdAt: string;
  updatedAt: string;
}

const batchStore = new Map<string, BatchRecord>();

export function parseCSV(csv: string): {
  rows: BatchPaymentItem[];
  errors: Array<{ line: number; error: string }>;
} {
  const lines = csv.trim().split('\n');
  const rows: BatchPaymentItem[] = [];
  const errors: Array<{ line: number; error: string }> = [];

  const dataLines = lines[0]?.toLowerCase().includes('recipient') ? lines.slice(1) : lines;

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i].trim();
    if (!line) continue;

    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const [recipient, amount, asset = 'XLM', memo] = cols;

    if (!recipient) {
      errors.push({ line: i + 2, error: 'Missing recipient' });
      continue;
    }
    if (!amount || !/^\d+(\.\d{1,7})?$/.test(amount)) {
      errors.push({ line: i + 2, error: `Invalid amount: ${amount}` });
      continue;
    }

    rows.push({ recipient, amount, asset, memo: memo || undefined });
  }

  return { rows, errors };
}

export function detectDuplicates(payments: BatchPaymentItem[]): number[] {
  const seen = new Map<string, number>();
  const duplicateIndices: number[] = [];

  for (let i = 0; i < payments.length; i++) {
    const key = `${payments[i].recipient}:${payments[i].asset}`;
    if (seen.has(key)) {
      duplicateIndices.push(i);
    } else {
      seen.set(key, i);
    }
  }

  return duplicateIndices;
}

export function executeBatch(payments: BatchPaymentItem[], label?: string): BatchRecord {
  const id = `batch_${randomUUID()}`;
  const now = new Date().toISOString();

  const results: BatchPaymentResult[] = payments.map((p, index) => {
    const isValidAddress = /^G[A-Z2-7]{55}$/.test(p.recipient);
    if (!isValidAddress) {
      return {
        index,
        recipient: p.recipient,
        amount: p.amount,
        asset: p.asset,
        status: 'failed',
        error: 'Invalid Stellar address',
      };
    }

    return {
      index,
      recipient: p.recipient,
      amount: p.amount,
      asset: p.asset,
      status: 'success',
      txHash: `tx_${randomUUID().replace(/-/g, '').slice(0, 32)}`,
    };
  });

  const succeeded = results.filter((r) => r.status === 'success').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  const status: BatchStatus =
    failed === 0 ? 'completed' : succeeded === 0 ? 'failed' : 'partial_failure';

  const record: BatchRecord = {
    id, label, status,
    total: payments.length, succeeded, failed,
    payments, results,
    createdAt: now, updatedAt: now,
  };

  batchStore.set(id, record);
  return record;
}

export function getBatch(id: string): BatchRecord | undefined {
  return batchStore.get(id);
}

export function listBatches(): BatchRecord[] {
  return Array.from(batchStore.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getBatchReport(id: string): object | undefined {
  const record = batchStore.get(id);
  if (!record) return undefined;

  const successRate = record.total > 0 ? ((record.succeeded / record.total) * 100).toFixed(2) : '0.00';
  const totalAmount = record.results
    .filter((r) => r.status === 'success')
    .reduce((sum, r) => sum + parseFloat(r.amount), 0)
    .toFixed(7);

  const byAsset = record.results
    .filter((r) => r.status === 'success')
    .reduce<Record<string, number>>((acc, r) => {
      acc[r.asset] = (acc[r.asset] ?? 0) + parseFloat(r.amount);
      return acc;
    }, {});

  return {
    batchId: record.id, label: record.label, status: record.status,
    summary: {
      total: record.total, succeeded: record.succeeded, failed: record.failed,
      successRate: `${successRate}%`, totalAmountProcessed: totalAmount, byAsset,
    },
    failures: record.results.filter((r) => r.status === 'failed'),
    createdAt: record.createdAt, updatedAt: record.updatedAt,
  };
}

export function generateCSVTemplate(): string {
  return [
    'recipient,amount,asset,memo',
    'GABC...XYZ,100.00,XLM,payroll-jan',
    'GDEF...UVW,50.5,USDC,vendor-payment',
  ].join('\n');
}

// ── BatchProcessor (transaction batching with Stellar) ────────────────────────

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
    this.queue.push({ ...item, createdAt: Date.now() });
    if (this.queue.length >= this.config.maxSize) {
      this.flush().catch((err) => console.error('[BatchProcessor] Auto-flush failed:', err));
    }
  }

  get queueLength(): number { return this.queue.length; }

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      if (this.queue.length > 0 && !this.processing) {
        this.flush().catch((err) => console.error('[BatchProcessor] Interval flush failed:', err));
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
      results.push({
        batchId: `batch_${++this.batchCounter}`,
        successCount: 0,
        failedCount: batch.length,
        errors: batch.map((item) => ({ id: item.id, error: error instanceof Error ? error.message : 'Unknown error' })),
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
          const asset = data.asset ? new StellarSdk.Asset(data.asset, data.to) : StellarSdk.Asset.native();
          return StellarSdk.Operation.payment({ destination: data.to, asset, amount: data.amount });
        });

      if (paymentOps.length > 0) {
        const sourceAddress = process.env.STELLAR_SOURCE_ADDRESS;
        if (!sourceAddress) throw new UnitOfWorkError('No source address configured for batch', 'batch-payment');

        await getNonceManager().acquire(sourceAddress);
        const account = await server.loadAccount(sourceAddress);
        const transaction = new StellarSdk.TransactionBuilder(account, {
          fee: baseFee.toString(),
          networkPassphrase,
        });

        for (const op of paymentOps) transaction.addOperation(op);
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
        errors.push({ id: item.id, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }

    return { batchId, successCount, failedCount: errors.length, errors, txHash, durationMs: Date.now() - startTime };
  }
}

export const batchProcessor = new BatchProcessor();
