/**
 * transaction-monitor.ts — Issue #402
 *
 * Blockchain transaction monitoring and alerting.
 * Tracks transaction status from submission to finality, detects stuck/failed
 * transactions, performs automated retry for transient failures, and emits
 * alerts via configurable channels.
 */

import { randomUUID } from 'node:crypto';
import { server, isValidTransactionHash } from './stellar.js';
import { classifyFailure } from './failure-analysis.js';
import { withCircuitBreaker } from '../middleware/circuit-breaker.js';

const STELLAR_CIRCUIT_NAME = 'stellar-horizon';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TxStatus =
  | 'pending'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'stuck'
  | 'dropped'
  | 'reorged';

export type AlertChannel = 'webhook' | 'email' | 'push';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface TrackedTransaction {
  id: string;
  txHash: string;
  sourceAddress?: string;
  status: TxStatus;
  submittedAt: string;
  lastCheckedAt: string;
  confirmedAt?: string;
  failedAt?: string;
  ledger?: number;
  retryCount: number;
  maxRetries: number;
  errorMessage?: string;
  network?: string;
  metadata?: Record<string, unknown>;
}

export interface TransactionAlert {
  id: string;
  txId: string;
  txHash: string;
  severity: AlertSeverity;
  channel: AlertChannel;
  message: string;
  sentAt: string;
  acknowledged: boolean;
}

export interface MonitorHealthSummary {
  total: number;
  byStatus: Record<TxStatus, number>;
  alertsPending: number;
  oldestPendingMs: number;
}

export interface MonitorOptions {
  /** How often to poll for status updates (ms). Default 15 000. */
  pollIntervalMs?: number;
  /** Transactions with no progress beyond this age are marked stuck (ms). Default 300 000. */
  stuckThresholdMs?: number;
  /** Max automatic retries for transient failures. Default 3. */
  maxRetries?: number;
  /** Webhook URL for critical alerts. */
  webhookUrl?: string;
  /** Alert channels to use. */
  channels?: AlertChannel[];
}

// ── State ─────────────────────────────────────────────────────────────────────

const transactions = new Map<string, TrackedTransaction>();
const alerts: TransactionAlert[] = [];
const MAX_ALERTS = 2000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function emitAlert(
  tx: TrackedTransaction,
  severity: AlertSeverity,
  message: string,
  channels: AlertChannel[],
): void {
  for (const channel of channels) {
    const alert: TransactionAlert = {
      id: randomUUID(),
      txId: tx.id,
      txHash: tx.txHash,
      severity,
      channel,
      message,
      sentAt: new Date().toISOString(),
      acknowledged: false,
    };
    alerts.push(alert);
    if (alerts.length > MAX_ALERTS) alerts.shift();

    if (channel === 'webhook') {
      // Fire-and-forget; caller can inspect alerts for delivery status.
      void dispatchWebhookAlert(alert).catch(() => undefined);
    }
  }
}

async function dispatchWebhookAlert(alert: TransactionAlert): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    const { default: fetch } = await import('node-fetch');
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alert),
    });
  } catch {
    // Webhook delivery failure is non-fatal
  }
}

function isTransient(errorMessage: string): boolean {
  return /timeout|network|connection|econnreset|503|rate.?limit/i.test(errorMessage);
}

// ── Core monitor ──────────────────────────────────────────────────────────────

