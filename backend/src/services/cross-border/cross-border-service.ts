/**
 * cross-border-service.ts — Issue #920
 *
 * Cross-border payments with FX conversion. Built on top of the FX service
 * (issue #626) so rates come from the same cached, auditable source.
 *
 * A payment is a two-step flow:
 *   1. `createQuote`   — price a corridor: FX rate, fees, recipient amount,
 *                        settlement estimate, and a rate-hold expiry.
 *   2. `initiatePayment` — consume a quote and create a payment record that
 *                        can then be `completePayment`/`failPayment`-ed by the
 *                        settlement rail.
 *
 * Mirrors the conventions of `services/fx/fx-service.ts`: extends BaseService,
 * returns `Result<T>`, and is fully usable without a live Postgres connection
 * (in-memory fallback store) so it is unit-testable in isolation.
 */

import { randomUUID } from 'node:crypto';
import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { fxService, type FxRateRecord } from '../fx/index.js';

export type SettlementRail = 'stellar' | 'sepa' | 'ach' | 'faster_payments' | 'swift';

export type QuoteAmountMode = 'source' | 'target';

export type CrossBorderPaymentStatus = 'processing' | 'completed' | 'failed' | 'cancelled';

export interface Corridor {
  /** Stable id, e.g. `USD:EUR`. */
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  rail: SettlementRail;
  /** Minimum source amount accepted by the corridor. */
  minAmount: number;
  /** Maximum source amount accepted by the corridor. */
  maxAmount: number;
  /** Proportional fee applied to the source amount (0.005 = 0.5%). */
  fxFeePct: number;
  /** Flat fee in the source currency. */
  fixedFee: number;
  /** Typical time to settle, in minutes — drives `estimatedArrival`. */
  settlementMinutes: number;
}

export interface CrossBorderFees {
  fxFee: number;
  fixedFee: number;
  total: number;
}

export interface CrossBorderQuote {
  id: string;
  corridorId: string;
  rail: SettlementRail;
  sourceCurrency: string;
  targetCurrency: string;
  mode: QuoteAmountMode;
  /** Amount debited from the sender, in the source currency. */
  sourceAmount: number;
  /** Mid-market rate used for the conversion. */
  rate: number;
  /** Amount left to convert after fees, in the source currency. */
  convertibleAmount: number;
  fees: CrossBorderFees;
  /** Amount the recipient receives, in the target currency. */
  targetAmount: number;
  estimatedArrival: Date;
  expiresAt: Date;
  createdAt: Date;
}

