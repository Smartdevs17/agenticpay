import { randomUUID } from 'node:crypto';
import { auditService } from './auditService.js';
import { getStripe } from './stripe.js';

export type ConversionStatus = 'pending' | 'rate_locked' | 'completed' | 'failed' | 'expired';

export interface RateLock {
  id: string;
  fromCurrency: string;
  toAsset: string;
  rate: number;
  amount: number;
  expiresAt: number;
  locked: boolean;
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
}

const rateLocks = new Map<string, RateLock>();
const conversions = new Map<string, ConversionRecord>();

const STELLAR_USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const RATE_EXPIRY_MS = 5 * 60 * 1000;
const CONVERSION_EXPIRY_MS = 30 * 60 * 1000;

function getCurrentRate(fromCurrency: string, toAsset: string): number {
  if (fromCurrency === 'USD' && toAsset === 'USDC') return 1.0;
  if (fromCurrency === 'EUR' && toAsset === 'USDC') return 1.08;
  if (fromCurrency === 'GBP' && toAsset === 'USDC') return 1.26;
  return 1.0;
}

export async function lockRate(fromCurrency: string, toAsset: string, amount: number): Promise<RateLock> {
  const rate = getCurrentRate(fromCurrency, toAsset);
  const lock: RateLock = {
    id: randomUUID(),
    fromCurrency,
    toAsset,
    rate,
    amount,
    expiresAt: Date.now() + RATE_EXPIRY_MS,
    locked: true,
  };
  rateLocks.set(lock.id, lock);
  return lock;
}

export async function confirmConversion(rateLockId: string, stripePaymentIntentId: string): Promise<ConversionRecord> {
  const lock = rateLocks.get(rateLockId);
  if (!lock) throw new Error('Rate lock not found');
  if (Date.now() > lock.expiresAt) throw new Error('Rate lock has expired');

  const cryptoAmount = (lock.amount * lock.rate).toFixed(7);
  const conversion: ConversionRecord = {
    id: randomUUID(),
    userId: 'user_default',
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
  return conversion;
}

export async function settleToStellar(destinationAddress: string, amount: string, asset: string): Promise<string> {
  const simulatedTxHash = `stellar_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  await auditService.logAction({ action: 'fiat_crypto.settled_to_stellar', resource: 'stellar_settlement', details: { destination: destinationAddress, amount, asset, txHash: simulatedTxHash } });
  return simulatedTxHash;
}

export async function processFiatRefund(conversionId: string): Promise<boolean> {
  const conversion = conversions.get(conversionId);
  if (!conversion || conversion.status !== 'completed') return false;

  const stripe = getStripe();
  if (conversion.stripePaymentIntentId) {
    await stripe.refunds.create({ payment_intent: conversion.stripePaymentIntentId });
  }

  conversion.status = 'failed';
  conversions.set(conversionId, conversion);

  await auditService.logAction({ action: 'fiat_crypto.refund_processed', resource: 'conversion', resourceId: conversionId });
  return true;
}

export async function getConversion(id: string): Promise<ConversionRecord | undefined> {
  return conversions.get(id);
}

export async function listConversions(userId?: string): Promise<ConversionRecord[]> {
  const all = Array.from(conversions.values());
  return userId ? all.filter(c => c.userId === userId) : all;
}

export function getRate(fromCurrency: string, toAsset: string): number {
  return getCurrentRate(fromCurrency, toAsset);
}
