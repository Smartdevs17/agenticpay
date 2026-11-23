/**
 * Replay receipts for every inbound webhook (#1472).
 *
 * Every verified webhook delivery is recorded as a row in `webhook_receipts`
 * before its handler runs. The row is the single answer to "have we already
 * acted on this delivery?", and it is shared by every API instance because it
 * lives in Postgres rather than in process memory.
 *
 * A delivery is identified two ways, and either match makes it a duplicate:
 *
 *  - `(provider, event_id)`: the provider's own event / delivery ID. This
 *    catches provider retries, which re-sign the same event with a new
 *    timestamp.
 *  - `(provider, signature_hash)`: SHA-256 of the signature header. For
 *    several providers the event ID arrives in an unsigned header
 *    (`X-Webhook-Id`, `PayPal-Transmission-Id`) or is generated locally when
 *    absent, so an attacker replaying a captured request could change or drop
 *    it. The signature is bound to the signed bytes, so a byte-for-byte replay
 *    always collides here, whatever the ID header says.
 *
 * A receipt is final only once the handler answered 2xx. If the handler fails
 * (any non-2xx, or the client disconnects) the receipt is marked `failed` and
 * the provider's next retry may claim it again. A claim that was never
 * finished (the process died mid-handler) can be reclaimed after
 * `processingLeaseMs`.
 *
 * Receipts are kept for `retentionMs`. Deliveries whose signed event time is
 * older than `maxEventAgeMs` (which must be shorter than the retention) are
 * rejected outright, so pruning a receipt never re-opens its event for replay.
 */

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { createModuleLogger } from '../middleware/logger.js';

const log = createModuleLogger('webhook-receipts');

export type WebhookReceiptStatus = 'processing' | 'processed' | 'failed';

export interface WebhookReceipt {
  provider: string;
  eventId: string;
  signatureHash: string | null;
  payloadHash: string;
  status: WebhookReceiptStatus;
  deliveryCount: number;
  responseStatus: number | null;
  sourceIp: string | null;
  eventTimestamp: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  claimedAt: Date;
  processedAt: Date | null;
  expiresAt: Date;
}

/** What the caller knows about an inbound, already signature-verified delivery. */
export interface WebhookDelivery {
  provider: string;
  eventId: string;
  /** Raw body exactly as received; hashed, never stored. */
  rawBody: string;
  /** Signature header value; hashed, never stored. */
  signature?: string;
  /** Time the provider says the event happened, if the signature covers it. */
  eventTimestamp?: Date;
  sourceIp?: string;
}

export type ClaimResult =
  /** First delivery (or a retry of a failed one): run the handler. */
  | { outcome: 'accepted'; receipt: WebhookReceipt; reclaimed: boolean }
  /** Already processed, or another instance is processing it right now. */
  | { outcome: 'duplicate'; receipt: WebhookReceipt }
  /** Same event ID, different body: tampering or a provider bug. */
  | { outcome: 'conflict'; receipt: WebhookReceipt }
  /** The signed event time is older than the replay window. */
  | { outcome: 'stale'; ageMs: number };

/**
 * Persistence for receipts. `insert` must be atomic across both unique keys:
 * it returns false (and writes nothing) if either key already exists.
 */
export interface WebhookReceiptStore {
  insert(receipt: WebhookReceipt): Promise<boolean>;
  findConflicting(provider: string, eventId: string, signatureHash: string | null): Promise<WebhookReceipt | undefined>;
  /**
   * Atomically move an existing receipt back to `processing` if it is
   * reclaimable: `failed`, expired, or `processing` with `claimedAt` before
   * `staleBefore`. Returns the updated receipt, or undefined if another
   * caller won the race or the receipt is not reclaimable.
   */
  reclaim(
    provider: string,
    eventId: string,
    now: Date,
    staleBefore: Date,
    patch: Pick<WebhookReceipt, 'payloadHash' | 'signatureHash' | 'expiresAt' | 'sourceIp'>,
  ): Promise<WebhookReceipt | undefined>;
  recordDuplicate(provider: string, eventId: string, now: Date): Promise<void>;
  finish(provider: string, eventId: string, status: 'processed' | 'failed', responseStatus: number | null, now: Date): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}