export class TransactionMonitor {
  private pollIntervalMs: number;
  private stuckThresholdMs: number;
  private maxRetries: number;
  private channels: AlertChannel[];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: MonitorOptions = {}) {
    this.pollIntervalMs = opts.pollIntervalMs ?? 15_000;
    this.stuckThresholdMs = opts.stuckThresholdMs ?? 300_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.channels = opts.channels ?? ['webhook'];
  }

  /** Register a submitted transaction for tracking. */
  track(txHash: string, opts: {
    sourceAddress?: string;
    network?: string;
    metadata?: Record<string, unknown>;
    maxRetries?: number;
  } = {}): TrackedTransaction {
    if (!isValidTransactionHash(txHash)) {
      throw new Error(`Invalid transaction hash: ${txHash}`);
    }

    const existing = this.findByHash(txHash);
    if (existing) return existing;

    const tx: TrackedTransaction = {
      id: randomUUID(),
      txHash,
      sourceAddress: opts.sourceAddress,
      status: 'submitted',
      submittedAt: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString(),
      retryCount: 0,
      maxRetries: opts.maxRetries ?? this.maxRetries,
      network: opts.network,
      metadata: opts.metadata,
    };

    transactions.set(tx.id, tx);
    return tx;
  }

  /** Start the polling loop. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  /** Stop the polling loop. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Poll all active transactions once. */
  async poll(): Promise<void> {
    const active = Array.from(transactions.values()).filter(
      (tx) => tx.status === 'submitted' || tx.status === 'pending' || tx.status === 'stuck',
    );

    await Promise.allSettled(active.map((tx) => this.checkTransaction(tx)));
  }

  private async checkTransaction(tx: TrackedTransaction): Promise<void> {
    tx.lastCheckedAt = new Date().toISOString();

    // Stuck detection
    const ageMs = Date.now() - new Date(tx.submittedAt).getTime();
    if (ageMs > this.stuckThresholdMs && tx.status === 'submitted') {
      tx.status = 'stuck';
      transactions.set(tx.id, tx);
      emitAlert(
        tx,
        'warning',
        `Transaction ${tx.txHash} has been pending for ${Math.round(ageMs / 1000)}s without confirmation.`,
        this.channels,
      );
    }

    try {
      const result = await withCircuitBreaker(
        STELLAR_CIRCUIT_NAME,
        () => server.transactions().transaction(tx.txHash).call(),
      );

      if (result.successful) {
        tx.status = 'confirmed';
        tx.confirmedAt = new Date().toISOString();
        tx.ledger = result.ledger_attr;
        transactions.set(tx.id, tx);
      } else {
        // Transaction on-chain but failed
        this.handleFailure(tx, 'Transaction included in ledger but marked unsuccessful');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // 404 from Horizon means not yet included — still pending
      if (/not found|404/i.test(errorMessage)) {
        return;
      }

      // Mempool eviction / dropped
      if (/evicted|dropped|mempool/i.test(errorMessage)) {
        tx.status = 'dropped';
        tx.errorMessage = errorMessage;
        tx.failedAt = new Date().toISOString();
        transactions.set(tx.id, tx);
        emitAlert(tx, 'critical', `Transaction ${tx.txHash} was evicted from the mempool.`, this.channels);
        return;
      }

      // Transient errors get a retry
      if (isTransient(errorMessage) && tx.retryCount < tx.maxRetries) {
        tx.retryCount += 1;
        transactions.set(tx.id, tx);
        return;
      }

      this.handleFailure(tx, errorMessage);
    }
  }

  private handleFailure(tx: TrackedTransaction, errorMessage: string): void {
    const analysis = classifyFailure({ txHash: tx.txHash, errorMessage });

    tx.status = 'failed';
    tx.errorMessage = errorMessage;
    tx.failedAt = new Date().toISOString();
    transactions.set(tx.id, tx);

    const severity: AlertSeverity = analysis.severity === 'critical' ? 'critical' : 'warning';
    emitAlert(
      tx,
      severity,
      `Transaction ${tx.txHash} failed: ${analysis.rootCause}`,
      this.channels,
    );
  }

  /** Handle a potential chain reorg for a confirmed transaction. */
  markReorged(txHash: string): TrackedTransaction | undefined {
    const tx = this.findByHash(txHash);
    if (!tx) return undefined;

    tx.status = 'reorged';
    tx.confirmedAt = undefined;
    transactions.set(tx.id, tx);
    emitAlert(
      tx,
      'critical',
      `Transaction ${tx.txHash} was orphaned by a chain reorganisation.`,
      this.channels,
    );
    return tx;
  }

  findByHash(txHash: string): TrackedTransaction | undefined {
    return Array.from(transactions.values()).find((t) => t.txHash === txHash);
  }

  getById(id: string): TrackedTransaction | undefined {
    return transactions.get(id);
  }

  getAll(): TrackedTransaction[] {
    return Array.from(transactions.values());
  }

  getByStatus(status: TxStatus): TrackedTransaction[] {
    return Array.from(transactions.values()).filter((t) => t.status === status);
  }

  getAlerts(unacknowledgedOnly = false): TransactionAlert[] {
    return unacknowledgedOnly ? alerts.filter((a) => !a.acknowledged) : [...alerts];
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = alerts.find((a) => a.id === alertId);
    if (!alert) return false;
    alert.acknowledged = true;
    return true;
  }

  healthSummary(): MonitorHealthSummary {
    const all = Array.from(transactions.values());
    const byStatus: Record<TxStatus, number> = {
      pending: 0, submitted: 0, confirmed: 0, failed: 0, stuck: 0, dropped: 0, reorged: 0,
    };
    let oldest = 0;

    for (const tx of all) {
      byStatus[tx.status] += 1;
      if (tx.status === 'submitted' || tx.status === 'pending' || tx.status === 'stuck') {
        const age = Date.now() - new Date(tx.submittedAt).getTime();
        if (age > oldest) oldest = age;
      }
    }

    return {
      total: all.length,
      byStatus,
      alertsPending: alerts.filter((a) => !a.acknowledged).length,
      oldestPendingMs: oldest,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _monitor: TransactionMonitor | undefined;

export function getTransactionMonitor(): TransactionMonitor {
  if (!_monitor) {
    _monitor = new TransactionMonitor({
      pollIntervalMs: Number(process.env.TX_MONITOR_POLL_MS ?? 15_000),
      stuckThresholdMs: Number(process.env.TX_MONITOR_STUCK_THRESHOLD_MS ?? 300_000),
      maxRetries: Number(process.env.TX_MONITOR_MAX_RETRIES ?? 3),
      channels: ['webhook'],
    });
    _monitor.start();
  }
  return _monitor;
}
