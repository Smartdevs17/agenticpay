/**
 * wallet-payments.ts — Issue #916
 *
 * Apple Pay and Google Pay checkout support.
 *
 * Merchants register for a wallet provider and verify the domains they will
 * accept payments from (Apple Pay requires domain verification). Checkout then
 * follows the standard wallet flow:
 *   1. create a payment session for the cart amount;
 *   2. run merchant validation (Apple Pay's merchant session handshake);
 *   3. submit the encrypted payment token for processing and settlement.
 */

import { randomUUID } from 'node:crypto';
import { BaseService } from './BaseService.js';

export type WalletProvider = 'apple_pay' | 'google_pay';
export type WalletSessionStatus = 'created' | 'validated' | 'completed' | 'failed' | 'expired';

export interface DomainRegistration {
  domain: string;
  verificationToken: string;
  verified: boolean;
  registeredAt: string;
  verifiedAt?: string;
}

export interface WalletMerchant {
  merchantId: string;
  provider: WalletProvider;
  merchantIdentifier: string;
  displayName: string;
  countryCode: string;
  supportedNetworks: string[];
  domains: DomainRegistration[];
  createdAt: string;
}

export interface WalletPaymentSession {
  id: string;
  merchantId: string;
  provider: WalletProvider;
  amount: number;
  currency: string;
  countryCode: string;
  label: string;
  supportedNetworks: string[];
  status: WalletSessionStatus;
  expiresAt: string;
  validatedAt?: string;
  completedAt?: string;
  transactionId?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WalletPaymentToken {
  /** Card network, e.g. "visa" or "mastercard". */
  network: string;
  /** Encrypted payment data (cryptogram) produced by the device. */
  cryptogram: string;
  /** Wallet-supplied transaction identifier. */
  transactionId?: string;
  /** Token expiry (Apple Pay paymentData has no expiry; Google Pay tokens do). */
  expiresAt?: string;
  displayName?: string;
}

export interface WalletPaymentResult {
  sessionId: string;
  provider: WalletProvider;
  status: WalletSessionStatus;
  transactionId: string;
  network: string;
  amount: number;
  currency: string;
  processedAt: string;
}

const PROVIDER_NETWORKS: Record<WalletProvider, string[]> = {
  apple_pay: ['visa', 'mastercard', 'amex', 'discover'],
  google_pay: ['visa', 'mastercard', 'amex', 'discover', 'jcb'],
};

const SESSION_TTL_MS = 30 * 60 * 1000;
const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export class WalletPaymentService extends BaseService {
  private merchants = new Map<string, WalletMerchant>();
  private sessions = new Map<string, WalletPaymentSession>();

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  // --------------------------------------------------------------- merchants

  registerMerchant(input: {
    merchantId: string;
    provider: WalletProvider;
    merchantIdentifier?: string;
    displayName: string;
    countryCode?: string;
  }): WalletMerchant {
    this.validate(!!input.merchantId, 'merchantId is required');
    this.validate(!!input.displayName, 'displayName is required');
    this.validate(
      input.provider === 'apple_pay' || input.provider === 'google_pay',
      'provider must be apple_pay or google_pay',
    );

    const countryCode = (input.countryCode ?? 'US').toUpperCase();
    this.validate(/^[A-Z]{2}$/.test(countryCode), 'countryCode must be a 2-letter ISO code');

    const merchantIdentifier = input.merchantIdentifier ?? `${input.provider === 'apple_pay' ? 'merchant' : 'google'}.${input.merchantId}`;
    if (input.provider === 'apple_pay') {
      this.validate(!!input.merchantIdentifier, 'merchantIdentifier is required for Apple Pay');
    }

    const merchant: WalletMerchant = {
      merchantId: input.merchantId,
      provider: input.provider,
      merchantIdentifier,
      displayName: input.displayName,
      countryCode,
      supportedNetworks: [...PROVIDER_NETWORKS[input.provider]],
      domains: [],
      createdAt: new Date(this.now()).toISOString(),
    };

    this.merchants.set(this.merchantKey(input.merchantId, input.provider), merchant);
    return merchant;
  }

  getMerchant(merchantId: string, provider: WalletProvider): WalletMerchant | undefined {
    return this.merchants.get(this.merchantKey(merchantId, provider));
  }

  getSupportedNetworks(provider: WalletProvider): string[] {
    this.validate(!!PROVIDER_NETWORKS[provider], `Unsupported wallet provider: ${provider}`);
    return [...PROVIDER_NETWORKS[provider]];
  }

  // ----------------------------------------------------------- domain checks

  registerDomain(merchantId: string, provider: WalletProvider, domain: string): DomainRegistration {
    const merchant = this.getMerchant(merchantId, provider);
    if (!merchant) this.notFound('Wallet merchant', merchantId);

    const normalized = domain.trim().toLowerCase();
    this.validate(DOMAIN_PATTERN.test(normalized), 'domain must be a valid hostname');
    if (merchant.domains.some((d) => d.domain === normalized)) {
      this.conflict('Domain is already registered');
    }

    const registration: DomainRegistration = {
      domain: normalized,
      verificationToken: `ap_${randomUUID().replace(/-/g, '')}`,
      verified: false,
      registeredAt: new Date(this.now()).toISOString(),
    };

    merchant.domains.push(registration);
    return registration;
  }

  verifyDomain(
    merchantId: string,
    provider: WalletProvider,
    domain: string,
    token: string,
  ): DomainRegistration {
    const merchant = this.getMerchant(merchantId, provider);
    if (!merchant) this.notFound('Wallet merchant', merchantId);

    const registration = merchant.domains.find((d) => d.domain === domain.trim().toLowerCase());
    if (!registration) this.notFound('Domain registration', domain);
    this.validate(
      registration.verificationToken === token,
      'Domain verification token does not match',
    );

    registration.verified = true;
    registration.verifiedAt = new Date(this.now()).toISOString();
    return registration;
  }

  // ------------------------------------------------------------------ sessions

  createPaymentSession(input: {
    merchantId: string;
    provider: WalletProvider;
    amount: number;
    currency?: string;
    label?: string;
  }): WalletPaymentSession {
    this.validate(input.amount > 0, 'Amount must be greater than 0');
    const currency = (input.currency ?? 'USD').toUpperCase();
    this.validate(/^[A-Z]{3}$/.test(currency), 'currency must be a 3-letter ISO code');

    const merchant = this.getMerchant(input.merchantId, input.provider);
    if (!merchant) this.notFound('Wallet merchant', input.merchantId);
    if (!merchant.domains.some((d) => d.verified)) {
      this.validate(false, 'At least one verified domain is required to accept wallet payments');
    }

    const createdAt = this.now();
    const session: WalletPaymentSession = {
      id: `wps_${randomUUID()}`,
      merchantId: merchant.merchantId,
      provider: merchant.provider,
      amount: this.round(input.amount),
      currency,
      countryCode: merchant.countryCode,
      label: input.label ?? merchant.displayName,
      supportedNetworks: [...merchant.supportedNetworks],
      status: 'created',
      expiresAt: new Date(createdAt + SESSION_TTL_MS).toISOString(),
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: new Date(createdAt).toISOString(),
    };

    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): WalletPaymentSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    if (
      this.now() > new Date(session.expiresAt).getTime() &&
      (session.status === 'created' || session.status === 'validated')
    ) {
      session.status = 'expired';
      session.updatedAt = new Date(this.now()).toISOString();
      this.sessions.set(id, session);
    }

    return session;
  }

