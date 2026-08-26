/**
 * Issue #489 — Shared domain contracts
 *
 * Common types and interfaces shared across all bounded contexts.
 * Import from this module rather than duplicating types per-service.
 */

// ── Bounded context identifiers ───────────────────────────────────────────────

export type Domain = 'payments' | 'merchants' | 'wallets' | 'analytics' | 'notifications' | 'identity';

// ── Base domain event ─────────────────────────────────────────────────────────

export interface DomainEvent<TPayload = unknown> {
  /** Globally unique event id */
  id: string;
  /** The bounded context that produced this event */
  domain: Domain;
  /** Event type name, e.g. "payment.completed" */
  type: string;
  /** ISO-8601 timestamp */
  occurredAt: string;
  /** Event-specific payload */
  payload: TPayload;
  /** Schema version for consumer compatibility */
  version: number;
}

// ── Service interface contracts ───────────────────────────────────────────────

export interface PaymentContract {
  processPayment(input: { amount: number; currency: string; from: string; to: string }): Promise<{ paymentId: string; status: string }>;
  getPaymentStatus(paymentId: string): Promise<{ status: string; updatedAt: string } | null>;
}

export interface NotificationContract {
  send(input: { userId: string; channel: 'email' | 'push' | 'sms'; template: string; data: Record<string, unknown> }): Promise<void>;
}

export interface IdentityContract {
  verify(userId: string): Promise<{ verified: boolean; level: 'basic' | 'full' }>;
}
