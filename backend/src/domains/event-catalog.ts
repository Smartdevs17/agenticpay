/**
 * Issue #489 — Domain Event Catalog
 *
 * Single source of truth for all async domain events.
 * Each entry declares the event type, producing domain, payload schema, and version.
 */

import type { DomainEvent, Domain } from './contracts.js';

// ── Typed event payloads ──────────────────────────────────────────────────────

export interface PaymentCompletedPayload { paymentId: string; amount: number; currency: string; from: string; to: string }
export interface PaymentFailedPayload    { paymentId: string; reason: string }
export interface MerchantOnboardedPayload { merchantId: string; name: string; tier: string }
export interface WalletFundedPayload     { walletId: string; amount: number; asset: string }
export interface NotificationSentPayload { notificationId: string; userId: string; channel: string }
export interface IdentityVerifiedPayload { userId: string; level: 'basic' | 'full' }

// ── Event type constants ──────────────────────────────────────────────────────

export const EventTypes = {
  PAYMENT_COMPLETED:   'payment.completed',
  PAYMENT_FAILED:      'payment.failed',
  MERCHANT_ONBOARDED:  'merchant.onboarded',
  WALLET_FUNDED:       'wallet.funded',
  NOTIFICATION_SENT:   'notification.sent',
  IDENTITY_VERIFIED:   'identity.verified',
} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];

// ── Catalog entry ─────────────────────────────────────────────────────────────

export interface CatalogEntry {
  type: EventType;
  domain: Domain;
  version: number;
  description: string;
}

export const eventCatalog: CatalogEntry[] = [
  { type: EventTypes.PAYMENT_COMPLETED,  domain: 'payments',      version: 1, description: 'Fired when a payment successfully settles.' },
  { type: EventTypes.PAYMENT_FAILED,     domain: 'payments',      version: 1, description: 'Fired when a payment fails after all retries.' },
  { type: EventTypes.MERCHANT_ONBOARDED, domain: 'merchants',     version: 1, description: 'Fired when a merchant completes onboarding.' },
  { type: EventTypes.WALLET_FUNDED,      domain: 'wallets',       version: 1, description: 'Fired when a wallet receives funds.' },
  { type: EventTypes.NOTIFICATION_SENT,  domain: 'notifications', version: 1, description: 'Fired when a notification is dispatched.' },
  { type: EventTypes.IDENTITY_VERIFIED,  domain: 'identity',      version: 1, description: 'Fired when user identity verification completes.' },
];

// ── Factory helper ────────────────────────────────────────────────────────────

export function createEvent<TPayload>(
  type: EventType,
  domain: Domain,
  payload: TPayload,
  version = 1,
): DomainEvent<TPayload> {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    domain,
    occurredAt: new Date().toISOString(),
    payload,
    version,
  };
}
