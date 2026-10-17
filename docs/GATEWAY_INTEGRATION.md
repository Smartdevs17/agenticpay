# Gateway Integration Guide

This guide walks through adding a new payment gateway to AgenticPay.

## Integration Checklist

### 1. Implement the Gateway Adapter

Create a new file in `backend/src/integrations/` implementing the `GatewayAdapter` interface:

```typescript
import type { GatewayAdapter, PaymentRequest, PaymentResult } from './gateway-adapter';

export class MyGatewayAdapter implements GatewayAdapter {
  readonly name = 'my-gateway';

  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    // 1. Validate the request
    // 2. Call the provider API
    // 3. Return a normalized PaymentResult
  }

  async getPaymentStatus(externalId: string): Promise<PaymentResult> {
    // Query the provider for current status
  }

  async refund(externalId: string, amount?: number): Promise<PaymentResult> {
    // Process a full or partial refund
  }
}
```

### 2. Register the Adapter

Add your adapter to the gateway registry in `backend/src/integrations/gateway-adapter.ts`:

```typescript
import { MyGatewayAdapter } from './my-gateway.js';

export const gateways = {
  stripe: new StripeAdapter(),
  paypal: new PaypalAdapter(),
  'my-gateway': new MyGatewayAdapter(),
};
```

### 3. Handle Webhooks

Create a webhook verifier in `backend/src/services/webhooks/providers.ts`:

```typescript
export function verifyMyGatewayWebhook(
  req: Request,
  rawBody: string
): ProviderVerificationResult {
  // 1. Extract the signature from headers
  // 2. Verify HMAC/signature against the raw body
  // 3. Return { isValid, eventId, payload, error? }
}
```

Register it in `webhookVerification.ts`:

```typescript
const providerVerifiers: Record<WebhookProvider, ProviderVerifier> = {
  stripe: verifyStripeProviderWebhook,
  paypal: verifyPaypalProviderWebhook,
  github: verifyGithubProviderWebhook,
  custom: verifyCustomProviderWebhook,
  'my-gateway': verifyMyGatewayWebhook,
};
```

### 4. Environment Variables

Add required secrets to `ENV_VARS.md` and the deployment configuration:

| Variable | Description | Required |
|---|---|---|
| `MYGATEWAY_API_KEY` | API key for the gateway | Yes |
| `MYGATEWAY_WEBHOOK_SECRET` | Webhook signing secret | Yes |
| `MYGATEWAY_BASE_URL` | API base URL (sandbox vs production) | No |

### 5. Test Strategy

#### Unit Tests
- [ ] Adapter `createPayment` with valid/invalid requests
- [ ] Adapter `getPaymentStatus` for all status values
- [ ] Webhook signature verification (valid, invalid, missing)
- [ ] Webhook deduplication (same event ID twice)

#### Integration Tests
- [ ] End-to-end payment flow (create → confirm → refund)
- [ ] Webhook processing pipeline (receive → verify → process → respond)
- [ ] Error handling (provider timeout, rate limit, auth failure)

#### Sandbox Testing
- [ ] Test all payment methods in the provider's sandbox
- [ ] Verify webhook delivery and signature verification
- [ ] Test edge cases: expired cards, insufficient funds, network errors

### 6. Documentation

- [ ] Add gateway to `README.md` supported gateways table
- [ ] Document provider-specific quirks in `backend/docs/`
- [ ] Add sandbox setup instructions

## Interface Reference

See `backend/src/integrations/gateway-adapter.ts` for the full `GatewayAdapter` interface and `backend/src/services/webhooks/providers.ts` for the `ProviderVerificationResult` type.

## Security Considerations

- Never log API keys or webhook secrets
- Always verify webhook signatures before processing
- Use idempotency keys for payment creation
- Validate all amounts and currency codes server-side
- Rate-limit webhook endpoints per provider
