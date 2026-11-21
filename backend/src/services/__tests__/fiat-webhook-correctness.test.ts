import { beforeEach, describe, expect, it } from 'vitest';
import { fiatPaymentsService } from '../fiat-payments.js';

describe('fiat payment webhook correctness (#1174)', () => {
  beforeEach(() => fiatPaymentsService.resetForTests());

  function makePayment(amount = 100) {
    const account = fiatPaymentsService.createBankAccount({
      accountHolderName: 'Test', bankName: 'Test Bank',
      accountNumberMasked: '****1111', routingNumber: '021000021',
      verificationMethod: 'plaid', countryCode: 'US',
    });
    return fiatPaymentsService.createPayment({
      method: 'ach', bankAccountId: account.id,
      recipient: { name: 'Payee', accountNumberMasked: '****2222',
        routingNumber: '021000021', bankName: 'Bank', countryCode: 'US' },
      amount, currency: 'USD', isInternational: false,
    });
  }

  it('prevents settlement from bypassing approval', () => {
    const payment = makePayment(20000);
    expect(payment.status).toBe('pending_approval');
    expect(() => fiatPaymentsService.handleWebhook({ paymentId: payment.id, eventType: 'settled' }))
      .toThrow('INVALID_PAYMENT_STATUS_TRANSITION');
    expect(fiatPaymentsService.getPayment(payment.id)?.status).toBe('pending_approval');
  });

  it('deduplicates settlement and rejects stale processing notifications', () => {
    const payment = makePayment();
    fiatPaymentsService.handleWebhook({ paymentId: payment.id, eventType: 'settled' });
    const count = fiatPaymentsService.getPaymentEvents(payment.id).length;
    fiatPaymentsService.handleWebhook({ paymentId: payment.id, eventType: 'settled' });
    expect(fiatPaymentsService.getPaymentEvents(payment.id)).toHaveLength(count);
    expect(() => fiatPaymentsService.handleWebhook({ paymentId: payment.id, eventType: 'processing' }))
      .toThrow('INVALID_PAYMENT_STATUS_TRANSITION');
    expect(fiatPaymentsService.getPayment(payment.id)?.status).toBe('settled');
  });

  it('allows a bank return after settlement', () => {
    const payment = makePayment();
    fiatPaymentsService.handleWebhook({ paymentId: payment.id, eventType: 'settled' });
    const returned = fiatPaymentsService.handleWebhook({
      paymentId: payment.id, eventType: 'returned', reason: 'Bank return',
    });
    expect(returned?.status).toBe('returned');
    expect(returned?.returnReason).toBe('Bank return');
  });
});