export interface CrossBorderPayment {
  id: string;
  quoteId: string;
  status: CrossBorderPaymentStatus;
  senderId: string;
  recipientId: string;
  reference?: string;
  idempotencyKey?: string;
  corridorId: string;
  rail: SettlementRail;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: number;
  targetAmount: number;
  rate: number;
  fees: CrossBorderFees;
  txHash?: string;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

/** Minimal rate-fetching surface, satisfied by the shared FxService. */
export interface RateProvider {
  getRate(base: string, quote: string): Promise<Result<Pick<FxRateRecord, 'rate' | 'baseCurrency' | 'quoteCurrency' | 'fetchedAt' | 'expiresAt'>>>;
}

export interface CrossBorderServiceOptions {
  fx?: RateProvider;
  /** How long a quote holds its rate. Defaults to 2 minutes. */
  quoteTtlMs?: number;
  /** Injectable clock, for deterministic tests. */
  now?: () => Date;
}

const DEFAULT_QUOTE_TTL_MS = 2 * 60 * 1000;
const CRYPTO_CURRENCIES = new Set(['XLM', 'BTC', 'ETH', 'USDC', 'USDT']);
const CURRENCY_PATTERN = /^[A-Z0-9]{3,5}$/;

// Canonical corridor table. Each entry is expanded into both directions below.
interface CorridorSeed {
  source: string;
  target: string;
  rail: SettlementRail;
  minAmount: number;
  maxAmount: number;
  fxFeePct: number;
  fixedFee: number;
  settlementMinutes: number;
  /** Fees/limits for the reverse direction (target -> source). */
  reverse?: Partial<Pick<CorridorSeed, 'rail' | 'minAmount' | 'maxAmount' | 'fxFeePct' | 'fixedFee' | 'settlementMinutes'>>;
}

const CORRIDOR_SEEDS: CorridorSeed[] = [
  {
    source: 'USD',
    target: 'EUR',
    rail: 'sepa',
    minAmount: 10,
    maxAmount: 1_000_000,
    fxFeePct: 0.005,
    fixedFee: 1.5,
    settlementMinutes: 60,
    reverse: { rail: 'ach', fixedFee: 2, settlementMinutes: 240 },
  },
  {
    source: 'USD',
    target: 'GBP',
    rail: 'faster_payments',
    minAmount: 10,
    maxAmount: 1_000_000,
    fxFeePct: 0.005,
    fixedFee: 1.5,
    settlementMinutes: 30,
    reverse: { rail: 'ach', fixedFee: 2, settlementMinutes: 240 },
  },
  {
    source: 'USD',
    target: 'XLM',
    rail: 'stellar',
    minAmount: 5,
    maxAmount: 1_000_000,
    fxFeePct: 0.003,
    fixedFee: 0.5,
    settlementMinutes: 5,
    reverse: { fixedFee: 0.5, settlementMinutes: 5 },
  },
  {
    source: 'EUR',
    target: 'GBP',
    rail: 'faster_payments',
    minAmount: 10,
    maxAmount: 1_000_000,
    fxFeePct: 0.005,
    fixedFee: 1.5,
    settlementMinutes: 30,
    reverse: { rail: 'sepa', settlementMinutes: 60 },
  },
  {
    source: 'EUR',
    target: 'XLM',
    rail: 'stellar',
    minAmount: 5,
    maxAmount: 1_000_000,
    fxFeePct: 0.003,
    fixedFee: 0.5,
    settlementMinutes: 5,
    reverse: { fixedFee: 0.5, settlementMinutes: 5 },
  },
  {
    source: 'GBP',
    target: 'XLM',
    rail: 'stellar',
    minAmount: 5,
    maxAmount: 1_000_000,
    fxFeePct: 0.003,
    fixedFee: 0.5,
    settlementMinutes: 5,
    reverse: { fixedFee: 0.5, settlementMinutes: 5 },
  },
];

function buildCorridors(): Corridor[] {
  const corridors: Corridor[] = [];

  for (const seed of CORRIDOR_SEEDS) {
    corridors.push({
      id: `${seed.source}:${seed.target}`,
      sourceCurrency: seed.source,
      targetCurrency: seed.target,
      rail: seed.rail,
      minAmount: seed.minAmount,
      maxAmount: seed.maxAmount,
      fxFeePct: seed.fxFeePct,
      fixedFee: seed.fixedFee,
      settlementMinutes: seed.settlementMinutes,
    });

    const reverse = seed.reverse ?? {};
    corridors.push({
      id: `${seed.target}:${seed.source}`,
      sourceCurrency: seed.target,
      targetCurrency: seed.source,
      rail: reverse.rail ?? seed.rail,
      minAmount: reverse.minAmount ?? seed.minAmount,
      maxAmount: reverse.maxAmount ?? seed.maxAmount,
      fxFeePct: reverse.fxFeePct ?? seed.fxFeePct,
      fixedFee: reverse.fixedFee ?? seed.fixedFee,
      settlementMinutes: reverse.settlementMinutes ?? seed.settlementMinutes,
    });
  }

  return corridors;
}

const CORRIDORS = buildCorridors();
const CORRIDOR_BY_ID = new Map(CORRIDORS.map((corridor) => [corridor.id, corridor]));

function decimalsFor(currency: string): number {
  return CRYPTO_CURRENCIES.has(currency) ? 7 : 2;
}

function roundMoney(amount: number, currency: string): number {
  const factor = 10 ** decimalsFor(currency);
  return Math.round(amount * factor) / factor;
}

export class CrossBorderPaymentService extends BaseService {
  private fx: RateProvider;
  private quoteTtlMs: number;
  private now: () => Date;

  private readonly quotes = new Map<string, CrossBorderQuote>();
  private readonly payments = new Map<string, CrossBorderPayment>();
  private readonly paymentsByIdempotencyKey = new Map<string, string>();

  constructor(options: CrossBorderServiceOptions = {}) {
    super();
    this.fx = options.fx ?? fxService;
    this.quoteTtlMs = options.quoteTtlMs ?? DEFAULT_QUOTE_TTL_MS;
    this.now = options.now ?? (() => new Date());
  }

  /** Clears in-memory state. Intended for tests. */
  resetForTests(): void {
    this.quotes.clear();
    this.payments.clear();
    this.paymentsByIdempotencyKey.clear();
  }

  // ---------------------------------------------------------------------
  // Corridors
  // ---------------------------------------------------------------------

