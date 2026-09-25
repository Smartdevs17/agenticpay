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

/**
 * Split a single CSV record into fields, honouring RFC 4180 quoting.
 *
 * A quoted field may contain commas, and a literal quote inside a quoted field
 * is escaped by doubling it (`""`). The previous implementation used a bare
 * `split(',')`, so a memo such as `"Invoice 12, net 30"` was torn into two
 * columns and every field after it shifted left.
 */
function parseCsvRecord(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let fieldStarted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      continue;
    }

    if (char === ',') {
      fields.push(current.trim());
      current = '';
      fieldStarted = false;
      continue;
    }

    fieldStarted = true;
    current += char;
  }

  fields.push(current.trim());
  return fields;
}

/** Canonical field names, mapped onto whatever order the header declares. */
const CSV_FIELDS = ['recipient', 'amount', 'asset', 'memo'] as const;

export function parseCSV(csv: string): {
  rows: BatchPaymentItem[];
  errors: Array<{ line: number; error: string }>;
} {
  // Normalise CRLF/CR line endings so a spreadsheet export on Windows does not
  // leave a trailing \r inside the last field of every row.
  const lines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  const rows: BatchPaymentItem[] = [];
  const errors: Array<{ line: number; error: string }> = [];

  // Map columns by header name when a header row is present. Reading columns
  // purely by position meant a file without an `asset` column had its memo
  // consumed as the asset ticker.
  let header: Partial<Record<(typeof CSV_FIELDS)[number], number>> | undefined;
  const firstCells = lines[0] ? parseCsvRecord(lines[0]).map((c) => c.toLowerCase()) : [];
  if (firstCells.includes('recipient') || firstCells.includes('amount')) {
    header = {};
    for (const field of CSV_FIELDS) {
      const index = firstCells.indexOf(field);
      if (index !== -1) header[field] = index;
    }
  }

  const dataLines = header ? lines.slice(1) : lines;

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i].trim();
    if (!line) continue;

    const cols = parseCsvRecord(line);
    const at = (field: (typeof CSV_FIELDS)[number], position: number): string | undefined => {
      const index = header ? header[field] : position;
      return index === undefined ? undefined : cols[index];
    };

    const recipient = at('recipient', 0) ?? '';
    const amount = at('amount', 1) ?? '';
    const asset = at('asset', 2) || 'XLM';
    const memo = at('memo', 3);

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

export interface RollbackResult {
  batchId: string;
  rolledBackPayments: string[];
  failedRollbacks: Array<{ recipient: string; error: string }>;
  status: 'fully_rolled_back' | 'partially_rolled_back';
}

export function rollbackBatch(batchId: string): RollbackResult | undefined {
  const record = batchStore.get(batchId);
  if (!record) return undefined;
  if (record.status === 'failed') {
    return {
      batchId,
      rolledBackPayments: [],
      failedRollbacks: record.payments.map((p) => ({ recipient: p.recipient, error: 'Batch had no successful payments' })),
      status: 'fully_rolled_back',
    };
  }

  const rolledBackPayments: string[] = [];
  const failedRollbacks: Array<{ recipient: string; error: string }> = [];

  for (const result of record.results) {
    if (result.status === 'success') {
      rolledBackPayments.push(result.recipient);
    }
  }

  if (failedRollbacks.length === 0) {
    record.status = 'completed';
    for (const r of record.results) {
      if (r.status === 'success') r.status = 'failed';
      r.error = r.error ? `${r.error}; rolled back` : 'rolled back';
    }
  }

  record.updatedAt = new Date().toISOString();
  batchStore.set(batchId, record);

  return {
    batchId,
    rolledBackPayments,
    failedRollbacks,
    status: failedRollbacks.length === 0 ? 'fully_rolled_back' : 'partially_rolled_back',
  };
}

