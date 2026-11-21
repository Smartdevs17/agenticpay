import { beforeEach, describe, expect, it, vi } from 'vitest';

const stripeMock = vi.hoisted(() => ({
  accounts: { create: vi.fn() },
  accountLinks: { create: vi.fn() },
  paymentIntents: { create: vi.fn() },
  transfers: { create: vi.fn() },
}));

vi.mock('../stripe.js', () => ({ getStripe: () => stripeMock }));
vi.mock('../auditService.js', () => ({ auditService: { logAction: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../config/env.js', () => ({ config: () => ({ APP_URL: 'https://app.example.com' }) }));

import {
  connectedAccounts,
  createConnectedAccount,
  createPaymentIntentWithConnect,
  createTransfer,
  handleConnectWebhook,
} from '../stripe-connect.js';

describe('stripe-connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectedAccounts.clear();
  });

  it('does not track a merchant when the onboarding link fails', async () => {
    stripeMock.accounts.create.mockResolvedValue({ id: 'acct_1' });
    stripeMock.accountLinks.create.mockRejectedValue(new Error('stripe down'));

    await expect(createConnectedAccount('merch_1', 'owner@example.com')).rejects.toThrow('stripe down');
    expect(connectedAccounts.has('merch_1')).toBe(false);
  });

  it('tracks the merchant once onboarding succeeds', async () => {
    stripeMock.accounts.create.mockResolvedValue({ id: 'acct_2' });
    stripeMock.accountLinks.create.mockResolvedValue({ url: 'https://connect.stripe.com/setup' });

    const result = await createConnectedAccount('merch_2', 'owner@example.com');
    expect(result).toEqual({ accountId: 'acct_2', onboardingUrl: 'https://connect.stripe.com/setup' });
    expect(connectedAccounts.get('merch_2')?.onboardingStatus).toBe('onboarding');
  });

  it('ignores account.updated webhooks for unknown accounts', async () => {
    await expect(
      handleConnectWebhook({ type: 'account.updated', data: { object: { id: 'acct_unknown' } } } as never)
    ).resolves.toBeUndefined();
  });

  it.each([0, -100, 10.5, Number.NaN])('rejects non-minor-unit amount %s for payment intents', async (amount) => {
    await expect(createPaymentIntentWithConnect(amount, 'usd', 'acct_1')).rejects.toThrow(
      'Amount must be a positive integer in minor units'
    );
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('rejects non-minor-unit amounts for transfers', async () => {
    await expect(createTransfer(0, 'usd', 'acct_1')).rejects.toThrow('Amount must be a positive integer in minor units');
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it('creates a payment intent with a 0.5% application fee for valid amounts', async () => {
    stripeMock.paymentIntents.create.mockResolvedValue({ id: 'pi_1' });

    await createPaymentIntentWithConnect(10_000, 'USD', 'acct_1');
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 10_000, currency: 'usd', application_fee_amount: 50 })
    );
  });
});
