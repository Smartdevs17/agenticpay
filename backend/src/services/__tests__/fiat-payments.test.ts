import { beforeEach, describe, expect, it } from 'vitest';
import { fiatPaymentsService } from '../fiat-payments.js';

describe('fiatPaymentsService', () => {
  beforeEach(() => {
    fiatPaymentsService.resetForTests();
  });

  it('verifies bank accounts via plaid immediately', () => {
    const account = fiatPaymentsService.createBankAccount({
      accountHolderName: 'Alice Doe',
      bankName: 'US Bank',
      accountNumberMasked: '****1234',
      routingNumber: '021000021',
      verificationMethod: 'plaid',
      countryCode: 'US',
    });

    expect(account.status).toBe('verified');
    expect(account.verifiedAt).not.toBeNull();
  });

  it('confirms micro-deposit verification challenge', () => {
    const account = fiatPaymentsService.createBankAccount({
      accountHolderName: 'Bob Doe',
      bankName: 'Chase',
      accountNumberMasked: '****9876',
      routingNumber: '021000021',
      verificationMethod: 'micro_deposit',
      countryCode: 'US',
    });

    const challenge = fiatPaymentsService.getMicroDepositChallengeForTests(account.id);
    expect(challenge).toBeDefined();

    const verified = fiatPaymentsService.confirmMicroDeposits(account.id, challenge!);
    expect(verified?.status).toBe('verified');
  });

  it('creates high-value ACH with approval status then approves it', () => {
    const account = fiatPaymentsService.createBankAccount({
      accountHolderName: 'Enterprise',
      bankName: 'Bank of America',
      accountNumberMasked: '****1000',
      routingNumber: '021000021',
      verificationMethod: 'plaid',
      countryCode: 'US',
    });

    const payment = fiatPaymentsService.createPayment({
      method: 'ach',
      bankAccountId: account.id,
      recipient: {
        name: 'Vendor LLC',
        accountNumberMasked: '****4444',
        routingNumber: '021000021',
        bankName: 'Wells Fargo',
        countryCode: 'US',
      },
      amount: 20000,
      currency: 'USD',
      isInternational: false,
      description: 'Invoice payout',
    });

    expect(payment.status).toBe('pending_approval');

    const approved = fiatPaymentsService.approvePayment(payment.id, 'risk-manager');
    expect(approved?.status).toBe('processing');
    expect(approved?.approvedBy).toBe('risk-manager');
  });

  it('creates wire instructions and handles returned payments', () => {
    const account = fiatPaymentsService.createBankAccount({
      accountHolderName: 'Global Ops',
      bankName: 'Citi',
      accountNumberMasked: '****1111',
      routingNumber: '021000021',
      verificationMethod: 'plaid',
      countryCode: 'US',
    });

    const payment = fiatPaymentsService.createPayment({
      method: 'wire',
      bankAccountId: account.id,
      recipient: {
        name: 'Intl Supplier',
        accountNumberMasked: '****5555',
        routingNumber: '021000021',
        bankName: 'HSBC',
        countryCode: 'GB',
        swiftCode: 'HBUKGB4B',
      },
      amount: 3400,
      currency: 'USD',
      isInternational: true,
      description: 'Freelancer settlement',
    });

    expect(payment.wireInstructions).toContain('Initiate wire');

    const returned = fiatPaymentsService.handleWebhook({
      paymentId: payment.id,
      eventType: 'returned',
      reason: 'Invalid beneficiary account',
    });

    expect(returned?.status).toBe('returned');
    expect(returned?.returnReason).toBe('Invalid beneficiary account');
  });

  it('produces reconciliation report with fee totals', () => {
    const account = fiatPaymentsService.createBankAccount({
      accountHolderName: 'Ops Team',
      bankName: 'Citi',
      accountNumberMasked: '****2222',
      routingNumber: '021000021',
      verificationMethod: 'plaid',
      countryCode: 'US',
    });

    fiatPaymentsService.createPayment({
      method: 'ach',
      bankAccountId: account.id,
      recipient: {
        name: 'Supplier A',
        accountNumberMasked: '****1111',
        routingNumber: '021000021',
        bankName: 'US Bank',
        countryCode: 'US',
      },
      amount: 1000,
      currency: 'USD',
      isInternational: false,
    });

    const report = fiatPaymentsService.getReconciliationReport(
      new Date(Date.now() - 60_000).toISOString(),
      new Date(Date.now() + 60_000).toISOString()
    );

    expect(report.totals.count).toBe(1);
    expect(report.totals.fees).toBeGreaterThan(0);
    expect(report.byMethod.ach.count).toBe(1);
  });
});