  listCorridors(): Corridor[] {
    return CORRIDORS.map((corridor) => ({ ...corridor }));
  }

  getCorridor(sourceCurrency: string, targetCurrency: string): Corridor | undefined {
    const corridor = CORRIDOR_BY_ID.get(`${sourceCurrency.toUpperCase()}:${targetCurrency.toUpperCase()}`);
    return corridor ? { ...corridor } : undefined;
  }

  // ---------------------------------------------------------------------
  // Quotes
  // ---------------------------------------------------------------------

  /**
   * prices a cross-border transfer and holds the rate for `quoteTtlMs`.
   *
   * In `source` mode (`amount` is what the sender is debited) fees are taken
   * out of `amount`. In `target` mode (`amount` is what the recipient should
   * receive) the required source amount is solved for, fees included.
   */
  async createQuote(input: {
    amount: number;
    sourceCurrency: string;
    targetCurrency: string;
    mode?: QuoteAmountMode;
  }): Promise<Result<CrossBorderQuote>> {
    const sourceCurrency = input.sourceCurrency?.trim().toUpperCase() ?? '';
    const targetCurrency = input.targetCurrency?.trim().toUpperCase() ?? '';
    const mode: QuoteAmountMode = input.mode ?? 'source';

    if (!CURRENCY_PATTERN.test(sourceCurrency) || !CURRENCY_PATTERN.test(targetCurrency)) {
      return this.validationFailure('sourceCurrency and targetCurrency must be valid currency codes');
    }
    if (sourceCurrency === targetCurrency) {
      return this.validationFailure('Cross-border payments require two different currencies');
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return this.validationFailure('amount must be a positive finite number');
    }
    if (mode !== 'source' && mode !== 'target') {
      return this.validationFailure("mode must be 'source' or 'target'");
    }

    const corridor = CORRIDOR_BY_ID.get(`${sourceCurrency}:${targetCurrency}`);
    if (!corridor) {
      return this.fail(
        `No cross-border corridor from ${sourceCurrency} to ${targetCurrency}`,
        422,
        'CORRIDOR_NOT_SUPPORTED',
        { sourceCurrency, targetCurrency },
      );
    }

    const rateResult = await this.fx.getRate(sourceCurrency, targetCurrency);
    if (!rateResult.ok) return rateResult;

    const rate = rateResult.value.rate;
    if (!Number.isFinite(rate) || rate <= 0) {
      return this.validationFailure(`Invalid FX rate for ${sourceCurrency}/${targetCurrency}: ${rate}`);
    }

    const sourceAmount =
      mode === 'source'
        ? roundMoney(input.amount, sourceCurrency)
        : roundMoney((input.amount / rate + corridor.fixedFee) / (1 - corridor.fxFeePct), sourceCurrency);

    if (sourceAmount < corridor.minAmount || sourceAmount > corridor.maxAmount) {
      return this.fail(
        `Amount must be between ${corridor.minAmount} and ${corridor.maxAmount} ${sourceCurrency} for corridor ${corridor.id}`,
        422,
        'AMOUNT_OUT_OF_RANGE',
        { corridorId: corridor.id, minAmount: corridor.minAmount, maxAmount: corridor.maxAmount },
      );
    }

    const fxFee = roundMoney(sourceAmount * corridor.fxFeePct, sourceCurrency);
    const fixedFee = roundMoney(corridor.fixedFee, sourceCurrency);
    const fees: CrossBorderFees = {
      fxFee,
      fixedFee,
      total: roundMoney(fxFee + fixedFee, sourceCurrency),
    };

    const convertibleAmount = roundMoney(sourceAmount - fees.total, sourceCurrency);
    if (convertibleAmount <= 0) {
      return this.validationFailure('Amount does not cover the corridor fees');
    }

    const targetAmount = roundMoney(convertibleAmount * rate, targetCurrency);
    const createdAt = this.now();

    const quote: CrossBorderQuote = {
      id: randomUUID(),
      corridorId: corridor.id,
      rail: corridor.rail,
      sourceCurrency,
      targetCurrency,
      mode,
      sourceAmount,
      rate,
      convertibleAmount,
      fees,
      targetAmount,
      estimatedArrival: new Date(createdAt.getTime() + corridor.settlementMinutes * 60 * 1000),
      expiresAt: new Date(createdAt.getTime() + this.quoteTtlMs),
      createdAt,
    };

    this.quotes.set(quote.id, quote);
    return this.ok(quote);
  }

