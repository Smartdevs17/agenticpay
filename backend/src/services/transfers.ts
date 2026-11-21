/**
 * Transfers.ts — Issue #913
 *
 * Instant account-to-account (A2A) transfers.
 *
 * The service models a real-time bank transfer rail:
 *  - accounts are registered and validated before money can move;
 *  - a short-lived quote locks the fee and FX rate shown to the customer;
 *  - transfers are initiated with an idempotency key so retries never
 *    double-charge;
 *  - instant transfers settle synchronously, while transfers with a future
 *    `scheduledFor` remain `pending` and can be cancelled before settlement;
 *  - completed transfers can be reversed inside a configurable window.
 */

import { randomUUID } from 'node:crypto';
import { BaseService } from './BaseService.js';

export type TransferStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'reversed';

export type TransferRail = 'instant' | 'standard';

export type AccountStatus = 'active' | 'frozen' | 'closed';

export interface Account {
  id: string;
  currency: string;
  status: AccountStatus;
  holderName?: string;
  createdAt: string;
}

export interface TransferQuote {
  id: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  currency: string;
  destinationCurrency: string;
  destinationAmount: number;
  fee: number;
  totalDebit: number;
  fxRate: number;
  rail: TransferRail;
  expiresAt: string;
  createdAt: string;
}

export interface Transfer {
  id: string;
  quoteId?: string;
  idempotencyKey: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  fee: number;
  totalDebit: number;
  currency: string;
  destinationCurrency: string;
  destinationAmount: number;
  fxRate: number;
  rail: TransferRail;
  status: TransferStatus;
  scheduledFor?: string;
  completedAt?: string;
  failedAt?: string;
  failureReason?: string;
  cancelledAt?: string;
  reversedAt?: string;
  reversalReason?: string;
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTransferInput {
  quoteId?: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  currency: string;
  destinationCurrency?: string;
  idempotencyKey: string;
  scheduledFor?: string;
  metadata?: Record<string, string>;
}

/** Currencies that settle on the instant rail. Others fall back to standard. */
const INSTANT_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'USDC']);

/** Indicative FX rates against USD. In production these come from a rates feed. */
const FX_RATES: Record<string, number> = {
  USD: 1,
  USDC: 1,
  EUR: 0.92,
  GBP: 0.79,
  NGN: 1550,
  INR: 83.2,
  BRL: 5.05,
};

export interface TransferLimits {
  /** Maximum notional for a single transfer, in source currency. */
  perTransfer: number;
  /** Rolling 24h volume allowed per source account, in source currency. */
  daily: number;
  /** Millisecond window in which a completed transfer may be reversed. */
  reversalWindowMs: number;
  /** Lifetime of a quote, in milliseconds. */
  quoteTtlMs: number;
}

export const DEFAULT_TRANSFER_LIMITS: TransferLimits = {
  perTransfer: 25_000,
  daily: 100_000,
  reversalWindowMs: 24 * 60 * 60 * 1000,
  quoteTtlMs: 60_000,
};

export class TransferService extends BaseService {
  private accounts = new Map<string, Account>();
  private quotes = new Map<string, TransferQuote>();
  private transfers = new Map<string, Transfer>();
  private idempotencyIndex = new Map<string, string>();

  constructor(
    private readonly limits: TransferLimits = DEFAULT_TRANSFER_LIMITS,
    private readonly now: () => number = Date.now,
  ) {
    super();
  }

  // ---------------------------------------------------------------- accounts

  registerAccount(params: {
    id?: string;
    currency: string;
    status?: AccountStatus;
    holderName?: string;
  }): Account {
    const currency = params.currency.toUpperCase();
    this.validate(currency.length === 3, 'Currency must be a 3-letter ISO code');
    this.validate(!!FX_RATES[currency], `Unsupported currency: ${currency}`);

    const account: Account = {
      id: params.id ?? `acct_${randomUUID()}`,
      currency,
      status: params.status ?? 'active',
      holderName: params.holderName,
      createdAt: new Date(this.now()).toISOString(),
    };

    this.accounts.set(account.id, account);
    return account;
  }

  getAccount(id: string): Account | undefined {
    return this.accounts.get(id);
  }

  // ------------------------------------------------------------------ quotes

  createQuote(params: {
    sourceAccountId: string;
    destinationAccountId: string;
    amount: number;
    destinationCurrency?: string;
  }): TransferQuote {
    const { source, destination, amount, currency, destinationCurrency, rail } =
      this.resolveTransferContext(params);

    const { fee, fxRate, destinationAmount } = this.priceTransfer(amount, currency, destinationCurrency);

    const createdAt = this.now();
    const quote: TransferQuote = {
      id: `qt_${randomUUID()}`,
      sourceAccountId: source.id,
      destinationAccountId: destination.id,
      amount: this.round(amount),
      currency,
      destinationCurrency,
      destinationAmount,
      fee,
      totalDebit: this.round(amount + fee),
      fxRate,
      rail,
      expiresAt: new Date(createdAt + this.limits.quoteTtlMs).toISOString(),
      createdAt: new Date(createdAt).toISOString(),
    };

    this.quotes.set(quote.id, quote);
    return quote;
  }