export interface WebhookReplayOptions {
  /** How long receipts are kept. Default 7 days (longer than Stripe's and PayPal's 3-day retry schedules). */
  retentionMs?: number;
  /** Deliveries whose signed event time is older than this are rejected. Default 6 days. */
  maxEventAgeMs?: number;
  /** A `processing` claim older than this is considered abandoned. Default 5 minutes. */
  processingLeaseMs?: number;
  /** Minimum time between opportunistic prunes of expired receipts. Default 1 hour. */
  pruneIntervalMs?: number;
  now?: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_WEBHOOK_REPLAY_OPTIONS: Required<Omit<WebhookReplayOptions, 'now'>> = {
  retentionMs: 7 * DAY_MS,
  maxEventAgeMs: 6 * DAY_MS,
  processingLeaseMs: 5 * 60 * 1000,
  pruneIntervalMs: 60 * 60 * 1000,
};

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// ── Stores ───────────────────────────────────────────────────────────────────

/** Process-local store. Correct for a single instance and for tests. */
export class InMemoryWebhookReceiptStore implements WebhookReceiptStore {
  private readonly byEvent = new Map<string, WebhookReceipt>();
  private readonly bySignature = new Map<string, string>();

  private static eventKey(provider: string, eventId: string): string {
    return `${provider}\u0000${eventId}`;
  }

  private static signatureKey(provider: string, signatureHash: string): string {
    return `${provider}\u0000${signatureHash}`;
  }

  async insert(receipt: WebhookReceipt): Promise<boolean> {
    const key = InMemoryWebhookReceiptStore.eventKey(receipt.provider, receipt.eventId);
    if (this.byEvent.has(key)) return false;
    if (receipt.signatureHash && this.bySignature.has(InMemoryWebhookReceiptStore.signatureKey(receipt.provider, receipt.signatureHash))) {
      return false;
    }
    this.byEvent.set(key, { ...receipt });
    if (receipt.signatureHash) {
      this.bySignature.set(InMemoryWebhookReceiptStore.signatureKey(receipt.provider, receipt.signatureHash), key);
    }
    return true;
  }

  async findConflicting(provider: string, eventId: string, signatureHash: string | null) {
    const byEvent = this.byEvent.get(InMemoryWebhookReceiptStore.eventKey(provider, eventId));
    if (byEvent) return { ...byEvent };
    if (!signatureHash) return undefined;
    const key = this.bySignature.get(InMemoryWebhookReceiptStore.signatureKey(provider, signatureHash));
    const bySig = key ? this.byEvent.get(key) : undefined;
    return bySig ? { ...bySig } : undefined;
  }

  async reclaim(
    provider: string,
    eventId: string,
    now: Date,
    staleBefore: Date,
    patch: Pick<WebhookReceipt, 'payloadHash' | 'signatureHash' | 'expiresAt' | 'sourceIp'>,
  ) {
    const key = InMemoryWebhookReceiptStore.eventKey(provider, eventId);
    const current = this.byEvent.get(key);
    if (!current || !isReclaimable(current, now, staleBefore)) return undefined;
    if (patch.signatureHash) {
      const owner = this.bySignature.get(InMemoryWebhookReceiptStore.signatureKey(provider, patch.signatureHash));
      if (owner && owner !== key) return undefined;
    }
    if (current.signatureHash) {
      this.bySignature.delete(InMemoryWebhookReceiptStore.signatureKey(provider, current.signatureHash));
    }
    const updated: WebhookReceipt = {
      ...current,
      ...patch,
      status: 'processing',
      deliveryCount: current.deliveryCount + 1,
      lastSeenAt: now,
      claimedAt: now,
      responseStatus: null,
      processedAt: null,
    };
    this.byEvent.set(key, updated);
    if (updated.signatureHash) {
      this.bySignature.set(InMemoryWebhookReceiptStore.signatureKey(provider, updated.signatureHash), key);
    }
    return { ...updated };
  }

