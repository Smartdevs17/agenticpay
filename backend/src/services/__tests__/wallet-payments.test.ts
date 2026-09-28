import { beforeEach, describe, expect, it } from 'vitest';
import { WalletPaymentService } from '../wallet-payments.js';

describe('WalletPaymentService — Apple Pay / Google Pay checkout (#916)', () => {
  let service: WalletPaymentService;
  let now: number;
  let sessionId: string;

  beforeEach(() => {
    now = new Date('2026-04-01T00:00:00.000Z').getTime();
    service = new WalletPaymentService(() => now);
  });

  const expectError = (fn: () => unknown, statusCode: number, message?: RegExp) => {
    try {
      fn();
      throw new Error('Expected function to throw');
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      expect(error.statusCode).toBe(statusCode);
      if (message) expect(error.message).toMatch(message);
    }
  };

  /** Register an Apple Pay merchant with one verified domain and open a session. */
  const readySession = (provider: 'apple_pay' | 'google_pay' = 'apple_pay') => {
    service.registerMerchant({
      merchantId: 'm_1',
      provider,
      displayName: 'Acme Store',
      merchantIdentifier: 'merchant.com.acme',
    });
    const domain = service.registerDomain('m_1', provider, 'shop.acme.com');
    service.verifyDomain('m_1', provider, 'shop.acme.com', domain.verificationToken);
    return service.createPaymentSession({ merchantId: 'm_1', provider, amount: 42.5, currency: 'usd' });
  };

  describe('merchant registration', () => {
    it('registers an Apple Pay merchant with provider networks', () => {
      const merchant = service.registerMerchant({
        merchantId: 'm_1',
        provider: 'apple_pay',
        displayName: 'Acme',
        merchantIdentifier: 'merchant.com.acme',
      });

      expect(merchant.merchantIdentifier).toBe('merchant.com.acme');
      expect(merchant.countryCode).toBe('US');
      expect(merchant.supportedNetworks).toContain('visa');
    });

    it('requires a merchant identifier for Apple Pay', () => {
      expectError(
        () => service.registerMerchant({ merchantId: 'm_1', provider: 'apple_pay', displayName: 'Acme' }),
        400,
        /merchantIdentifier is required/,
      );
    });

    it('defaults a Google Pay merchant identifier', () => {
      const merchant = service.registerMerchant({ merchantId: 'g_1', provider: 'google_pay', displayName: 'Acme' });
      expect(merchant.merchantIdentifier).toBe('google.g_1');
    });

    it('rejects an invalid country code', () => {
      expectError(
        () =>
          service.registerMerchant({
            merchantId: 'm_1',
            provider: 'apple_pay',
            displayName: 'Acme',
            merchantIdentifier: 'merchant.com.acme',
            countryCode: 'USA',
          }),
        400,
        /2-letter ISO code/,
      );
    });

    it('exposes supported networks per provider', () => {
      expect(service.getSupportedNetworks('google_pay')).toContain('jcb');
      expect(service.getSupportedNetworks('apple_pay')).not.toContain('jcb');
    });
  });

  describe('domain verification', () => {
    it('registers an unverified domain and verifies it with the token', () => {
      service.registerMerchant({ merchantId: 'm_1', provider: 'apple_pay', displayName: 'Acme', merchantIdentifier: 'm.acme' });

      const registration = service.registerDomain('m_1', 'apple_pay', 'Shop.Acme.com');
      expect(registration.domain).toBe('shop.acme.com');
      expect(registration.verified).toBe(false);

      const verified = service.verifyDomain('m_1', 'apple_pay', 'shop.acme.com', registration.verificationToken);
      expect(verified.verified).toBe(true);
      expect(verified.verifiedAt).toBeTruthy();
    });

    it('rejects an invalid hostname', () => {
      service.registerMerchant({ merchantId: 'm_1', provider: 'apple_pay', displayName: 'Acme', merchantIdentifier: 'm.acme' });
      expectError(() => service.registerDomain('m_1', 'apple_pay', 'not a domain'), 400, /valid hostname/);
    });

    it('rejects duplicate domains', () => {
      service.registerMerchant({ merchantId: 'm_1', provider: 'apple_pay', displayName: 'Acme', merchantIdentifier: 'm.acme' });
      service.registerDomain('m_1', 'apple_pay', 'shop.acme.com');
      expectError(() => service.registerDomain('m_1', 'apple_pay', 'shop.acme.com'), 409, /already registered/);
    });

    it('rejects a mismatched verification token', () => {
      service.registerMerchant({ merchantId: 'm_1', provider: 'apple_pay', displayName: 'Acme', merchantIdentifier: 'm.acme' });
      service.registerDomain('m_1', 'apple_pay', 'shop.acme.com');
      expectError(() => service.verifyDomain('m_1', 'apple_pay', 'shop.acme.com', 'wrong'), 400, /does not match/);
    });

    it('reports missing merchants and domains', () => {
      expectError(() => service.registerDomain('ghost', 'apple_pay', 'shop.acme.com'), 404, /merchant not found/i);
      service.registerMerchant({ merchantId: 'm_1', provider: 'apple_pay', displayName: 'Acme', merchantIdentifier: 'm.acme' });
      expectError(() => service.verifyDomain('m_1', 'apple_pay', 'nope.com', 'token'), 404, /Domain registration not found/);
    });
  });

  describe('payment sessions', () => {
    it('creates a session for a verified merchant', () => {
      const session = readySession();
      expect(session.status).toBe('created');
      expect(session.amount).toBe(42.5);
      expect(session.currency).toBe('USD');
      expect(session.supportedNetworks).toContain('visa');
      sessionId = session.id;
    });

    it('refuses sessions without a verified domain', () => {
      service.registerMerchant({ merchantId: 'm_1', provider: 'apple_pay', displayName: 'Acme', merchantIdentifier: 'm.acme' });
      expectError(
        () => service.createPaymentSession({ merchantId: 'm_1', provider: 'apple_pay', amount: 10 }),
        400,
        /verified domain/,
      );
    });

    it('reports an unregistered merchant', () => {
      expectError(
        () => service.createPaymentSession({ merchantId: 'nope', provider: 'apple_pay', amount: 10 }),
        404,
        /merchant not found/i,
      );
    });

    it('rejects a non-positive amount', () => {
      expectError(
        () => service.createPaymentSession({ merchantId: 'm_1', provider: 'apple_pay', amount: 0 }),
        400,
        /greater than 0/,
      );
    });

    it('expires stale sessions on read', () => {
      const session = readySession();
      now += 31 * 60 * 1000;
      expect(service.getSession(session.id)?.status).toBe('expired');
    });

    it('filters sessions', () => {
      const session = readySession();
      expect(service.listSessions({ merchantId: 'm_1' })).toHaveLength(1);
      expect(service.listSessions({ provider: 'apple_pay' })).toHaveLength(1);
      expect(service.listSessions({ status: 'completed' })).toHaveLength(0);

      service.validateMerchant(session.id);
      expect(service.listSessions({ status: 'validated' })).toHaveLength(1);
    });
  });

  describe('merchant validation and token processing', () => {
    beforeEach(() => {
      sessionId = readySession().id;
    });

    it('returns a merchant session during validation', () => {
      const { session, merchantSession } = service.validateMerchant(sessionId);
      expect(session.status).toBe('validated');
      expect(merchantSession.merchantSessionIdentifier).toMatch(/^msi_/);
      expect(merchantSession.displayName).toBe('Acme Store');
      expect(merchantSession.domainName).toBe('shop.acme.com');
    });

    it('cannot validate a session twice', () => {
      service.validateMerchant(sessionId);
      expectError(() => service.validateMerchant(sessionId), 409, /Cannot validate/);
    });

    it('settles a payment with a valid token (even before validation for Google Pay)', () => {
      const result = service.processPaymentToken(sessionId, {
        network: 'visa',
        cryptogram: 'encrypted-payload',
        displayName: 'Acme Card',
      });

      expect(result.status).toBe('completed');
      expect(result.transactionId).toMatch(/^wtx_/);
      expect(result.network).toBe('visa');
      expect(service.getSession(sessionId)?.status).toBe('completed');
    });

    it('processes a token after merchant validation', () => {
      service.validateMerchant(sessionId);
      const result = service.processPaymentToken(sessionId, { network: 'MASTERCARD', cryptogram: 'abc' });
      expect(result.network).toBe('mastercard');
    });

    it('requires a cryptogram', () => {
      expectError(
        () => service.processPaymentToken(sessionId, { network: 'visa', cryptogram: '' }),
        400,
        /cryptogram is required/,
      );
    });

    it('rejects an unsupported network and marks the session failed', () => {
      expectError(
        () => service.processPaymentToken(sessionId, { network: 'jcb', cryptogram: 'abc' }),
        400,
        /not supported/,
      );
      expect(service.getSession(sessionId)?.status).toBe('failed');
    });

    it('rejects an expired payment token', () => {
      expectError(
        () =>
          service.processPaymentToken(sessionId, {
            network: 'visa',
            cryptogram: 'abc',
            expiresAt: new Date(now - 1000).toISOString(),
          }),
        400,
        /token has expired/,
      );
    });

    it('cannot process an already completed session', () => {
      service.processPaymentToken(sessionId, { network: 'visa', cryptogram: 'abc' });
      expectError(
        () => service.processPaymentToken(sessionId, { network: 'visa', cryptogram: 'abc' }),
        409,
        /Cannot process/,
      );
    });

    it('reports an unknown session', () => {
      expectError(() => service.processPaymentToken('ghost', { network: 'visa', cryptogram: 'a' }), 404, /session not found/i);
    });
  });

  describe('Google Pay checkout', () => {
    it('supports the full Google Pay flow', () => {
      const session = readySession('google_pay');
      expect(session.provider).toBe('google_pay');

      service.validateMerchant(session.id);
      const result = service.processPaymentToken(session.id, { network: 'jcb', cryptogram: 'gp-token' });

      expect(result.provider).toBe('google_pay');
      expect(result.status).toBe('completed');
    });
  });

  it('clears state between tests', () => {
    readySession();
    service.resetForTests();
    expect(service.listSessions()).toHaveLength(0);
  });
});