export function getBatchHistory(filters?: { status?: BatchStatus; from?: string; to?: string }): BatchRecord[] {
  let entries = Array.from(batchStore.values());
  if (filters?.status) {
    entries = entries.filter((e) => e.status === filters.status);
  }
  if (filters?.from) {
    const from = new Date(filters.from).getTime();
    entries = entries.filter((e) => new Date(e.createdAt).getTime() >= from);
  }
  if (filters?.to) {
    const to = new Date(filters.to).getTime();
    entries = entries.filter((e) => new Date(e.createdAt).getTime() <= to);
  }
  return entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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

// ── Dry-Run Estimation ───────────────────────────────────────────────────────

export interface BatchEstimate {
  totalPayments: number;
  /** Totals broken down by asset. Amounts in different assets are not
   *  comparable, so they are never combined into one figure. */
  byAsset: Record<string, string>;
  /**
   * Combined total. Only meaningful when every payment uses the same asset;
   * `null` for a mixed-asset batch. Read `byAsset` for those.
   */
  totalAmount: string | null;
  estimatedGasUnits: number;
  duplicateCount: number;
  invalidAddressCount: number;
  estimatedDurationMs: number;
}

/** Stellar amounts carry at most 7 decimal places. */
const AMOUNT_DECIMALS = 7;
const AMOUNT_SCALE = 10 ** AMOUNT_DECIMALS;

/**
 * Parse a decimal amount string into integer minor units.
 * Avoids binary floating point drift when many rows are summed.
 */
function toMinorUnits(amount: string): number {
  const [whole = '0', fraction = ''] = amount.split('.');
  const padded = fraction.padEnd(AMOUNT_DECIMALS, '0').slice(0, AMOUNT_DECIMALS);
  return Number(whole) * AMOUNT_SCALE + Number(padded || '0');
}

function fromMinorUnits(minor: number): string {
  return (minor / AMOUNT_SCALE).toFixed(AMOUNT_DECIMALS);
}

export function estimateBatch(payments: BatchPaymentItem[]): BatchEstimate {
  const byAssetMinor: Record<string, number> = {};
  let invalidCount = 0;

  for (const p of payments) {
    if (!/^G[A-Z2-7]{55}$/.test(p.recipient)) {
      invalidCount++;
      continue;
    }
    const minor = toMinorUnits(p.amount);
    byAssetMinor[p.asset] = (byAssetMinor[p.asset] ?? 0) + minor;
  }

  const duplicateIndices = detectDuplicates(payments);
  const byAsset: Record<string, string> = {};
  for (const [asset, minor] of Object.entries(byAssetMinor)) {
    byAsset[asset] = fromMinorUnits(minor);
  }

  // Only combine when the batch is single-asset; otherwise a total would add
  // incomparable units together.
  const assets = Object.keys(byAssetMinor);
  const totalAmount = assets.length === 1 ? byAsset[assets[0]] : null;

  return {
    totalPayments: payments.length,
    totalAmount,
    byAsset,
    estimatedGasUnits: payments.length * 100 + 100, // rough Stellar estimate
    duplicateCount: duplicateIndices.length,
    invalidAddressCount: invalidCount,
    estimatedDurationMs: payments.length * 50 + 500, // rough estimate
  };
}

// ── Scheduled Batch Execution ────────────────────────────────────────────────

export interface ScheduledBatch {
  id: string;
  label?: string;
  payments: BatchPaymentItem[];
  scheduledAt: string;
  executeAt: string;
  status: 'scheduled' | 'executed' | 'cancelled' | 'failed';
  result?: BatchRecord;
  createdAt: string;
}

const scheduledBatches = new Map<string, ScheduledBatch>();
let scheduleTimer: ReturnType<typeof setInterval> | null = null;

export function scheduleBatch(
  payments: BatchPaymentItem[],
  executeAt: string,
  label?: string
): ScheduledBatch {
  const id = `sched_${randomUUID()}`;
  const now = new Date().toISOString();
  const scheduled: ScheduledBatch = {
    id,
    label,
    payments,
    scheduledAt: now,
    executeAt,
    status: 'scheduled',
    createdAt: now,
  };
  scheduledBatches.set(id, scheduled);
  startScheduleProcessor();
  return scheduled;
}

export function listScheduledBatches(): ScheduledBatch[] {
  return Array.from(scheduledBatches.values()).sort(
    (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()
  );
}

export function cancelScheduledBatch(id: string): ScheduledBatch | undefined {
  const batch = scheduledBatches.get(id);
  if (!batch || batch.status !== 'scheduled') return undefined;
  batch.status = 'cancelled';
  scheduledBatches.set(id, batch);
  return batch;
}

export function getScheduledBatch(id: string): ScheduledBatch | undefined {
  return scheduledBatches.get(id);
}

function processScheduledBatches(): void {
  const now = Date.now();
  const due = Array.from(scheduledBatches.values()).filter(
    (b) => b.status === 'scheduled' && new Date(b.executeAt).getTime() <= now
  );

  for (const batch of due) {
    try {
      const result = executeBatch(batch.payments, batch.label);
      batch.result = result;
      batch.status = 'executed';
    } catch (error) {
      batch.status = 'failed';
    }
    scheduledBatches.set(batch.id, batch);
  }
}

function startScheduleProcessor(): void {
  if (scheduleTimer) return;
  scheduleTimer = setInterval(() => {
    processScheduledBatches();
  }, 5_000);
}

export function stopScheduleProcessor(): void {
  if (scheduleTimer) {
    clearInterval(scheduleTimer);
    scheduleTimer = null;
  }
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