  getQuote(id: string): TransferQuote | undefined {
    return this.quotes.get(id);
  }

  // --------------------------------------------------------------- transfers

  /**
   * Initiate a transfer. Retrying with the same `idempotencyKey` returns the
   * original transfer instead of moving money twice.
   */
  initiateTransfer(input: CreateTransferInput): { transfer: Transfer; idempotent: boolean } {
    this.validate(!!input.idempotencyKey, 'idempotencyKey is required');

    const existingId = this.idempotencyIndex.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.transfers.get(existingId);
      if (existing) return { transfer: existing, idempotent: true };
    }

    const context = this.resolveTransferContext(input);
    const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : undefined;
    if (scheduledFor) {
      this.validate(!Number.isNaN(scheduledFor.getTime()), 'scheduledFor must be a valid ISO date');
    }

    const isFutureDated = !!scheduledFor && scheduledFor.getTime() > this.now();
    const rail: TransferRail = isFutureDated ? 'standard' : context.rail;

    let fee: number;
    let fxRate: number;
    let destinationAmount: number;
    let quoteId: string | undefined;

    if (input.quoteId) {
      const quote = this.quotes.get(input.quoteId);
      if (!quote) this.notFound('Transfer quote', input.quoteId);
      this.validate(
        new Date(quote.expiresAt).getTime() > this.now(),
        'Transfer quote has expired',
      );
      this.validate(
        quote.sourceAccountId === context.source.id &&
          quote.destinationAccountId === context.destination.id,
        'Transfer quote does not match the source/destination accounts',
      );
      this.validate(
        this.round(quote.amount) === this.round(input.amount),
        'Transfer amount does not match the quote',
      );
      fee = quote.fee;
      fxRate = quote.fxRate;
      destinationAmount = quote.destinationAmount;
      quoteId = quote.id;
    } else {
      ({ fee, fxRate, destinationAmount } = this.priceTransfer(
        input.amount,
        context.currency,
        context.destinationCurrency,
      ));
    }

    this.assertVelocityLimit(context.source.id, context.currency, input.amount);

    const createdAt = this.now();
    const transfer: Transfer = {
      id: `tr_${randomUUID()}`,
      quoteId,
      idempotencyKey: input.idempotencyKey,
      sourceAccountId: context.source.id,
      destinationAccountId: context.destination.id,
      amount: this.round(input.amount),
      fee,
      totalDebit: this.round(input.amount + fee),
      currency: context.currency,
      destinationCurrency: context.destinationCurrency,
      destinationAmount,
      fxRate,
      rail,
      status: isFutureDated ? 'pending' : 'processing',
      scheduledFor: scheduledFor?.toISOString(),
      metadata: input.metadata,
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: new Date(createdAt).toISOString(),
    };

    this.transfers.set(transfer.id, transfer);
    this.idempotencyIndex.set(transfer.idempotencyKey, transfer.id);

    // Instant transfers settle before the response is returned.
    if (!isFutureDated) {
      this.settleTransfer(transfer.id);
    }

