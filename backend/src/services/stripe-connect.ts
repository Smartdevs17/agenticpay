import Stripe from 'stripe';
import { getStripe } from './stripe.js';
import { config } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { auditService } from './auditService.js';

export type ConnectOnboardingStatus = 'not_started' | 'onboarding' | 'completed' | 'disabled';

export interface ConnectedAccount {
  stripeAccountId: string;
  merchantId: string;
  onboardingStatus: ConnectOnboardingStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  createdAt: number;
  completedAt?: number;
}

const connectedAccounts = new Map<string, ConnectedAccount>();

export async function createConnectedAccount(merchantId: string, email: string): Promise<{ accountId: string; onboardingUrl: string }> {
  const stripe = getStripe();
  const account = await stripe.accounts.create({
    type: 'express',
    email,
    business_type: 'individual',
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
  });

  const record: ConnectedAccount = {
    stripeAccountId: account.id,
    merchantId,
    onboardingStatus: 'onboarding',
    chargesEnabled: false,
    payoutsEnabled: false,
    createdAt: Date.now(),
  };
  connectedAccounts.set(merchantId, record);

  const onboardingUrl = await createOnboardingLink(account.id);

  await auditService.logAction({ action: 'stripe_connect.account_created', resource: 'stripe_connect', resourceId: account.id, details: { merchantId } });
  return { accountId: account.id, onboardingUrl };
}

async function createOnboardingLink(accountId: string): Promise<string> {
  const stripe = getStripe();
  const cfg = config();
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${cfg.APP_URL}/dashboard/stripe/refresh`,
    return_url: `${cfg.APP_URL}/dashboard/stripe/complete`,
    type: 'account_onboarding',
  });
  return link.url;
}

export async function getOnboardingStatus(merchantId: string): Promise<ConnectedAccount | undefined> {
  return connectedAccounts.get(merchantId);
}

export async function handleConnectWebhook(event: Stripe.Event): Promise<void> {
  const stripe = getStripe();

  switch (event.type) {
    case 'account.updated': {
      const account = event.data.object as Stripe.Account;
      const merchantId = findMerchantByAccountId(account.id);
      if (merchantId) {
        const record = connectedAccounts.get(merchantId)!;
        record.chargesEnabled = account.charges_enabled;
        record.payoutsEnabled = account.payouts_enabled;
        if (account.charges_enabled && account.payouts_enabled && record.onboardingStatus !== 'completed') {
          record.onboardingStatus = 'completed';
          record.completedAt = Date.now();
        }
        connectedAccounts.set(merchantId, record);
      }
      break;
    }
  }

  await auditService.logAction({ action: 'stripe_connect.webhook_received', resource: 'stripe_connect', details: { eventType: event.type } });
}

function findMerchantByAccountId(stripeAccountId: string): string | undefined {
  for (const [merchantId, record] of connectedAccounts) {
    if (record.stripeAccountId === stripeAccountId) return merchantId;
  }
  return undefined;
}

export async function createPaymentIntentWithConnect(amount: number, currency: string, merchantStripeAccountId: string): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  return stripe.paymentIntents.create({
    amount,
    currency: currency.toLowerCase(),
    payment_method_types: ['card'],
    application_fee_amount: Math.round(amount * 0.005),
    transfer_data: { destination: merchantStripeAccountId },
  });
}

export async function createTransfer(amount: number, currency: string, destination: string): Promise<Stripe.Transfer> {
  const stripe = getStripe();
  return stripe.transfers.create({ amount, currency: currency.toLowerCase(), destination });
}

export { connectedAccounts };
