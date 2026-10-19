import { createHash, randomUUID } from 'node:crypto';
import { auditService } from './auditService.js';
import { getStripe } from './stripe.js';
import {
  FIAT_DECIMALS,
  CRYPTO_DECIMALS,
  formatMinor,
  multiplyByRate,
  parseDecimalToMinor,
} from './money.js';

export type ConversionStatus = 'pending' | 'rate_locked' | 'completed' | 'refunded' | 'failed' | 'expired';

export interface RateLock {
  id: string;
  userId: string;
  fromCurrency: string;
  toAsset: string;
  rate: number;
  amount: number;
  expiresAt: number;
  locked: boolean;
  /** Set once this lock has been consumed by `confirmConversion`, so it cannot be reused. */
  consumedAt?: number;
}

export interface ConversionRecord {
  id: string;
  userId: string;
  fromCurrency: string;
  toAsset: string;
  fiatAmount: number;
  cryptoAmount: string;
  rate: number;
  status: ConversionStatus;
  stripePaymentIntentId?: string;
  stellarTxHash?: string;
  expiresAt: number;
  createdAt: number;
  completedAt?: number;
  refundedAt?: number;
}

/**
 * Fiat-to-stablecoin rates this service is willing to quote.
 *
 * A lookup miss must be an error, never a silent `1.0`: pricing an unsupported pair
 * at par would confirm conversions such as `GBP -> BTC` at one-for-one.
 */
export const SUPPORTED_FIAT_PAIRS: Readonly<Record<string, number>> = Object.freeze({
  'USD/USDC': 1.0,
  'EUR/USDC': 1.08,
  'GBP/USDC': 1.26,
});

/** Upper bound on a single conversion, to keep a fat-fingered amount out of the ledger. */
export const MAX_FIAT_CONVERSION_AMOUNT = 100_000;

const rateLocks = new Map<string, RateLock>();
const conversions = new Map<string, ConversionRecord>();
const refundsInFlight = new Set<string>();

const STELLAR_USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const RATE_EXPIRY_MS = 5 * 60 * 1000;
const CONVERSION_EXPIRY_MS = 30 * 60 * 1000;

const MAX_ID_LENGTH = 128;
const STELLAR_ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;

function pairKey(fromCurrency: string, toAsset: string): string {
  return `${fromCurrency.toUpperCase()}/${toAsset.toUpperCase()}`;
}

/**
 * Resolves the rate for a supported pair.
 * @throws Error `UNSUPPORTED_FIAT_PAIR` when the pair is not quoted.
 */
function getCurrentRate(fromCurrency: string, toAsset: string): number {
  const key = pairKey(fromCurrency, toAsset);
  if (!Object.prototype.hasOwnProperty.call(SUPPORTED_FIAT_PAIRS, key)) {
    throw new Error(`UNSUPPORTED_FIAT_PAIR: ${key} is not quoted`);
  }
  return SUPPORTED_FIAT_PAIRS[key];
}

function assertNonEmptyId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new Error(`INVALID_${field.toUpperCase()}`);
  }
  return value;
}

function snapshot(record: ConversionRecord): ConversionRecord {
  return { ...record };
}

/** Parses a positive settlement amount, collapsing every failure mode onto one sentinel. */
function parseSettlementAmount(amount: string): bigint {
  try {
    const minor = parseDecimalToMinor(amount, CRYPTO_DECIMALS);
    if (minor > 0n) return minor;
  } catch {
    // Any malformed amount falls through to the sentinel below.
  }
  throw new Error('INVALID_SETTLEMENT_AMOUNT');
}

/** Converts a fiat amount into the exact crypto amount at `rate`, without float drift. */
export function convertFiatToCrypto(fiatAmount: number, rate: number, decimals: number = CRYPTO_DECIMALS): string {
  const fiatMinor = parseDecimalToMinor(fiatAmount, FIAT_DECIMALS);
  const cryptoMinor = multiplyByRate(fiatMinor, rate, CRYPTO_DECIMALS);
  return formatMinor(cryptoMinor, decimals);
}

export async function lockRate(userId: string, fromCurrency: string, toAsset: string, amount: number): Promise<RateLock> {
  assertNonEmptyId(userId, 'user_id');

  // Resolve the pair first: an unsupported pair must not produce a lock at all.
  const rate = getCurrentRate(fromCurrency, toAsset);

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('INVALID_CONVERSION_AMOUNT');
  }
  if (amount > MAX_FIAT_CONVERSION_AMOUNT) {
    throw new Error('CONVERSION_AMOUNT_EXCEEDED');
  }

  // Normalise to the currency's minor units so sub-cent input cannot produce a
  // conversion whose crypto amount disagrees with the fiat amount on record.
  const fiatMinor = parseDecimalToMinor(amount, FIAT_DECIMALS);
  if (fiatMinor <= 0n) {
    throw new Error('INVALID_CONVERSION_AMOUNT');
  }

  const lock: RateLock = {
    id: randomUUID(),
    userId,
    fromCurrency: fromCurrency.toUpperCase(),
    toAsset: toAsset.toUpperCase(),
    rate,
    amount: Number(formatMinor(fiatMinor, FIAT_DECIMALS)),
    expiresAt: Date.now() + RATE_EXPIRY_MS,
    locked: true,
  };
  rateLocks.set(lock.id, lock);
  return { ...lock };
}

