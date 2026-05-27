/**
 * Payment Approval Queue with Scheduled Execution
 * Supports time-based, block-height, and price-condition triggers.
 * Persists queue to disk so entries survive restarts.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type TriggerType = 'time' | 'block' | 'price';
export type PaymentStatus =
  | 'pending'
  | 'executing'
  | 'executed'
  | 'failed'
  | 'cancelled'
  | 'missed';

export interface TimeTrigger {
  type: 'time';
  executeAt: string; // ISO 8601
}

export interface BlockTrigger {
  type: 'block';
  blockHeight: number;
}

export interface PriceTrigger {
  type: 'price';
  /** Execute when XLM/USD price drops below this value */
  maxPrice: number;
}

export type Trigger = TimeTrigger | BlockTrigger | PriceTrigger;

export interface ScheduledPayment {
  id: string;
  from: string;
  to: string;
  amount: string;
  asset: string;
  trigger: Trigger;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
  executedAt?: string;
  failureReason?: string;
  /** Notification sent when status changes */
  notifyUrl?: string;
}

export interface CreatePaymentInput {
  from: string;
  to: string;
  amount: string;
  asset?: string;
  trigger: Trigger;
  notifyUrl?: string;
}

const PERSIST_DIR = join(process.cwd(), '.queue-data');
const PERSIST_FILE = join(PERSIST_DIR, 'payment-queue.json');
const POLL_INTERVAL_MS = 5_000;
const MISSED_THRESHOLD_MS = 60_000; // 1 min past scheduled time = missed

class PaymentQueue {
  private payments: Map<string, ScheduledPayment> = new Map();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor() {
    this.load();
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private load(): void {
    try {
      if (existsSync(PERSIST_FILE)) {
        const raw = readFileSync(PERSIST_FILE, 'utf-8');
        const entries: ScheduledPayment[] = JSON.parse(raw);
        for (const p of entries) {
          this.payments.set(p.id, p);
        }
      }
    } catch {
      // corrupt file — start fresh
    }
  }

  private persist(): void {
    try {
      if (!existsSync(PERSIST_DIR)) {
        mkdirSync(PERSIST_DIR, { recursive: true });
      }
      writeFileSync(PERSIST_FILE, JSON.stringify(Array.from(this.payments.values()), null, 2));
    } catch (err) {
      console.error('[PaymentQueue] Failed to persist queue:', err);
    }
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  schedule(input: CreatePaymentInput): ScheduledPayment {
    const now = new Date().toISOString();
    const payment: ScheduledPayment = {
      id: `pq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from: input.from,
      to: input.to,
      amount: input.amount,
      asset: input.asset ?? 'XLM',
      trigger: input.trigger,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      notifyUrl: input.notifyUrl,
    };
    this.payments.set(payment.id, payment);
    this.persist();
    return payment;
  }

  get(id: string): ScheduledPayment | undefined {
    return this.payments.get(id);
  }

  list(status?: PaymentStatus): ScheduledPayment[] {
    const all = Array.from(this.payments.values());
    return status ? all.filter((p) => p.status === status) : all;
  }

  cancel(id: string): boolean {
    const p = this.payments.get(id);
    if (!p || p.status !== 'pending') return false;
    this.update(p, { status: 'cancelled' });
    return true;
  }

  delete(id: string): boolean {
    const existed = this.payments.has(id);
    this.payments.delete(id);
    if (existed) this.persist();
    return existed;
  }

  stats() {
    const all = Array.from(this.payments.values());
    const count = (s: PaymentStatus) => all.filter((p) => p.status === s).length;
    return {
      total: all.length,
      pending: count('pending'),
      executing: count('executing'),
      executed: count('executed'),
      failed: count('failed'),
      cancelled: count('cancelled'),
      missed: count('missed'),
    };
  }

  // ── Scheduler ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    console.log('[PaymentQueue] Scheduler started');
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    console.log('[PaymentQueue] Scheduler stopped');
  }

  /** Exposed for testing */
  async tick(context?: { currentBlock?: number; xlmUsdPrice?: number }): Promise<void> {
    const now = Date.now();
    const pending = Array.from(this.payments.values()).filter((p) => p.status === 'pending');

    for (const p of pending) {
      const due = this.isDue(p, now, context);
      if (due === 'missed') {
        this.update(p, { status: 'missed', failureReason: 'Execution window passed without trigger' });
        void this.notify(p);
        continue;
      }
      if (!due) continue;

      this.update(p, { status: 'executing' });
      try {
        await this.execute(p);
        this.update(p, { status: 'executed', executedAt: new Date().toISOString() });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.update(p, { status: 'failed', failureReason: reason });
      }
      void this.notify(p);
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private isDue(
    p: ScheduledPayment,
    nowMs: number,
    ctx?: { currentBlock?: number; xlmUsdPrice?: number }
  ): boolean | 'missed' {
    const { trigger } = p;

    if (trigger.type === 'time') {
      const executeAt = new Date(trigger.executeAt).getTime();
      if (nowMs >= executeAt + MISSED_THRESHOLD_MS) return 'missed';
      return nowMs >= executeAt;
    }

    if (trigger.type === 'block') {
      const block = ctx?.currentBlock;
      if (block === undefined) return false;
      return block >= trigger.blockHeight;
    }

    if (trigger.type === 'price') {
      const price = ctx?.xlmUsdPrice;
      if (price === undefined) return false;
      return price <= trigger.maxPrice;
    }

    return false;
  }

  private async execute(p: ScheduledPayment): Promise<void> {
    // Stub: in production this calls the Stellar SDK / Soroban contract
    console.log(`[PaymentQueue] Executing payment ${p.id}: ${p.amount} ${p.asset} from ${p.from} to ${p.to}`);
    // Simulate async work
    await Promise.resolve();
  }

  private async notify(p: ScheduledPayment): Promise<void> {
    if (!p.notifyUrl) return;
    try {
      await fetch(p.notifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: p.id, status: p.status }),
      });
    } catch {
      // best-effort notification
    }
  }

  private update(p: ScheduledPayment, patch: Partial<ScheduledPayment>): void {
    Object.assign(p, patch, { updatedAt: new Date().toISOString() });
    this.persist();
  }
}

export const paymentQueue = new PaymentQueue();
