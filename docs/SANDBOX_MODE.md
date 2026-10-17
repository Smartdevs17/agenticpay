# Sandbox Mode

AgenticPay supports a uniform sandbox mode across all payment gateways. Sandbox mode lets you test the full payment flow without moving real funds.

## Enabling Sandbox Mode

Sandbox mode is **opt-in per API key**. Set the `sandbox` flag when creating an API key:

```json
POST /api/keys
{
  "name": "test-key",
  "sandbox": true
}
```

When `sandbox: true`:
- All payment requests are routed to the gateway's sandbox/test environment
- No real funds are moved
- Webhooks are simulated or delivered from the sandbox
- Transaction records are tagged with `sandbox: true`

## Per-Gateway Sandbox Behavior

| Gateway | Sandbox Endpoint | Test Cards | Webhooks |
|---|---|---|---|
| Stripe | `https://api.stripe.com` (test mode key) | `4242 4242 4242 4242` | Real webhook delivery |
| PayPal | `https://api-m.sandbox.paypal.com` | Sandbox buyer accounts | Real webhook delivery |
| Custom | Configured `SANDBOX_BASE_URL` | Depends on provider | Manual or simulated |

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `SANDBOX_MODE` | Global sandbox override (for CI) | `false` |
| `SANDBOX_WEBHOOK_SECRET` | Secret for simulated webhooks | Random per boot |

## Limitations

- **No real payouts**: Sandbox transactions are never settled to real bank accounts
- **Simulated timing**: Some providers have different timing in sandbox (instant confirmations, etc.)
- **Limited error simulation**: Not all error paths can be triggered in sandbox
- **Data isolation**: Sandbox data is stored separately and can be cleared via `POST /api/sandbox/reset`
- **Rate limits**: Sandbox APIs may have different (often higher) rate limits than production

## Testing Checklist

- [ ] Create a sandbox API key
- [ ] Process a test payment with a test card
- [ ] Verify webhook delivery and processing
- [ ] Test a refund flow
- [ ] Confirm no real funds were moved
- [ ] Test error handling (declined card, expired card)
- [ ] Verify sandbox data is isolated from production

## Switching to Production

1. Create a new API key with `sandbox: false`
2. Use production API keys from the gateway provider
3. Update webhook endpoints to production URLs
4. Run a small real-amount test before full launch