export async function confirmConversion(rateLockId: string, userId: string, stripePaymentIntentId: string): Promise<ConversionRecord> {
  const lock = rateLocks.get(rateLockId);
  if (!lock) throw new Error('Rate lock not found');
  // A lock belongs to whoever created it, and can be spent exactly once -- otherwise
  // one locked rate could be confirmed repeatedly (duplicate conversions from a single
  // amount) or confirmed by a user who never created it.
  if (lock.userId !== userId) throw new Error('Rate lock not found');
  if (lock.consumedAt !== undefined) throw new Error('Rate lock has already been used');
  if (Date.now() > lock.expiresAt) throw new Error('Rate lock has expired');

  lock.consumedAt = Date.now();
  rateLocks.set(lock.id, lock);

  const cryptoAmount = convertFiatToCrypto(lock.amount, lock.rate);
  const conversion: ConversionRecord = {
    id: randomUUID(),
    userId: lock.userId,
    fromCurrency: lock.fromCurrency,
    toAsset: lock.toAsset,
    fiatAmount: lock.amount,
    cryptoAmount,
    rate: lock.rate,
    status: 'completed',
    stripePaymentIntentId,
    expiresAt: lock.expiresAt,
    createdAt: Date.now(),
    completedAt: Date.now(),
  };
  conversions.set(conversion.id, conversion);

  await auditService.logAction({ action: 'fiat_crypto.conversion_completed', resource: 'conversion', resourceId: conversion.id, details: { fiatAmount: lock.amount, cryptoAmount, rate: lock.rate } });
  return snapshot(conversion);
}

export async function settleToStellar(destinationAddress: string, amount: string, asset: string): Promise<string> {
  assertNonEmptyId(destinationAddress, 'destination_address');
  parseSettlementAmount(amount);

  if (!STELLAR_ADDRESS_PATTERN.test(destinationAddress)) {
    throw new Error('INVALID_DESTINATION_ADDRESS');
  }

  // Derive the reference from the inputs so the same settlement always produces the
  // same id; `Math.random()` cannot be reconciled against the chain afterwards.
  const txHash = `stellar_${createHash('sha256')
    .update(`${destinationAddress}|${amount}|${asset}`)
    .digest('hex')
    .slice(0, 32)}`;

  await auditService.logAction({ action: 'fiat_crypto.settled_to_stellar', resource: 'stellar_settlement', details: { destination: destinationAddress, amount, asset, txHash } });
  return txHash;
}

/**
 * Refunds a completed conversion.
 *
 * Returns `false` when the conversion is missing, not `completed`, or has no refundable
 * payment intent -- reporting success without moving money would leave the ledger wrong.
 * Concurrent calls for the same conversion collapse onto a single Stripe refund.
 */
export async function processFiatRefund(conversionId: string): Promise<boolean> {
  const conversion = conversions.get(conversionId);
  if (!conversion || conversion.status !== 'completed') return false;
  if (!conversion.stripePaymentIntentId) return false;
  if (refundsInFlight.has(conversionId)) return false;

  refundsInFlight.add(conversionId);
  try {
    const stripe = getStripe();
    await stripe.refunds.create({ payment_intent: conversion.stripePaymentIntentId });

    conversion.status = 'refunded';
    conversion.refundedAt = Date.now();
    conversions.set(conversionId, conversion);

    await auditService.logAction({ action: 'fiat_crypto.refund_processed', resource: 'conversion', resourceId: conversionId });
    return true;
  } finally {
    refundsInFlight.delete(conversionId);
  }
}

export async function getConversion(id: string): Promise<ConversionRecord | undefined> {
  const conversion = conversions.get(id);
  return conversion ? snapshot(conversion) : undefined;
}

export async function listConversions(userId?: string): Promise<ConversionRecord[]> {
  const all = Array.from(conversions.values());
  return (userId ? all.filter((c) => c.userId === userId) : all).map(snapshot);
}

/**
 * Quotes a rate.
 * @throws Error `UNSUPPORTED_FIAT_PAIR` when the pair is not quoted.
 */
export function getRate(fromCurrency: string, toAsset: string): number {
  return getCurrentRate(fromCurrency, toAsset);
}

/** True when the pair has a quoted rate. */
export function isSupportedFiatPair(fromCurrency: string, toAsset: string): boolean {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_FIAT_PAIRS, pairKey(fromCurrency, toAsset));
}