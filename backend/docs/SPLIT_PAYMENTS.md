# Split Payments (Issue #917)

Split a single payment across a platform fee and one or more recipients, with
an allocation that reconciles to the payment exactly.

## Concepts

| Concept | Description |
|---------|-------------|
| **Split plan** | A reusable recipe: a set of recipients and a platform fee for a merchant. |
| **Recipient** | `recipientId` + `walletAddress` + a `percentage` share (optionally a `minimumAmount`). |
| **Basis points** | Percentages are normalised to integer basis points (`shareBps`, 1 bp = 0.01%) before any money maths. |
| **Execution** | Applying a plan to a concrete `paymentId` + `totalAmount`, producing per-recipient distributions. |

Plan states: `active` and `archived` (archived plans cannot be executed).

## Rounding guarantee

Percentages must sum to **exactly 100** (the platform fee counts toward that
total). Allocation runs on integer minor units with the largest-remainder
(Hamilton) method, so:

```
platformFeeMinor + Σ share.amountMinor === totalMinor
unallocatedMinor === 0
```

No money is created or lost to rounding, even for amounts like `33.33 / 33.33 /
33.34` or one-cent splits across many recipients.

```
$100, 2.5% fee, recipients 65% / 32.5%
→ fee 2.50 + 65.00 + 32.50 = 100.00
```

## Validation

`validateSplitPlan` rejects requests before anything is persisted:

- missing `tenantId`, empty recipient list, or more than `maxRecipients` (25)
- duplicate or missing `recipientId`, missing `walletAddress`
- a `percentage` outside `(0, 100]`, or a negative `minimumAmount`
- percentages + platform fee that do not sum to exactly 100
- an unsupported currency (`USD`, `EUR`, `GBP`, `XLM`, `USDC`)

## Minimum amounts

A recipient whose allocated amount is below `minimumAmount` is marked
`skipped: true` with a reason, so the caller can hold or reroute that share.

## REST API

Mounted at `/api/v1/split-payments`.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/plans` | Create a split plan. |
| `GET` | `/plans?tenantId=&status=&merchantId=` | List plans. |
| `GET` | `/plans/:id?tenantId=` | Fetch a plan. |
| `POST` | `/plans/:id/archive?tenantId=` | Archive a plan. |
| `POST` | `/plans/:id/execute` | Execute a payment against the plan. |
| `GET` | `/plans/:id/executions?tenantId=` | List executions. |
| `GET` | `/plans/:id/summary?tenantId=` | Execution summary (processed, fees, skips). |
| `GET` | `/plans/:id/preview?tenantId=&totalAmount=` | Preview a split without executing. |

### Create a plan

```bash
curl -X POST http://localhost:3000/api/v1/split-payments/plans \
  -H 'Content-Type: application/json' \
  -d '{
    "tenantId": "tenant-1",
    "currency": "USD",
    "platformFeePercentage": 2.5,
    "recipients": [
      { "recipientId": "creator", "walletAddress": "GA...", "percentage": 65 },
      { "recipientId": "affiliate", "walletAddress": "GB...", "percentage": 32.5 }
    ]
  }'
```

### Execute a payment

```bash
curl -X POST http://localhost:3000/api/v1/split-payments/plans/<planId>/execute \
  -H 'Content-Type: application/json' \
  -d '{ "tenantId": "tenant-1", "paymentId": "pay_123", "totalAmount": 199.99 }'
```

Each execution returns the exact per-recipient `distributions` and the
`platformFeeAmount`; their sum equals `totalAmount`.

## Events

`SplitPaymentService` publishes through the injectable `SplitEventPublisher`:

- `split_plan.created`
- `split_plan.archived`
- `split.executed`

## Persistence

The service depends on `SplitPlanRepository` / `SplitExecutionRepository`;
`InMemorySplitStore` backs both for tests and local development. Implement the
same interfaces with Prisma (`split_plans`, `split_executions`) for production.

> Note: the legacy `/api/v1/splits` endpoints expose a percentage-of-total model
> and remain unchanged. This module is the exact-allocation engine for #917.
