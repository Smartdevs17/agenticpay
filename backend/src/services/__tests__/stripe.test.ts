import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';

import { verifyStripeWebhookEvent } from '../stripe.js';

describe('verifyStripeWebhookEvent', () => {
  it('verifies with the current signing secret', () => {
    const payload = Buffer.from(JSON.stringify({ id: 'evt_current', object: 'event', type: 'payment_intent.succeeded' }));
    const stripe = new Stripe('sk_test_unit');
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_current',
    });

    expect(verifyStripeWebhookEvent(payload, signature, ['whsec_current'], stripe)).toMatchObject({ id: 'evt_current' });
  });

  it('accepts the previous secret during the overlap window', () => {
    const payload = Buffer.from(JSON.stringify({ id: 'evt_previous', object: 'event', type: 'payment_intent.succeeded' }));
    const stripe = new Stripe('sk_test_unit');
    const timestamp = Math.floor(Date.now() / 1000);
    const currentSignature = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_current', timestamp });
    const previousSignature = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_previous', timestamp });
    const [timeEntry, current] = currentSignature.split(',');
    const previous = previousSignature.split(',').at(-1);
    const signature = `${timeEntry},${current},${previous}`;

    expect(verifyStripeWebhookEvent(payload, signature, ['whsec_current', 'whsec_previous'], stripe)).toMatchObject({ id: 'evt_previous' });
  });

  it('rejects invalid signatures after checking the configured secrets', () => {
    const stripe = new Stripe('sk_test_unit');
    expect(() => verifyStripeWebhookEvent(Buffer.from('{}'), 't=1,v1=invalid', ['whsec_current', 'whsec_previous'], stripe)).toThrow('Invalid webhook signature');
  });

  it('rejects missing signing-secret configuration', () => {
    expect(() => verifyStripeWebhookEvent(Buffer.from('{}'), 't=1,v1=invalid', [], undefined)).toThrow('Stripe webhook secret not configured');
  });
});
