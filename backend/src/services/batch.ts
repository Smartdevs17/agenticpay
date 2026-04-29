import { randomUUID } from 'node:crypto';

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

/** Parse CSV text into payment rows. Returns parsed rows and per-row errors. */
export function parseCSV(csv: string): {
  rows: BatchPaymentItem[];
  errors: Array<{ line: number; error: string }>;
} {
  const lines = csv.trim().split('\n');
  const rows: BatchPaymentItem[] = [];
  const errors: Array<{ line: number; error: string }> = [];

  // Skip header row
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

/** Detect duplicate recipients within a payment list. */
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

/** Create a batch record and simulate execution with partial failure handling. */
export function executeBatch(payments: BatchPaymentItem[], label?: string): BatchRecord {
  const id = `batch_${randomUUID()}`;
  const now = new Date().toISOString();

  const results: BatchPaymentResult[] = payments.map((p, index) => {
    // Simulate: invalid Stellar address format fails
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
    id,
    label,
    status,
    total: payments.length,
    succeeded,
    failed,
    payments,
    results,
    createdAt: now,
    updatedAt: now,
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
    batchId: record.id,
    label: record.label,
    status: record.status,
    summary: {
      total: record.total,
      succeeded: record.succeeded,
      failed: record.failed,
      successRate: `${successRate}%`,
      totalAmountProcessed: totalAmount,
      byAsset,
    },
    failures: record.results.filter((r) => r.status === 'failed'),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Generate a CSV template string for download. */
export function generateCSVTemplate(): string {
  return [
    'recipient,amount,asset,memo',
    'GABC...XYZ,100.00,XLM,payroll-jan',
    'GDEF...UVW,50.5,USDC,vendor-payment',
  ].join('\n');
}