  async recordDuplicate(provider: string, eventId: string, now: Date) {
    const current = this.byEvent.get(InMemoryWebhookReceiptStore.eventKey(provider, eventId));
    if (current) {
      current.deliveryCount += 1;
      current.lastSeenAt = now;
    }
  }

  async finish(provider: string, eventId: string, status: 'processed' | 'failed', responseStatus: number | null, now: Date) {
    const current = this.byEvent.get(InMemoryWebhookReceiptStore.eventKey(provider, eventId));
    if (!current) return;
    current.status = status;
    current.responseStatus = responseStatus;
    current.processedAt = status === 'processed' ? now : null;
  }

  async deleteExpired(now: Date) {
    let removed = 0;
    for (const [key, receipt] of this.byEvent) {
      if (receipt.expiresAt <= now) {
        this.byEvent.delete(key);
        if (receipt.signatureHash) {
          this.bySignature.delete(InMemoryWebhookReceiptStore.signatureKey(receipt.provider, receipt.signatureHash));
        }
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.byEvent.size;
  }
}

function isReclaimable(receipt: WebhookReceipt, now: Date, staleBefore: Date): boolean {
  return (
    receipt.status === 'failed' ||
    receipt.expiresAt <= now ||
    (receipt.status === 'processing' && receipt.claimedAt < staleBefore)
  );
}

type ReceiptRow = Prisma.WebhookReceiptGetPayload<Record<string, never>>;

function fromRow(row: ReceiptRow): WebhookReceipt {
  return {
    provider: row.provider,
    eventId: row.eventId,
    signatureHash: row.signatureHash,
    payloadHash: row.payloadHash,
    status: row.status,
    deliveryCount: row.deliveryCount,
    responseStatus: row.responseStatus,
    sourceIp: row.sourceIp,
    eventTimestamp: row.eventTimestamp,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    claimedAt: row.claimedAt,
    processedAt: row.processedAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * Postgres-backed store over the `webhook_receipts` table. Atomicity comes
 * from the two unique indexes (insert) and from conditional `updateMany`
 * (reclaim), so concurrent deliveries across instances are safe.
 */
export class PrismaWebhookReceiptStore implements WebhookReceiptStore {
  constructor(private readonly db: Pick<typeof prisma, 'webhookReceipt'> = prisma) {}

  async insert(receipt: WebhookReceipt): Promise<boolean> {
    try {
      await this.db.webhookReceipt.create({ data: receipt });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
  }

  async findConflicting(provider: string, eventId: string, signatureHash: string | null) {
    // An event-ID match wins over a signature match: it decides retry vs conflict.
    const byEvent = await this.db.webhookReceipt.findUnique({ where: { provider_eventId: { provider, eventId } } });
    if (byEvent) return fromRow(byEvent);
    if (!signatureHash) return undefined;
    const bySignature = await this.db.webhookReceipt.findUnique({
      where: { provider_signatureHash: { provider, signatureHash } },
    });
    return bySignature ? fromRow(bySignature) : undefined;
  }

  async reclaim(
    provider: string,
    eventId: string,
    now: Date,
    staleBefore: Date,
    patch: Pick<WebhookReceipt, 'payloadHash' | 'signatureHash' | 'expiresAt' | 'sourceIp'>,
  ) {
    try {
      const { count } = await this.db.webhookReceipt.updateMany({
        where: {
          provider,
          eventId,
          OR: [
            { status: 'failed' },
            { expiresAt: { lte: now } },
            { status: 'processing', claimedAt: { lt: staleBefore } },
          ],
        },
        data: {
          ...patch,
          status: 'processing',
          deliveryCount: { increment: 1 },
          lastSeenAt: now,
          claimedAt: now,
          responseStatus: null,
          processedAt: null,
        },
      });
      if (count === 0) return undefined;
    } catch (error) {
      // The new signature already belongs to a different receipt.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return undefined;
      throw error;
    }
    const row = await this.db.webhookReceipt.findUnique({ where: { provider_eventId: { provider, eventId } } });
    return row ? fromRow(row) : undefined;
  }

  async recordDuplicate(provider: string, eventId: string, now: Date) {
    await this.db.webhookReceipt.updateMany({
      where: { provider, eventId },
      data: { deliveryCount: { increment: 1 }, lastSeenAt: now },
    });
  }

  async finish(provider: string, eventId: string, status: 'processed' | 'failed', responseStatus: number | null, now: Date) {
    await this.db.webhookReceipt.updateMany({
      where: { provider, eventId, status: 'processing' },
      data: { status, responseStatus, processedAt: status === 'processed' ? now : null },
    });
  }

  async deleteExpired(now: Date) {
    const { count } = await this.db.webhookReceipt.deleteMany({ where: { expiresAt: { lte: now } } });
    return count;
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

export class WebhookReplayGuard {
  private readonly options: Required<Omit<WebhookReplayOptions, 'now'>>;
  private readonly now: () => Date;
  private lastPruneAt = 0;
  private readonly counters = new Map<string, number>();

  constructor(
    private readonly store: WebhookReceiptStore,
    options: WebhookReplayOptions = {},
  ) {
    this.options = { ...DEFAULT_WEBHOOK_REPLAY_OPTIONS, ...stripUndefined(options) };
    this.now = options.now ?? (() => new Date());
    if (this.options.maxEventAgeMs >= this.options.retentionMs) {
      throw new Error('webhook replay: maxEventAgeMs must be shorter than retentionMs');
    }
  }

  /**
   * Record a verified delivery and decide whether its handler may run. Only
   * call this after the signature has been verified; unsigned requests must
   * never create receipts.
   */
  async claim(delivery: WebhookDelivery): Promise<ClaimResult> {
    return this.claimOnce(delivery, 0);
  }

  private async claimOnce(delivery: WebhookDelivery, attempt: number): Promise<ClaimResult> {
    const now = this.now();
    this.maybePrune(now);

    if (delivery.eventTimestamp && !Number.isNaN(delivery.eventTimestamp.getTime())) {
      const ageMs = now.getTime() - delivery.eventTimestamp.getTime();
      if (ageMs > this.options.maxEventAgeMs) {
        this.observe(delivery.provider, 'stale');
        log.warn({ provider: delivery.provider, eventId: delivery.eventId, ageMs }, 'Stale webhook delivery rejected');
        return { outcome: 'stale', ageMs };
      }
    }

    const payloadHash = sha256Hex(delivery.rawBody);
    const signatureHash = delivery.signature ? sha256Hex(delivery.signature) : null;
    const expiresAt = new Date(now.getTime() + this.options.retentionMs);
    const receipt: WebhookReceipt = {
      provider: delivery.provider,
      eventId: delivery.eventId,
      signatureHash,
      payloadHash,
      status: 'processing',
      deliveryCount: 1,
      responseStatus: null,
      sourceIp: delivery.sourceIp ?? null,
      eventTimestamp: delivery.eventTimestamp ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
      claimedAt: now,
      processedAt: null,
      expiresAt,
    };

    if (await this.store.insert(receipt)) {
      this.observe(delivery.provider, 'accepted');
      return { outcome: 'accepted', receipt, reclaimed: false };
    }

    const existing = await this.store.findConflicting(delivery.provider, delivery.eventId, signatureHash);
    if (!existing) {
      // The row was pruned between insert and lookup: try once more.
      if (attempt === 0) return this.claimOnce(delivery, 1);
      throw new Error('webhook replay: receipt disappeared during claim');
    }

    if (existing.eventId === delivery.eventId && existing.payloadHash !== payloadHash) {
      this.observe(delivery.provider, 'conflict');
      log.error(
        { provider: delivery.provider, eventId: delivery.eventId, deliveries: existing.deliveryCount + 1 },
        'Webhook event ID reused with a different payload',
      );
      await this.store.recordDuplicate(existing.provider, existing.eventId, now);
      return { outcome: 'conflict', receipt: existing };
    }

    if (existing.eventId === delivery.eventId) {
      const staleBefore = new Date(now.getTime() - this.options.processingLeaseMs);
      const reclaimed = await this.store.reclaim(delivery.provider, delivery.eventId, now, staleBefore, {
        payloadHash,
        signatureHash,
        expiresAt,
        sourceIp: delivery.sourceIp ?? null,
      });
      if (reclaimed) {
        this.observe(delivery.provider, 'reclaimed');
        log.info(
          { provider: delivery.provider, eventId: delivery.eventId, attempt: reclaimed.deliveryCount, previous: existing.status },
          'Webhook retry reclaimed receipt',
        );
        return { outcome: 'accepted', receipt: reclaimed, reclaimed: true };
      }
    }

    await this.store.recordDuplicate(existing.provider, existing.eventId, now);
    this.observe(delivery.provider, 'duplicate');
    log.warn(
      {
        provider: delivery.provider,
        eventId: delivery.eventId,
        matchedEventId: existing.eventId,
        matchedOn: existing.eventId === delivery.eventId ? 'event_id' : 'signature',
        status: existing.status,
      },
      'Webhook replay detected',
    );
    return { outcome: 'duplicate', receipt: existing };
  }

  /** Mark a claimed delivery as handled (2xx) or failed (anything else). */
  async finish(provider: string, eventId: string, responseStatus: number | null): Promise<void> {
    const ok = responseStatus !== null && responseStatus >= 200 && responseStatus < 300;
    await this.store.finish(provider, eventId, ok ? 'processed' : 'failed', responseStatus, this.now());
    this.observe(provider, ok ? 'processed' : 'failed');
  }

  async prune(): Promise<number> {
    const removed = await this.store.deleteExpired(this.now());
    if (removed > 0) log.info({ removed }, 'Pruned expired webhook receipts');
    return removed;
  }

  private maybePrune(now: Date): void {
    if (now.getTime() - this.lastPruneAt < this.options.pruneIntervalMs) return;
    this.lastPruneAt = now.getTime();
    this.prune().catch((error) => log.error({ err: error }, 'Failed to prune webhook receipts'));
  }

  /** Per-provider outcome counters since start-up, for dashboards and alerts. */
  stats(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const [key, count] of this.counters) {
      const [provider, outcome] = key.split('\u0000');
      (out[provider] ??= {})[outcome] = count;
    }
    return out;
  }

  private observe(provider: string, outcome: string): void {
    const key = `${provider}\u0000${outcome}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ── Default instance ─────────────────────────────────────────────────────────

/**
 * `WEBHOOK_RECEIPT_STORE=database|memory`. Production defaults to the
 * database so every instance shares one receipt table; elsewhere the
 * in-memory store keeps tests and local runs independent of Postgres.
 */
function createDefaultStore(): WebhookReceiptStore {
  const configured = process.env.WEBHOOK_RECEIPT_STORE?.toLowerCase();
  const useDatabase = configured ? configured === 'database' : process.env.NODE_ENV === 'production';
  return useDatabase ? new PrismaWebhookReceiptStore() : new InMemoryWebhookReceiptStore();
}

let defaultGuard: WebhookReplayGuard | undefined;

export function getWebhookReplayGuard(): WebhookReplayGuard {
  defaultGuard ??= new WebhookReplayGuard(createDefaultStore());
  return defaultGuard;
}

/** Replace the shared guard (tests, or a custom store). Pass nothing to reset. */
export function setWebhookReplayGuard(guard?: WebhookReplayGuard): void {
  defaultGuard = guard;
}