  getQuote(id: string): Result<CrossBorderQuote> {
    const quote = this.quotes.get(id);
    if (!quote) return this.notFoundFailure('Quote', id);
    return this.ok(quote);
  }

  // ---------------------------------------------------------------------
  // Payments
  // ---------------------------------------------------------------------

  /**
   * Consumes a quote and creates a payment. Idempotent when an
   * `idempotencyKey` is supplied: replaying the same key returns the existing
   * payment instead of debiting twice.
   */
  async initiatePayment(input: {
    quoteId: string;
    senderId: string;
    recipientId: string;
    reference?: string;
    idempotencyKey?: string;
  }): Promise<Result<CrossBorderPayment>> {
    const { quoteId, senderId, recipientId, reference, idempotencyKey } = input;

    if (!quoteId) return this.validationFailure('quoteId is required');
    if (!senderId) return this.validationFailure('senderId is required');
    if (!recipientId) return this.validationFailure('recipientId is required');

    if (idempotencyKey) {
      const existingId = this.paymentsByIdempotencyKey.get(idempotencyKey);
      const existing = existingId ? this.payments.get(existingId) : undefined;
      if (existing) return this.ok(existing);
    }

    const quote = this.quotes.get(quoteId);
    if (!quote) return this.notFoundFailure('Quote', quoteId);

    if (this.now().getTime() > quote.expiresAt.getTime()) {
      return this.fail('Quote has expired', 409, 'QUOTE_EXPIRED', { quoteId, expiresAt: quote.expiresAt });
    }

    const now = this.now();
    const payment: CrossBorderPayment = {
      id: randomUUID(),
      quoteId: quote.id,
      status: 'processing',
      senderId,
      recipientId,
      reference,
      idempotencyKey,
      corridorId: quote.corridorId,
      rail: quote.rail,
      sourceCurrency: quote.sourceCurrency,
      targetCurrency: quote.targetCurrency,
      sourceAmount: quote.sourceAmount,
      targetAmount: quote.targetAmount,
      rate: quote.rate,
      fees: quote.fees,
      createdAt: now,
      updatedAt: now,
    };

    this.payments.set(payment.id, payment);
    if (idempotencyKey) this.paymentsByIdempotencyKey.set(idempotencyKey, payment.id);

    return this.ok(payment);
  }

  /** Marks a processing payment as settled by the rail. */
  completePayment(id: string, options: { txHash?: string } = {}): Result<CrossBorderPayment> {
    const payment = this.payments.get(id);
    if (!payment) return this.notFoundFailure('Payment', id);

    if (payment.status === 'completed') return this.ok(payment);
    if (payment.status !== 'processing') {
      return this.conflictFailure(`Cannot complete a payment in status '${payment.status}'`);
    }

    const now = this.now();
    const completed: CrossBorderPayment = {
      ...payment,
      status: 'completed',
      txHash: options.txHash,
      completedAt: now,
      updatedAt: now,
    };
    this.payments.set(id, completed);
    return this.ok(completed);
  }

  /** Marks a processing payment as failed (rail rejection, compliance hold, …). */
  failPayment(id: string, reason: string): Result<CrossBorderPayment> {
    const payment = this.payments.get(id);
    if (!payment) return this.notFoundFailure('Payment', id);

    if (payment.status !== 'processing') {
      return this.conflictFailure(`Cannot fail a payment in status '${payment.status}'`);
    }
    if (!reason) return this.validationFailure('reason is required');

    const now = this.now();
    const failed: CrossBorderPayment = {
      ...payment,
      status: 'failed',
      failureReason: reason,
      updatedAt: now,
    };
    this.payments.set(id, failed);
    return this.ok(failed);
  }

  getPayment(id: string): Result<CrossBorderPayment> {
    const payment = this.payments.get(id);
    if (!payment) return this.notFoundFailure('Payment', id);
    return this.ok(payment);
  }

  listPayments(filters: {
    senderId?: string;
    recipientId?: string;
    status?: CrossBorderPaymentStatus;
  } = {}): Result<CrossBorderPayment[]> {
    const payments = [...this.payments.values()]
      .filter((payment) => {
        if (filters.senderId && payment.senderId !== filters.senderId) return false;
        if (filters.recipientId && payment.recipientId !== filters.recipientId) return false;
        if (filters.status && payment.status !== filters.status) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return this.ok(payments);
  }
}

export const crossBorderPaymentService = new CrossBorderPaymentService();
