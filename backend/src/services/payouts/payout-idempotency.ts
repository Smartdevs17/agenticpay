/**
 * payout-idempotency.ts — Issue #1005
 *
 * A TTL-bounded idempotency store for payout creation. HTTP callers may retry a
 * `POST /api/v1/payouts/scheduled`, and a retry that arrives after the middleware
 * cache has been evicted must not create a second payout.
 *
 * Semantics:
 * - The first request for a key records a fingerprint of the request body and the
 *   result it produced.
 * - A later request with the same key and the same fingerprint gets the original
 *   result back verbatim.
 * - A later request with the same key but a *different* body is rejected rather
 *   than silently replaying the earlier payout.
 * - Entries expire after `ttlMs` (default 24h) and the store is capped so a flood
 *   of unique keys cannot exhaust memory.
 */

import { createHash } from 'node:crypto';

/** How long an idempotency key is remembered. */
export const DEFAULT_PAYOUT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Hard cap on remembered keys. */
export const DEFAULT_PAYOUT_IDEMPOTENCY_MAX_ENTRIES = 10_000;

export type PayoutIdempotencyLookup<T> =
  | { status: 'miss' }
  | { status: 'replay'; value: T }
  | { status: 'mismatch' };

interface Entry<T> {
  fingerprint: string;
  value: T;
  expiresAt: number;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}

/** SHA-256 fingerprint of the parts of a request that must not change on replay. */
export function fingerprintPayoutRequest(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

export class PayoutIdempotencyStore<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly now: () => number;

  constructor(
    private readonly ttlMs: number = DEFAULT_PAYOUT_IDEMPOTENCY_TTL_MS,
    private readonly maxEntries: number = DEFAULT_PAYOUT_IDEMPOTENCY_MAX_ENTRIES,
    now: () => number = Date.now,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('INVALID_PAYOUT_IDEMPOTENCY_TTL');
    if (!Number.isFinite(maxEntries) || maxEntries < 1) throw new Error('INVALID_PAYOUT_IDEMPOTENCY_MAX_ENTRIES');
    this.now = now;
  }

  /** Returns the stored result for a key, or signals a miss / payload mismatch. */
  lookup(key: string, fingerprint: string): PayoutIdempotencyLookup<T> {
    const entry = this.entries.get(key);
    if (!entry) return { status: 'miss' };
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return { status: 'miss' };
    }
    if (entry.fingerprint !== fingerprint) return { status: 'mismatch' };
    return { status: 'replay', value: entry.value };
  }

  /** Records the result a key produced so a replay returns it unchanged. */
  save(key: string, fingerprint: string, value: T): void {
    this.entries.set(key, { fingerprint, value, expiresAt: this.now() + this.ttlMs });
    this.enforceLimit();
  }

  /** Drops expired keys; returns how many were removed. */
  purgeExpired(): number {
    const now = this.now();
    let purged = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        purged += 1;
      }
    }
    return purged;
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private enforceLimit(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }
}
