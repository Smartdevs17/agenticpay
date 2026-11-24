/**
 * Consumption-based API quota ledger with weekly caps.
 *
 * Each key is charged in units (for example one unit per API call, or per token). A key may
 * use up to `weeklyCap` units in a calendar week. Weeks run Monday 00:00 UTC to the next
 * Monday 00:00 UTC.
 *
 * Rules:
 *  - A consumption that would exceed the cap is rejected and charges nothing. There is no
 *    partial charge.
 *  - Each consumption carries an idempotency key. Replaying the same key returns the original
 *    result and does not charge again, so a retried request cannot double-count.
 *  - The check and the write are one atomic store operation (`commit`). A store backed by a
 *    database must implement it as a conditional insert, not as a read followed by a write.
 */

export const QUOTA_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export class QuotaError extends Error {
  constructor(
    readonly code: 'invalid_units' | 'invalid_idempotency_key' | 'invalid_cap',
    message: string,
  ) {
    super(message);
    this.name = 'QuotaError';
  }
}

export interface LedgerEntry {
  idempotencyKey: string;
  keyId: string;
  units: number;
  /** Start of the week the entry is charged to, as an ISO timestamp. */
  weekStart: string;
  at: string;
}

export type CommitOutcome =
  | { status: 'applied'; usedAfter: number }
  | { status: 'duplicate'; entry: LedgerEntry; usedAfter: number }
  | { status: 'exceeded'; usedBefore: number };

export interface QuotaStore {
  /**
   * Atomically: return the existing entry for `entry.idempotencyKey` if there is one; otherwise
   * append `entry` only when `usedThisWeek + entry.units <= cap`, and report the result.
   */
  commit(entry: LedgerEntry, cap: number): Promise<CommitOutcome>;
  usedThisWeek(keyId: string, weekStart: string): Promise<number>;
}

/** Process-local store. Correct for one process only, which is how tests and dev use it. */
export class InMemoryQuotaStore implements QuotaStore {
  private readonly entries = new Map<string, LedgerEntry>();
  private readonly usage = new Map<string, number>();

  async commit(entry: LedgerEntry, cap: number): Promise<CommitOutcome> {
    // No await between the read and the write, so this is atomic within one process.
    const existing = this.entries.get(entry.idempotencyKey);
    if (existing) {
      return { status: 'duplicate', entry: existing, usedAfter: this.usedSync(existing.keyId, existing.weekStart) };
    }
    const usedBefore = this.usedSync(entry.keyId, entry.weekStart);
    if (usedBefore + entry.units > cap) {
      return { status: 'exceeded', usedBefore };
    }
    this.entries.set(entry.idempotencyKey, entry);
    const usedAfter = usedBefore + entry.units;
    this.usage.set(this.usageKey(entry.keyId, entry.weekStart), usedAfter);
    return { status: 'applied', usedAfter };
  }

  async usedThisWeek(keyId: string, weekStart: string): Promise<number> {
    return this.usedSync(keyId, weekStart);
  }

  private usedSync(keyId: string, weekStart: string): number {
    return this.usage.get(this.usageKey(keyId, weekStart)) ?? 0;
  }

  private usageKey(keyId: string, weekStart: string): string {
    return `${keyId}\u0000${weekStart}`;
  }
}

export interface QuotaUsage {
  keyId: string;
  weekStart: string;
  resetsAt: string;
  cap: number;
  used: number;
  remaining: number;
}

export type ConsumeResult =
  | { status: 'applied'; usage: QuotaUsage; idempotencyKey: string }
  | { status: 'duplicate'; usage: QuotaUsage; idempotencyKey: string; originalAt: string }
  | { status: 'exceeded'; usage: QuotaUsage; requestedUnits: number };

export interface QuotaLedgerOptions {
  store: QuotaStore;
  /** Weekly cap in units for a key. Resolved on each call so plan changes apply at once. */
  weeklyCap: (keyId: string) => number | Promise<number>;
  now?: () => Date;
  /** Metrics and log hook. Receives no identifiers beyond the key id. */
  observe?: (event: { type: 'consumed' | 'exceeded' | 'duplicate'; keyId: string; units: number }) => void;
}

/** Start (Monday 00:00 UTC) of the ISO week containing `at`. */
export function weekStartUtc(at: Date): Date {
  const day = at.getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (day + 6) % 7;
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - daysSinceMonday));
}

function assertPositiveInteger(value: number, code: QuotaError['code'], label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new QuotaError(code, `${label} must be a positive integer`);
  }
}

export class QuotaLedger {
  private readonly store: QuotaStore;
  private readonly weeklyCap: (keyId: string) => number | Promise<number>;
  private readonly now: () => Date;
  private readonly observe: NonNullable<QuotaLedgerOptions['observe']>;

  constructor(options: QuotaLedgerOptions) {
    this.store = options.store;
    this.weeklyCap = options.weeklyCap;
    this.now = options.now ?? (() => new Date());
    this.observe = options.observe ?? (() => undefined);
  }

  /** Charges `units` to `keyId` for this week unless that would exceed the cap. */
  async consume(keyId: string, units: number, idempotencyKey: string): Promise<ConsumeResult> {
    assertPositiveInteger(units, 'invalid_units', 'units');
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
      throw new QuotaError('invalid_idempotency_key', 'idempotencyKey is required');
    }
    const cap = await this.resolveCap(keyId);
    const at = this.now();
    const weekStart = weekStartUtc(at).toISOString();
    const outcome = await this.store.commit(
      { idempotencyKey, keyId, units, weekStart, at: at.toISOString() },
      cap,
    );

    if (outcome.status === 'applied') {
      this.observe({ type: 'consumed', keyId, units });
      return {
        status: 'applied',
        idempotencyKey,
        usage: this.usageFrom(keyId, weekStart, cap, outcome.usedAfter),
      };
    }
    if (outcome.status === 'duplicate') {
      this.observe({ type: 'duplicate', keyId, units });
      // Usage is reported for the current week, not the week of the original entry.
      const used = await this.store.usedThisWeek(keyId, weekStart);
      return {
        status: 'duplicate',
        idempotencyKey,
        originalAt: outcome.entry.at,
        usage: this.usageFrom(keyId, weekStart, cap, used),
      };
    }
    this.observe({ type: 'exceeded', keyId, units });
    return {
      status: 'exceeded',
      requestedUnits: units,
      usage: this.usageFrom(keyId, weekStart, cap, outcome.usedBefore),
    };
  }

  /** Current week's usage for a key, without charging anything. */
  async usage(keyId: string): Promise<QuotaUsage> {
    const at = this.now();
    const weekStart = weekStartUtc(at).toISOString();
    const cap = await this.resolveCap(keyId);
    const used = await this.store.usedThisWeek(keyId, weekStart);
    return this.usageFrom(keyId, weekStart, cap, used);
  }

  private async resolveCap(keyId: string): Promise<number> {
    const cap = await this.weeklyCap(keyId);
    assertPositiveInteger(cap, 'invalid_cap', 'weekly cap');
    return cap;
  }

  private usageFrom(keyId: string, weekStart: string, cap: number, used: number): QuotaUsage {
    const resetsAt = new Date(new Date(weekStart).getTime() + QUOTA_WEEK_MS).toISOString();
    return { keyId, weekStart, resetsAt, cap, used, remaining: Math.max(0, cap - used) };
  }
}
