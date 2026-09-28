# Subscription Billing with Usage Metering

Issue: [#914](https://github.com/Smartdevs17/agenticpay/issues/914)

Recurring plans with an included usage allowance plus metered overage billed
per billing period.

## Backend

Service: `backend/src/services/subscription-billing.ts`
Routes: `backend/src/routes/subscription-billing.ts` (mounted at `/api/v1/billing`)

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/plans` | Create a plan (base price, included units, overage pricing) |
| `GET` | `/plans`, `/plans/:id` | List / read plans |
| `POST` | `/subscriptions` | Subscribe a customer to a plan (optional trial) |
| `GET` | `/subscriptions` | List subscriptions (`merchantId`, `customerId`, `status`) |
| `GET` | `/subscriptions/:id` | Read a subscription |
| `POST` | `/subscriptions/:id/cancel` | Cancel now or at period end |
| `POST` | `/usage` | Record a metered usage event |
| `GET` | `/subscriptions/:id/usage` | Usage summary (units, overage, amount) |
| `GET` | `/subscriptions/:id/usage-events` | Raw usage events |
| `POST` | `/subscriptions/:id/invoices` | Generate an invoice for the period |
| `POST` | `/subscriptions/:id/close-period` | Invoice, roll the period, reset usage |
| `GET` | `/invoices`, `/invoices/:id` | List / read invoices |
| `POST` | `/invoices/:id/pay`, `/invoices/:id/void` | Invoice lifecycle |

### Pricing

- The plan's `includedUnits` are free; units beyond that are billed as overage.
- **Flat** overage charges `overageUnitPrice` per unit.
- **Graduated** plans define `tiers` (`{ upTo, unitPrice }`) that are applied
  progressively; usage past the last tier falls back to `overageUnitPrice`.
- Monthly periods are 30 days, annual periods 365.

### Idempotency

Supplying an `idempotencyKey` when recording usage makes retries safe — the
same key returns the original event and is not double-counted.

## Tests

`backend/src/services/__tests__/subscription-billing.test.ts`