  /**
   * Apple Pay merchant validation handshake. Returns the merchant session that
   * the native payment sheet needs before it will authorise a payment.
   */
  validateMerchant(sessionId: string): { session: WalletPaymentSession; merchantSession: Record<string, unknown> } {
    const session = this.getSession(sessionId);
    if (!session) this.notFound('Wallet payment session', sessionId);
    this.assertSessionStatus(session, ['created'], 'validate');

    const now = this.now();
    session.status = 'validated';
    session.validatedAt = new Date(now).toISOString();
    session.updatedAt = session.validatedAt;
    this.sessions.set(session.id, session);

    return {
      session,
      merchantSession: {
        epochTimestamp: now,
        expiresAt: now + SESSION_TTL_MS,
        merchantSessionIdentifier: `msi_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
        merchantIdentifier: this.getMerchant(session.merchantId, session.provider)?.merchantIdentifier,
        displayName: session.label,
        domainName: this.getMerchant(session.merchantId, session.provider)?.domains.find((d) => d.verified)?.domain,
        operationalAnalyticsIdentifier: undefined,
      },
    };
  }

  /** Submit the encrypted wallet token and settle the payment. */
  processPaymentToken(sessionId: string, token: WalletPaymentToken): WalletPaymentResult {
    const session = this.getSession(sessionId);
    if (!session) this.notFound('Wallet payment session', sessionId);
    this.assertSessionStatus(session, ['created', 'validated'], 'process');

    this.validate(!!token && typeof token === 'object', 'payment token is required');
    this.validate(!!token?.network, 'payment token network is required');
    this.validate(!!token?.cryptogram, 'payment token cryptogram is required');

    const network = token.network.toLowerCase();
    if (!session.supportedNetworks.includes(network)) {
      session.status = 'failed';
      session.failureReason = `Network ${network} is not supported by ${session.provider}`;
      session.updatedAt = new Date(this.now()).toISOString();
      this.sessions.set(session.id, session);
      this.validate(false, session.failureReason);
    }

    if (token.expiresAt) {
      const expiry = new Date(token.expiresAt).getTime();
      this.validate(!Number.isNaN(expiry), 'token expiresAt must be a valid ISO date');
      if (this.now() > expiry) {
        session.status = 'failed';
        session.failureReason = 'Payment token has expired';
        session.updatedAt = new Date(this.now()).toISOString();
        this.sessions.set(session.id, session);
        this.validate(false, session.failureReason);
      }
    }

    const processedAt = this.now();
    session.status = 'completed';
    session.completedAt = new Date(processedAt).toISOString();
    session.transactionId = `wtx_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    session.updatedAt = session.completedAt;
    this.sessions.set(session.id, session);

    return {
      sessionId: session.id,
      provider: session.provider,
      status: session.status,
      transactionId: session.transactionId,
      network,
      amount: session.amount,
      currency: session.currency,
      processedAt: session.completedAt,
    };
  }

  listSessions(filter: { merchantId?: string; provider?: WalletProvider; status?: WalletSessionStatus } = {}): WalletPaymentSession[] {
    return Array.from(this.sessions.values()).filter(
      (session) =>
        (!filter.merchantId || session.merchantId === filter.merchantId) &&
        (!filter.provider || session.provider === filter.provider) &&
        (!filter.status || session.status === filter.status),
    );
  }

  expireSession(id: string): WalletPaymentSession {
    const session = this.sessions.get(id);
    if (!session) this.notFound('Wallet payment session', id);

    session.status = 'expired';
    session.updatedAt = new Date(this.now()).toISOString();
    this.sessions.set(id, session);
    return session;
  }

  resetForTests(): void {
    this.merchants.clear();
    this.sessions.clear();
  }

  // --------------------------------------------------------------- internals

  private merchantKey(merchantId: string, provider: WalletProvider): string {
    return `${provider}:${merchantId}`;
  }

  private assertSessionStatus(
    session: WalletPaymentSession,
    allowed: WalletSessionStatus[],
    action: string,
  ): void {
    if (!allowed.includes(session.status)) {
      this.conflict(`Cannot ${action} a session in status ${session.status}`);
    }
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}

export const walletPaymentService = new WalletPaymentService();