    return { transfer: this.transfers.get(transfer.id)!, idempotent: false };
  }

  /** Move a pending transfer onto the rail and settle it. */
  settleTransfer(id: string): Transfer {
    const transfer = this.transfers.get(id);
    if (!transfer) this.notFound('Transfer', id);
    if (transfer.status !== 'pending' && transfer.status !== 'processing') {
      this.conflict(`Transfer cannot be settled from status ${transfer.status}`);
    }

    const now = this.now();
    transfer.status = 'completed';
    transfer.completedAt = new Date(now).toISOString();
    transfer.updatedAt = transfer.completedAt;
    this.transfers.set(id, transfer);
    return transfer;
  }

  getTransfer(id: string): Transfer | undefined {
    return this.transfers.get(id);
  }

  listTransfers(filter: {
    accountId?: string;
    status?: TransferStatus;
    limit?: number;
    offset?: number;
  } = {}): { transfers: Transfer[]; total: number } {
    const all = Array.from(this.transfers.values())
      .filter((t) => (filter.accountId ? t.sourceAccountId === filter.accountId || t.destinationAccountId === filter.accountId : true))
      .filter((t) => (filter.status ? t.status === filter.status : true))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const offset = filter.offset ?? 0;
    const limit = Math.min(filter.limit ?? 50, 100);

    return { transfers: all.slice(offset, offset + limit), total: all.length };
  }

  /** Cancel a transfer that has not settled yet. */
  cancelTransfer(id: string): Transfer {
    const transfer = this.transfers.get(id);
    if (!transfer) this.notFound('Transfer', id);
    this.conflictIfSettled(transfer, 'cancel');

    transfer.status = 'cancelled';
    transfer.cancelledAt = new Date(this.now()).toISOString();
    transfer.updatedAt = transfer.cancelledAt;
    this.transfers.set(id, transfer);
    return transfer;
  }

  /** Reverse a settled transfer inside the reversal window. */
  reverseTransfer(id: string, reason: string): Transfer {
    this.validate(!!reason, 'Reversal reason is required');

    const transfer = this.transfers.get(id);
    if (!transfer) this.notFound('Transfer', id);
    if (transfer.status !== 'completed') {
      this.conflict('Only completed transfers can be reversed');
    }

    const completedAt = transfer.completedAt ? new Date(transfer.completedAt).getTime() : 0;
    if (this.now() - completedAt > this.limits.reversalWindowMs) {
      this.conflict('Transfer is outside the reversal window');
    }

    transfer.status = 'reversed';
    transfer.reversedAt = new Date(this.now()).toISOString();
    transfer.reversalReason = reason;
    transfer.updatedAt = transfer.reversedAt;
    this.transfers.set(id, transfer);
    return transfer;
  }

  /** Total settled/in-flight volume for an account in the last 24 hours. */
  getDailyVolume(accountId: string): number {
    const since = this.now() - 24 * 60 * 60 * 1000;
    return this.round(
      Array.from(this.transfers.values())
        .filter((t) => t.sourceAccountId === accountId)
        .filter((t) => ['pending', 'processing', 'completed'].includes(t.status))
        .filter((t) => new Date(t.createdAt).getTime() >= since)
        .reduce((sum, t) => sum + t.amount, 0),
    );
  }

  resetForTests(): void {
    this.accounts.clear();
    this.quotes.clear();
    this.transfers.clear();
    this.idempotencyIndex.clear();
  }

  // ---------------------------------------------------------------- internals

  private resolveTransferContext(params: {
    sourceAccountId: string;
    destinationAccountId: string;
    amount: number;
    destinationCurrency?: string;
  }): {
    source: Account;
    destination: Account;
    amount: number;
    currency: string;
    destinationCurrency: string;
    rail: TransferRail;
  } {
    this.validate(params.amount > 0, 'Amount must be greater than 0');
    this.validate(
      params.sourceAccountId !== params.destinationAccountId,
      'Source and destination accounts must be different',
    );

    const source = this.accounts.get(params.sourceAccountId);
    if (!source) this.notFound('Source account', params.sourceAccountId);
    const destination = this.accounts.get(params.destinationAccountId);
    if (!destination) this.notFound('Destination account', params.destinationAccountId);

    if (source.status !== 'active') this.forbidden('Source account is not active');
    if (destination.status !== 'active') this.forbidden('Destination account is not active');
    this.validate(
      params.amount <= this.limits.perTransfer,
      `Amount exceeds the per-transfer limit of ${this.limits.perTransfer} ${source.currency}`,
    );

    const destinationCurrency = (params.destinationCurrency ?? destination.currency).toUpperCase();
    const rail: TransferRail =
      INSTANT_CURRENCIES.has(source.currency) && INSTANT_CURRENCIES.has(destinationCurrency)
        ? 'instant'
        : 'standard';

    return {
      source,
      destination,
      amount: params.amount,
      currency: source.currency,
      destinationCurrency,
      rail,
    };
  }

  private priceTransfer(amount: number, currency: string, destinationCurrency: string) {
    // Flat 0.5% with a 0.50 floor and 25.00 cap.
    const fee = this.round(Math.min(Math.max(amount * 0.005, 0.5), 25));
    const sourceRate = FX_RATES[currency];
    const destinationRate = FX_RATES[destinationCurrency];
    this.validate(!!sourceRate, `Unsupported source currency: ${currency}`);
    this.validate(!!destinationRate, `Unsupported destination currency: ${destinationCurrency}`);

    const fxRate = this.round(destinationRate / sourceRate, 6);
    const destinationAmount = this.round(amount * fxRate);
    return { fee, fxRate, destinationAmount };
  }

  private assertVelocityLimit(accountId: string, currency: string, amount: number): void {
    const projected = this.getDailyVolume(accountId) + amount;
    this.validate(
      projected <= this.limits.daily,
      `Daily transfer limit of ${this.limits.daily} ${currency} would be exceeded`,
    );
  }

  private conflictIfSettled(transfer: Transfer, action: string): void {
    if (transfer.status !== 'pending') {
      this.conflict(`Transfer in status ${transfer.status} cannot be ${action}led`);
    }
  }

  private round(value: number, decimals = 2): number {
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }
}

export const transferService = new TransferService();
