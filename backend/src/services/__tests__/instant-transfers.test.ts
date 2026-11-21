import { beforeEach, describe, expect, it } from 'vitest';
import { TransferService, DEFAULT_TRANSFER_LIMITS } from '../transfers.js';

describe('TransferService — instant account-to-account transfers (#913)', () => {
  let service: TransferService;
  let now: number;
  let usd: string;
  let eur: string;

  beforeEach(() => {
    now = new Date('2026-01-01T00:00:00.000Z').getTime();
    service = new TransferService(DEFAULT_TRANSFER_LIMITS, () => now);
    usd = service.registerAccount({ currency: 'USD', holderName: 'Ada' }).id;
    eur = service.registerAccount({ currency: 'EUR', holderName: 'Babbage' }).id;
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

  describe('accounts', () => {
    it('registers accounts as active by default', () => {
      const account = service.registerAccount({ currency: 'gbp' });
      expect(account.status).toBe('active');
      expect(account.currency).toBe('GBP');
      expect(account.id).toMatch(/^acct_/);
    });

    it('looks up a registered account', () => {
      expect(service.getAccount(usd)?.holderName).toBe('Ada');
      expect(service.getAccount('missing')).toBeUndefined();
    });
  });

  describe('quotes', () => {
    it('creates a quote that locks fee and FX rate', () => {
      const quote = service.createQuote({
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 1000,
      });

      expect(quote.fee).toBe(5); // 0.5%
      expect(quote.totalDebit).toBe(1005);
      expect(quote.fxRate).toBeCloseTo(0.92, 6);
      expect(quote.destinationAmount).toBe(920);
      expect(quote.rail).toBe('instant');
      expect(new Date(quote.expiresAt).getTime()).toBe(now + DEFAULT_TRANSFER_LIMITS.quoteTtlMs);
    });

    it('applies the minimum fee floor for small transfers', () => {
      const quote = service.createQuote({
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 20,
      });
      expect(quote.fee).toBe(0.5);
    });

    it('caps the fee for large transfers', () => {
      const quote = service.createQuote({
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 20_000,
      });
      expect(quote.fee).toBe(25);
    });

    it('rejects a zero or negative amount', () => {
      expectError(
        () => service.createQuote({ sourceAccountId: usd, destinationAccountId: eur, amount: 0 }),
        400,
        /greater than 0/,
      );
    });

    it('rejects quoting between the same account', () => {
      expectError(
        () => service.createQuote({ sourceAccountId: usd, destinationAccountId: usd, amount: 10 }),
        400,
        /must be different/,
      );
    });

    it('reports a missing destination account', () => {
      expectError(
        () => service.createQuote({ sourceAccountId: usd, destinationAccountId: 'nope', amount: 10 }),
        404,
        /Destination account not found/,
      );
    });

    it('enforces the per-transfer limit', () => {
      expectError(
        () =>
          service.createQuote({
            sourceAccountId: usd,
            destinationAccountId: eur,
            amount: DEFAULT_TRANSFER_LIMITS.perTransfer + 1,
          }),
        400,
        /per-transfer limit/,
      );
    });
  });

  describe('initiation and settlement', () => {
    it('settles an instant transfer synchronously', () => {
      const { transfer, idempotent } = service.initiateTransfer({
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 500,
        currency: 'USD',
        idempotencyKey: 'key-1',
      });

      expect(idempotent).toBe(false);
      expect(transfer.status).toBe('completed');
      expect(transfer.rail).toBe('instant');
      expect(transfer.completedAt).toBeTruthy();
      expect(transfer.destinationAmount).toBe(460);
    });

    it('accepts a quote and validates the amount against it', () => {
      const quote = service.createQuote({
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 100,
      });

      const { transfer } = service.initiateTransfer({
        quoteId: quote.id,
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 100,
        currency: 'USD',
        idempotencyKey: 'key-quote',
      });

      expect(transfer.quoteId).toBe(quote.id);
      expect(transfer.fee).toBe(quote.fee);
    });

    it('rejects a mismatched amount for a locked quote', () => {
      const quote = service.createQuote({ sourceAccountId: usd, destinationAccountId: eur, amount: 100 });
      expectError(
        () =>
          service.initiateTransfer({
            quoteId: quote.id,
            sourceAccountId: usd,
            destinationAccountId: eur,
            amount: 250,
            currency: 'USD',
            idempotencyKey: 'key-mismatch',
          }),
        400,
        /does not match the quote/,
      );
    });

    it('rejects an expired quote', () => {
      const quote = service.createQuote({ sourceAccountId: usd, destinationAccountId: eur, amount: 100 });
      now += DEFAULT_TRANSFER_LIMITS.quoteTtlMs + 1;
      expectError(
        () =>
          service.initiateTransfer({
            quoteId: quote.id,
            sourceAccountId: usd,
            destinationAccountId: eur,
            amount: 100,
            currency: 'USD',
            idempotencyKey: 'key-expired',
          }),
        400,
        /expired/,
      );
    });

    it('reports a missing quote', () => {
      expectError(
        () =>
          service.initiateTransfer({
            quoteId: 'missing',
            sourceAccountId: usd,
            destinationAccountId: eur,
            amount: 100,
            currency: 'USD',
            idempotencyKey: 'key-missing-quote',
          }),
        404,
        /Transfer quote not found/,
      );
    });

    it('is idempotent — retries return the original transfer', () => {
      const input = {
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 300,
        currency: 'USD',
        idempotencyKey: 'retry-me',
      };

      const first = service.initiateTransfer(input);
      const second = service.initiateTransfer(input);

      expect(second.idempotent).toBe(true);
      expect(second.transfer.id).toBe(first.transfer.id);
      expect(service.listTransfers().total).toBe(1);
    });

    it('requires an idempotency key', () => {
      expectError(
        () =>
          service.initiateTransfer({
            sourceAccountId: usd,
            destinationAccountId: eur,
            amount: 10,
            currency: 'USD',
            idempotencyKey: '',
          }),
        400,
        /idempotencyKey is required/,
      );
    });

    it('keeps a future-dated transfer pending', () => {
      const { transfer } = service.initiateTransfer({
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 100,
        currency: 'USD',
        idempotencyKey: 'scheduled',
        scheduledFor: new Date(now + 60_000).toISOString(),
      });

      expect(transfer.status).toBe('pending');
      expect(transfer.rail).toBe('standard');
      expect(transfer.completedAt).toBeUndefined();
    });

    it('settles a pending transfer explicitly', () => {
      const { transfer } = service.initiateTransfer({
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 100,
        currency: 'USD',
        idempotencyKey: 'settle-later',
        scheduledFor: new Date(now + 60_000).toISOString(),
      });

      const settled = service.settleTransfer(transfer.id);
      expect(settled.status).toBe('completed');
    });
  });

  describe('failure paths', () => {
    it('rejects an unknown source account', () => {
      expectError(
        () =>
          service.initiateTransfer({
            sourceAccountId: 'ghost',
            destinationAccountId: eur,
            amount: 10,
            currency: 'USD',
            idempotencyKey: 'ghost-src',
          }),
        404,
        /Source account not found/,
      );
    });

    it('rejects a frozen source account', () => {
      const frozen = service.registerAccount({ currency: 'USD', status: 'frozen' }).id;
      expectError(
        () =>
          service.initiateTransfer({
            sourceAccountId: frozen,
            destinationAccountId: eur,
            amount: 10,
            currency: 'USD',
            idempotencyKey: 'frozen-src',
          }),
        403,
        /not active/,
      );
    });

    it('enforces the rolling daily limit', () => {
      const big = service.registerAccount({ currency: 'USD' }).id;
      service.initiateTransfer({
        sourceAccountId: big,
        destinationAccountId: eur,
        amount: 25_000,
        currency: 'USD',
        idempotencyKey: 'day-1',
      });
      service.initiateTransfer({
        sourceAccountId: big,
        destinationAccountId: eur,
        amount: 25_000,
        currency: 'USD',
        idempotencyKey: 'day-2',
      });
      service.initiateTransfer({
        sourceAccountId: big,
        destinationAccountId: eur,
        amount: 25_000,
        currency: 'USD',
        idempotencyKey: 'day-3',
      });
      service.initiateTransfer({
        sourceAccountId: big,
        destinationAccountId: eur,
        amount: 25_000,
        currency: 'USD',
        idempotencyKey: 'day-4',
      });

      expect(service.getDailyVolume(big)).toBe(DEFAULT_TRANSFER_LIMITS.daily);

      expectError(
        () =>
          service.initiateTransfer({
            sourceAccountId: big,
            destinationAccountId: eur,
            amount: 25_000,
            currency: 'USD',
            idempotencyKey: 'day-5',
          }),
        400,
        /Daily transfer limit/,
      );
    });

    it('forgets volume that has aged out of the 24h window', () => {
      const account = service.registerAccount({ currency: 'USD' }).id;
      service.initiateTransfer({
        sourceAccountId: account,
        destinationAccountId: eur,
        amount: 25_000,
        currency: 'USD',
        idempotencyKey: 'aged',
      });
      expect(service.getDailyVolume(account)).toBe(25_000);

      now += 24 * 60 * 60 * 1000 + 1;
      expect(service.getDailyVolume(account)).toBe(0);
    });
  });

  describe('cancellation and reversal', () => {
    it('cancels a pending transfer', () => {
      const { transfer } = service.initiateTransfer({
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 100,
        currency: 'USD',
        idempotencyKey: 'cancel-me',
        scheduledFor: new Date(now + 60_000).toISOString(),
      });

      const cancelled = service.cancelTransfer(transfer.id);
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.cancelledAt).toBeTruthy();
    });

    it('refuses to cancel an already settled transfer', () => {
      const { transfer } = service.initiateTransfer({
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 100,
        currency: 'USD',
        idempotencyKey: 'settled',
      });

      expectError(() => service.cancelTransfer(transfer.id), 409, /cannot be cancelled/);
    });

    it('reverses a completed transfer inside the window', () => {
      const { transfer } = service.initiateTransfer({
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 100,
        currency: 'USD',
        idempotencyKey: 'reverse-me',
      });

      const reversed = service.reverseTransfer(transfer.id, 'duplicate charge');
      expect(reversed.status).toBe('reversed');
      expect(reversed.reversalReason).toBe('duplicate charge');
    });

    it('refuses to reverse outside the reversal window', () => {
      const { transfer } = service.initiateTransfer({
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 100,
        currency: 'USD',
        idempotencyKey: 'too-late',
      });

      now += DEFAULT_TRANSFER_LIMITS.reversalWindowMs + 1;
      expectError(() => service.reverseTransfer(transfer.id, 'late'), 409, /reversal window/);
    });

    it('requires a reversal reason', () => {
      const { transfer } = service.initiateTransfer({
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 100,
        currency: 'USD',
        idempotencyKey: 'no-reason',
      });
      expectError(() => service.reverseTransfer(transfer.id, ''), 400, /reason is required/);
    });

    it('refuses to reverse a non-completed transfer', () => {
      const { transfer } = service.initiateTransfer({
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 100,
        currency: 'USD',
        idempotencyKey: 'pending-rev',
        scheduledFor: new Date(now + 60_000).toISOString(),
      });
      expectError(() => service.reverseTransfer(transfer.id, 'nope'), 409, /Only completed/);
    });
  });

  describe('listing', () => {
    beforeEach(() => {
      service.initiateTransfer({
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 100,
        currency: 'USD',
        idempotencyKey: 'list-1',
      });
      service.initiateTransfer({
        sourceAccountId: usd,
        destinationAccountId: eur,
        amount: 200,
        currency: 'USD',
        idempotencyKey: 'list-2',
        scheduledFor: new Date(now + 60_000).toISOString(),
      });
    });

    it('filters by status', () => {
      expect(service.listTransfers({ status: 'completed' }).total).toBe(1);
      expect(service.listTransfers({ status: 'pending' }).total).toBe(1);
    });

    it('filters by participating account', () => {
      expect(service.listTransfers({ accountId: usd }).total).toBe(2);
      expect(service.listTransfers({ accountId: eur }).total).toBe(2);
      expect(service.listTransfers({ accountId: 'nobody' }).total).toBe(0);
    });

    it('paginates results', () => {
      const page = service.listTransfers({ limit: 1, offset: 0 });
      expect(page.transfers).toHaveLength(1);
      expect(page.total).toBe(2);
    });
  });

  it('clears state between tests via resetForTests', () => {
    service.resetForTests();
    expect(service.listTransfers().total).toBe(0);
  });
});
