# Subscription Billing with Usage Metering

Issues: [#914](https://github.com/Smartdevs17/agenticpay/issues/914),
[#812](https://github.com/Smartdevs17/agenticpay/issues/812) (proration),
[#813](https://github.com/Smartdevs17/agenticpay/issues/813) (dunning),
[#814](https://github.com/Smartdevs17/agenticpay/issues/814) (promo codes),
[#815](https://github.com/Smartdevs17/agenticpay/issues/815) (metered pricing)

Recurring plans with an included usage allowance plus metered overage billed
per billing period, with mid-cycle plan changes, promotional discounts and
dunning for failed payments.

## Backend

Service: `backend/src/services/subscription-billing.ts`
Pricing helpers: `backend/src/services/billing/` (`metered-pricing.ts`,
`proration.ts`, `discounts.ts`, `dunning.ts`)
Routes: `backend/src/routes/subscription-billing.ts` (mounted at `/api/v1/billing`)

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/plans` | Create a plan (base price, included units, overage or metered pricing) |
| `GET` | `/plans`, `/plans/:id` | List / read plans |
| `POST` | `/subscriptions` | Subscribe a customer to a plan (optional trial and `promoCode`) |
| `GET` | `/subscriptions` | List subscriptions (`merchantId`, `customerId`, `status`) |
| `GET` | `/subscriptions/:id` | Read a subscription |
| `POST` | `/subscriptions/:id/cancel` | Cancel now or at period end |
| `GET` | `/subscriptions/:id/change-plan/preview?planId=` | Quote the proration for a plan change |
| `POST` | `/subscriptions/:id/change-plan` | Change plan (`planId`, `prorationBehavior`) |
| `POST` | `/subscriptions/:id/discount` | Redeem a promo code on a subscription |
| `DELETE` | `/subscriptions/:id/discount` | Remove the subscription's discount |
| `POST` | `/usage` | Record a metered usage event |
| `GET` | `/subscriptions/:id/usage` | Usage summary (units, overage, amount, per-meter breakdown) |
| `GET` | `/subscriptions/:id/usage-events` | Raw usage events |
| `POST` | `/subscriptions/:id/invoices` | Generate an invoice for the period |
| `POST` | `/subscriptions/:id/close-period` | Invoice, roll the period, reset usage |
| `GET` | `/invoices`, `/invoices/:id` | List / read invoices |
| `POST` | `/invoices/:id/pay`, `/invoices/:id/void` | Invoice lifecycle |
| `POST` | `/invoices/:id/payment-attempts` | Record a collection attempt (`success`, `failureReason`) |
| `POST` | `/promo-codes` | Create a promo code |
| `GET` | `/promo-codes`, `/promo-codes/:code` | List (`merchantId`, `active`) / read promo codes |
| `POST` | `/promo-codes/validate` | Check a code for a customer and plan without redeeming it |
| `POST` | `/promo-codes/:code/deactivate` | Stop a code from being redeemed |
| `GET`/`PUT` | `/dunning/config/:merchantId` | Read / set a merchant's retry schedule |
| `GET` | `/dunning/invoices` | Invoices in dunning (`merchantId`, `status`) |
| `POST` | `/dunning/process` | Retry every invoice whose next retry is due |

### Pricing

- The plan's `includedUnits` are free; units beyond that are billed as overage.
- **Flat** overage charges `overageUnitPrice` per unit.
- **Graduated** plans define `tiers` (`{ upTo, unitPrice }`) that are applied
  progressively; usage past the last tier falls back to `overageUnitPrice`.
- Monthly periods are 30 days, annual periods 365.

### Metered pricing (#815)

A plan can instead attach `meters`, one per metric. When a plan has meters,
each metric is priced on its own and usage for any other metric is rejected.

```json
{
  "name": "Usage",
  "basePrice": 0,
  "meters": [
    { "metric": "api_calls", "model": "per_unit", "includedUnits": 1000, "unitPrice": 0.002 },
    { "metric": "seats", "aggregation": "max", "model": "per_unit", "unitPrice": 10 },
    { "metric": "exports", "model": "package", "packageSize": 100, "packagePrice": 5 },
    {
      "metric": "storage_gb",
      "aggregation": "last",
      "model": "volume",
      "tiers": [{ "upTo": 100, "unitPrice": 0.5 }, { "upTo": null, "unitPrice": 0.25 }]
    }
  ]
}
```

- **Aggregation** decides the period quantity: `sum` (default) adds every
  event, `max` takes the peak (e.g. seats), `last` takes the latest reading
  (e.g. storage).
- **Models**: `per_unit`; `package` (bundles of `packageSize`, rounded up);
  `graduated` (each tier prices the units inside it); `volume` (the tier
  reached prices every unit). Tiers can add a `flatFee`, and the last tier
  must be open-ended (`upTo: null`).
- `includedUnits` is subtracted before pricing, and tier boundaries count
  billable units after the allowance.
- Invoices get one `Metered usage — <metric>` line per meter with a charge.

### Idempotency

Supplying an `idempotencyKey` when recording usage makes retries safe — the
same key returns the original event and is not double-counted.

## Plan changes and proration (#812)

Invoices are raised in arrears, when a period closes. A mid-cycle plan change
splits the period into plan segments, and each plan is charged for the share
of the period it was active. The preview endpoint (and the `proration` field
of a change) gives the same result as a credit for unused time on the old plan
(`unusedCredit`) and a charge for the rest of the period on the new plan
(`remainingCharge`); `net` is the difference.

`prorationBehavior`:

| Value | Effect |
| --- | --- |
| `create_prorations` (default) | The closing invoice carries prorated base lines for each plan. |
| `always_invoice` | The old plan's elapsed time and its metered usage are invoiced now (`kind: "plan_change"`); the rest of the period is billed on the new plan. |
| `none` | No proration: the whole period is billed on the new plan. |

- Changing the billing interval (monthly ↔ annual) always invoices the elapsed
  time straight away and starts a new period on the new plan. `none` is
  rejected for interval changes.
- During a trial the plan is switched without proration.
- Plans must share a currency, and a cancelled subscription cannot change plan.
- With `create_prorations`, metered usage is priced by the plan active when the
  invoice is raised. Use `always_invoice` to bill usage so far at the old
  plan's rates.

## Promotional codes (#814)

```json
{
  "code": "LAUNCH20",
  "discountType": "percent",
  "percentOff": 20,
  "duration": "repeating",
  "durationInPeriods": 3,
  "maxRedemptions": 100,
  "appliesToPlanIds": ["plan_pro"],
  "expiresAt": "2026-12-31T23:59:59.000Z"
}
```

- `discountType` is `percent` (`percentOff`, 0–100) or `fixed` (`amountOff` in
  `currency`, which must match the plan's currency).
- `duration`: `once` (first billing period), `repeating` (`durationInPeriods`
  periods) or `forever`.
- Optional limits: `merchantId`, `appliesToPlanIds`, `startsAt`/`expiresAt`,
  `maxRedemptions` (total), `perCustomerLimit` (default 1) and `minimumAmount`
  (minimum plan base price).
- Codes are case-insensitive and unique. Redeem one with `promoCode` when
  subscribing or later via `POST /subscriptions/:id/discount`. A subscription
  holds one discount at a time.
- The discount applies to the invoice subtotal (base + usage), appears as a
  negative `Discount — <CODE>` line, is capped at the subtotal, and is recorded
  on the invoice as `discountAmount` / `discountCode`.

## Dunning (#813)

When a payment attempt fails (`POST /invoices/:id/payment-attempts` with
`success: false`) the invoice enters dunning and the subscription becomes
`past_due`. Usage can still be metered while the subscription is past due.

- Retries follow the merchant's `retryScheduleDays`, day offsets from the first
  failure (default `[1, 3, 5, 7]`; at most 10 retries within 60 days). The
  schedule is copied onto the invoice when dunning starts, so later config
  changes don't affect it.
- `POST /dunning/process` retries every invoice whose `nextRetryAt` has passed,
  using the payment attempter registered with
  `subscriptionBillingService.setPaymentAttempter()`. An attempter that throws
  counts as a failed retry.
- A successful retry, or a manual `pay`, marks the invoice paid and dunning
  `recovered`. Voiding the invoice sets dunning to `stopped`. Once no invoice
  is still in dunning, the subscription returns to `active`.
- When every retry fails, dunning is `exhausted`, the invoice becomes
  `uncollectible`, and the merchant's `finalAction` runs:
  `cancel_subscription` (default) or `mark_uncollectible` (the subscription
  stays `past_due`). An uncollectible invoice can still be paid later.
- `invoice.dunning.history` records each attempt with its outcome and failure
  reason.

## Tests

- `backend/src/services/__tests__/subscription-billing.test.ts`
- `backend/src/services/__tests__/subscription-billing-lifecycle.test.ts`
- `backend/src/services/billing/__tests__/*.test.ts`
