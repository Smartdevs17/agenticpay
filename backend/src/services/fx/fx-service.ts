/**
 * fx-service.ts — Issue #626
 *
 * Multi-currency FX conversion for invoices: a rate cache with TTL backed by
 * the `FxRate` table (each fetch inserts a new row, so the cache doubles as
 * a history/audit trail), pluggable rate sourcing, and threshold-based rate
 * alerts (`FxRateAlert`).
 *
 * Follows the BaseService + usePrisma() convention used by
 * `services/archival/archival-service.ts`: every method is fully usable
 * without a live Postgres connection (falls back to in-memory arrays), so
 * this service — and anything built on top of it — is unit-testable without
 * DATABASE_URL set.
 */

import { randomUUID } from 'node:crypto';
import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { prisma } from '../../lib/prisma.js';

export type FxAlertDirection = 'up' | 'down' | 'both';

export interface FxRateRecord {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  source: string;
  fetchedAt: Date;
  expiresAt: Date;
  createdAt: Date;
}

export interface FxRateAlertRecord {
  id: string;
  tenantId: string;
  baseCurrency: string;
  quoteCurrency: string;
  thresholdPct: number;
  direction: FxAlertDirection;
  active: boolean;
  lastTriggeredAt: Date | null;
  lastTriggeredRate: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FxConversion {
  amount: number;
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  convertedAmount: number;
  source: string;
  fetchedAt: Date;
  expiresAt: Date;
}

export type RateFetcher = (base: string, quote: string) => Promise<number>;

export interface FxServiceOptions {
  /** Cache TTL for fetched rates, in ms. Defaults to 5 minutes. */
  ttlMs?: number;
  /** Injectable rate source — defaults to `defaultFetchRate` (a mock table). */
  fetchRate?: RateFetcher;
  /** Label stored on `FxRate.source` for rates fetched via this instance. */
  sourceLabel?: string;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_SOURCE_LABEL = 'mock-static-table';

/**
 * PLACEHOLDER rate source — a small deterministic static table for common
 * pairs (USD/EUR/GBP/XLM), used because this repo has no live market-data
 * provider configured. Swap this for a real forex API (e.g. exchangerate.host,
 * Open Exchange Rates, currencylayer, or Stellar's on-chain path-payment
 * quote) by passing a `fetchRate` implementation to `new FxService({ fetchRate })`
 * or by editing `fxService`'s construction in `fx/index.ts`. See
 * `backend/docs/FX_CONVERSION.md` for the full swap-in guide.
 */
const STATIC_RATE_TABLE: Record<string, number> = {
  'USD:EUR': 0.92,
  'USD:GBP': 0.79,
  'USD:XLM': 8.5,
  'EUR:GBP': 0.8587,
  'EUR:XLM': 9.2391,
  'GBP:XLM': 10.7595,
};

function invertPair(key: string): string | null {
  const [base, quote] = key.split(':');
  if (!base || !quote) return null;
  return `${quote}:${base}`;
}

/** Deterministic fallback for pairs missing from the static table, so
 * repeated calls for the same unknown pair return a stable rate instead of
 * a random one. Purely a placeholder — never use in production. */
function deterministicFallbackRate(base: string, quote: string): number {
  const seed = `${base}:${quote}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  // Map into a plausible FX-ish range [0.5, 2.5)
  return 0.5 + (hash % 2000) / 1000;
}

export async function defaultFetchRate(base: string, quote: string): Promise<number> {
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  if (b === q) return 1;

  const key = `${b}:${q}`;
  if (STATIC_RATE_TABLE[key] !== undefined) return STATIC_RATE_TABLE[key];

  const inverseKey = invertPair(key);
  if (inverseKey && STATIC_RATE_TABLE[inverseKey] !== undefined) {
    return 1 / STATIC_RATE_TABLE[inverseKey];
  }

  return deterministicFallbackRate(b, q);
}

interface AlertFilters {
  tenantId?: string;
  baseCurrency?: string;
  quoteCurrency?: string;
  activeOnly?: boolean;
}

export class FxService extends BaseService {
  private ttlMs: number;
  private fetchRateFn: RateFetcher;
  private sourceLabel: string;

  // In-memory fallback store, used whenever DATABASE_URL is not set so the
  // service (and anything built on it) is testable without Postgres.
  private memRates: FxRateRecord[] = [];
  private memAlerts: FxRateAlertRecord[] = [];

  constructor(options: FxServiceOptions = {}) {
    super();
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.fetchRateFn = options.fetchRate ?? defaultFetchRate;
    this.sourceLabel = options.sourceLabel ?? DEFAULT_SOURCE_LABEL;
  }

  private usePrisma(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  /** Clears in-memory state. No-op against Postgres — intended for unit tests. */
  resetForTests(): void {
    this.memRates = [];
    this.memAlerts = [];
  }

  // ---------------------------------------------------------------------
  // Rate cache
  // ---------------------------------------------------------------------

  /**
   * Returns a cached, non-expired rate for base->quote if one exists;
   * otherwise fetches a fresh rate via the injected `fetchRate` source,
   * caches it (new `FxRate` row, giving history for free), evaluates any
   * active alerts for the pair against the movement, and returns it.
   */
  async getRate(base: string, quote: string): Promise<Result<FxRateRecord>> {
    const b = base.trim().toUpperCase();
    const q = quote.trim().toUpperCase();

    if (!b || !q) {
      return this.validationFailure('base and quote currencies are required');
    }

    const now = new Date();

    if (b === q) {
      return this.ok({
        id: 'identity',
        baseCurrency: b,
        quoteCurrency: q,
        rate: 1,
        source: 'identity',
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + this.ttlMs),
        createdAt: now,
      });
    }

    const cached = await this.findFreshCached(b, q, now);
    if (cached) {
      return this.ok(cached);
    }

    let rateValue: number;
    try {
      rateValue = await this.fetchRateFn(b, q);
    } catch (err) {
      return this.unexpectedFailure(err);
    }

    if (!Number.isFinite(rateValue) || rateValue <= 0) {
      return this.validationFailure(`Fetched FX rate for ${b}/${q} is invalid: ${rateValue}`);
    }

    // Compare against the rate currently in the cache (before we overwrite
    // it) so alert thresholds measure the actual movement.
    const alertResult = await this.checkAlerts(b, q, rateValue);
    if (!alertResult.ok) {
      // Alert evaluation failures shouldn't block rate fetching/caching.
      console.error('[fx] alert check failed:', alertResult.error.message);
    }

    const record = await this.storeRate(b, q, rateValue, now);
    return this.ok(record);
  }

  private async findFreshCached(base: string, quote: string, now: Date): Promise<FxRateRecord | null> {
    if (this.usePrisma()) {
      const row = await prisma.fxRate.findFirst({
        where: { baseCurrency: base, quoteCurrency: quote, expiresAt: { gt: now } },
        orderBy: { fetchedAt: 'desc' },
      });
      return row ? this.mapRow(row) : null;
    }

    const candidates = this.memRates
      .filter((r) => r.baseCurrency === base && r.quoteCurrency === quote && r.expiresAt.getTime() > now.getTime())
      .sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());
    return candidates[0] ?? null;
  }

  private async getLatestCachedRate(base: string, quote: string): Promise<number | undefined> {
    if (this.usePrisma()) {
      const row = await prisma.fxRate.findFirst({
        where: { baseCurrency: base, quoteCurrency: quote },
        orderBy: { fetchedAt: 'desc' },
      });
      return row ? Number(row.rate) : undefined;
    }

    const candidates = this.memRates
      .filter((r) => r.baseCurrency === base && r.quoteCurrency === quote)
      .sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());
    return candidates[0]?.rate;
  }

  private async storeRate(base: string, quote: string, rate: number, fetchedAt: Date): Promise<FxRateRecord> {
    const expiresAt = new Date(fetchedAt.getTime() + this.ttlMs);

    if (this.usePrisma()) {
      const row = await prisma.fxRate.create({
        data: {
          baseCurrency: base,
          quoteCurrency: quote,
          rate,
          source: this.sourceLabel,
          fetchedAt,
          expiresAt,
        },
      });
      return this.mapRow(row);
    }

    const record: FxRateRecord = {
      id: randomUUID(),
      baseCurrency: base,
      quoteCurrency: quote,
      rate,
      source: this.sourceLabel,
      fetchedAt,
      expiresAt,
      createdAt: fetchedAt,
    };
    this.memRates.push(record);
    return record;
  }

  private mapRow(row: {
    id: string;
    baseCurrency: string;
    quoteCurrency: string;
    rate: unknown;
    source: string;
    fetchedAt: Date;
    expiresAt: Date;
    createdAt: Date;
  }): FxRateRecord {
    return {
      id: row.id,
      baseCurrency: row.baseCurrency,
      quoteCurrency: row.quoteCurrency,
      rate: Number(row.rate),
      source: row.source,
      fetchedAt: row.fetchedAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }

  // ---------------------------------------------------------------------
  // Conversion
  // ---------------------------------------------------------------------

  /** Converts `amount` from `base` to `quote`, using (and caching) the current rate. */
  async convert(amount: number, base: string, quote: string): Promise<Result<FxConversion>> {
    if (!Number.isFinite(amount) || amount < 0) {
      return this.validationFailure('amount must be a non-negative finite number');
    }

    const rateResult = await this.getRate(base, quote);
    if (!rateResult.ok) return rateResult;

    const rate = rateResult.value;
    const convertedAmount = Number((amount * rate.rate).toFixed(8));

    return this.ok({
      amount,
      baseCurrency: rate.baseCurrency,
      quoteCurrency: rate.quoteCurrency,
      rate: rate.rate,
      convertedAmount,
      source: rate.source,
      fetchedAt: rate.fetchedAt,
      expiresAt: rate.expiresAt,
    });
  }

  // ---------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------

  /** Historical rate rows for a pair, oldest first. */
  async getHistory(
    base: string,
    quote: string,
    range: { since?: Date; until?: Date } = {},
  ): Promise<Result<FxRateRecord[]>> {
    const b = base.trim().toUpperCase();
    const q = quote.trim().toUpperCase();

    if (this.usePrisma()) {
      const rows = await prisma.fxRate.findMany({
        where: {
          baseCurrency: b,
          quoteCurrency: q,
          ...(range.since || range.until
            ? {
                fetchedAt: {
                  ...(range.since ? { gte: range.since } : {}),
                  ...(range.until ? { lte: range.until } : {}),
                },
              }
            : {}),
        },
        orderBy: { fetchedAt: 'asc' },
      });
      return this.ok(rows.map((row) => this.mapRow(row)));
    }

    const rows = this.memRates
      .filter(
        (r) =>
          r.baseCurrency === b &&
          r.quoteCurrency === q &&
          (!range.since || r.fetchedAt.getTime() >= range.since.getTime()) &&
          (!range.until || r.fetchedAt.getTime() <= range.until.getTime()),
      )
      .sort((a, b2) => a.fetchedAt.getTime() - b2.fetchedAt.getTime());
    return this.ok(rows);
  }

  // ---------------------------------------------------------------------
  // Alerts
  // ---------------------------------------------------------------------

  async createAlert(input: {
    tenantId: string;
    baseCurrency: string;
    quoteCurrency: string;
    thresholdPct: number;
    direction?: FxAlertDirection;
  }): Promise<Result<FxRateAlertRecord>> {
    const { tenantId, thresholdPct } = input;
    const baseCurrency = input.baseCurrency.trim().toUpperCase();
    const quoteCurrency = input.quoteCurrency.trim().toUpperCase();
    const direction: FxAlertDirection = input.direction ?? 'both';

    if (!tenantId) return this.validationFailure('tenantId is required');
    if (!baseCurrency || !quoteCurrency) return this.validationFailure('baseCurrency and quoteCurrency are required');
    if (!Number.isFinite(thresholdPct) || thresholdPct <= 0) {
      return this.validationFailure('thresholdPct must be a positive number');
    }
    if (!['up', 'down', 'both'].includes(direction)) {
      return this.validationFailure("direction must be one of 'up' | 'down' | 'both'");
    }

    const now = new Date();

    if (this.usePrisma()) {
      const row = await prisma.fxRateAlert.create({
        data: { tenantId, baseCurrency, quoteCurrency, thresholdPct, direction, active: true },
      });
      return this.ok(this.mapAlertRow(row));
    }

    const record: FxRateAlertRecord = {
      id: randomUUID(),
      tenantId,
      baseCurrency,
      quoteCurrency,
      thresholdPct,
      direction,
      active: true,
      lastTriggeredAt: null,
      lastTriggeredRate: null,
      createdAt: now,
      updatedAt: now,
    };
    this.memAlerts.push(record);
    return this.ok(record);
  }

  async listAlerts(filters: AlertFilters = {}): Promise<Result<FxRateAlertRecord[]>> {
    const baseCurrency = filters.baseCurrency?.trim().toUpperCase();
    const quoteCurrency = filters.quoteCurrency?.trim().toUpperCase();

    if (this.usePrisma()) {
      const rows = await prisma.fxRateAlert.findMany({
        where: {
          ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
          ...(baseCurrency ? { baseCurrency } : {}),
          ...(quoteCurrency ? { quoteCurrency } : {}),
          ...(filters.activeOnly ? { active: true } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
      return this.ok(rows.map((row) => this.mapAlertRow(row)));
    }

    const rows = this.memAlerts.filter(
      (a) =>
        (!filters.tenantId || a.tenantId === filters.tenantId) &&
        (!baseCurrency || a.baseCurrency === baseCurrency) &&
        (!quoteCurrency || a.quoteCurrency === quoteCurrency) &&
        (!filters.activeOnly || a.active),
    );
    return this.ok([...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
  }

  async deactivateAlert(id: string): Promise<Result<FxRateAlertRecord>> {
    if (this.usePrisma()) {
      const existing = await prisma.fxRateAlert.findUnique({ where: { id } });
      if (!existing) return this.notFoundFailure('FxRateAlert', id);
      const row = await prisma.fxRateAlert.update({ where: { id }, data: { active: false } });
      return this.ok(this.mapAlertRow(row));
    }

    const record = this.memAlerts.find((a) => a.id === id);
    if (!record) return this.notFoundFailure('FxRateAlert', id);
    record.active = false;
    record.updatedAt = new Date();
    return this.ok(record);
  }

  /**
   * Compares `newRate` against the rate currently cached for the pair (i.e.
   * the rate as of the call, before any newer fetch is stored), computes the
   * % movement, and triggers (marks `lastTriggeredAt`/`lastTriggeredRate` on)
   * any active alert for that pair whose threshold was crossed in the
   * direction it cares about. Returns the list of alerts that triggered.
   */
  async checkAlerts(base: string, quote: string, newRate: number): Promise<Result<FxRateAlertRecord[]>> {
    const b = base.trim().toUpperCase();
    const q = quote.trim().toUpperCase();

    if (!Number.isFinite(newRate) || newRate <= 0) {
      return this.validationFailure(`newRate must be a positive finite number, got ${newRate}`);
    }

    const baseline = await this.getLatestCachedRate(b, q);
    if (baseline === undefined || baseline === 0) {
      // Nothing to compare against yet — no movement to alert on.
      return this.ok([]);
    }

    const pctChange = ((newRate - baseline) / baseline) * 100;
    const movedUpPast = (thresholdPct: number) => pctChange >= thresholdPct;
    const movedDownPast = (thresholdPct: number) => pctChange <= -thresholdPct;

    const alertsResult = await this.listAlerts({ baseCurrency: b, quoteCurrency: q, activeOnly: true });
    if (!alertsResult.ok) return alertsResult;

    const now = new Date();
    const triggered: FxRateAlertRecord[] = [];

    for (const alert of alertsResult.value) {
      const thresholdPct = alert.thresholdPct;
      const crosses =
        (alert.direction === 'up' && movedUpPast(thresholdPct)) ||
        (alert.direction === 'down' && movedDownPast(thresholdPct)) ||
        (alert.direction === 'both' && (movedUpPast(thresholdPct) || movedDownPast(thresholdPct)));

      if (!crosses) continue;

      const updated = await this.markTriggered(alert.id, newRate, now);
      if (updated) triggered.push(updated);
    }

    return this.ok(triggered);
  }

  private async markTriggered(alertId: string, rate: number, at: Date): Promise<FxRateAlertRecord | null> {
    if (this.usePrisma()) {
      const row = await prisma.fxRateAlert.update({
        where: { id: alertId },
        data: { lastTriggeredAt: at, lastTriggeredRate: rate },
      });
      return this.mapAlertRow(row);
    }

    const record = this.memAlerts.find((a) => a.id === alertId);
    if (!record) return null;
    record.lastTriggeredAt = at;
    record.lastTriggeredRate = rate;
    record.updatedAt = at;
    return record;
  }

  private mapAlertRow(row: {
    id: string;
    tenantId: string;
    baseCurrency: string;
    quoteCurrency: string;
    thresholdPct: unknown;
    direction: string;
    active: boolean;
    lastTriggeredAt: Date | null;
    lastTriggeredRate: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): FxRateAlertRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      baseCurrency: row.baseCurrency,
      quoteCurrency: row.quoteCurrency,
      thresholdPct: Number(row.thresholdPct),
      direction: row.direction as FxAlertDirection,
      active: row.active,
      lastTriggeredAt: row.lastTriggeredAt,
      lastTriggeredRate: row.lastTriggeredRate === null ? null : Number(row.lastTriggeredRate),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
