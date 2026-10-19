# BNPL Installment Plans (Issue #919)

Buy-Now-Pay-Later financing for checkout orders. A plan splits an order
principal into a deterministic schedule of installments that are collected
one at a time.

## Concepts

| Concept | Description |
|---------|-------------|
| **Principal** | The full order value. |
| **Down payment** | Amount paid up front. Not financed, never part of the schedule. |
| **Financed amount** | `principal - downPayment`. The sum of every installment. |
| **Installment** | One scheduled collection (`amount`, `dueAt`, `status`). |
| **Frequency** | `weekly` (7 days), `biweekly` (14 days), or `monthly` (calendar month, day-of-month clamped). |

Installment statuses: `scheduled → due → paid`, plus `failed` (retryable) and
`cancelled` (voided with the plan). Plan statuses: `active`, `completed`,
`cancelled`, `defaulted`.

## Rounding guarantee

Amounts are computed in `planner.ts`. Each installment receives the floored
2-decimal share and the **final** installment absorbs the remainder, so the
schedule always reconciles back to the financed amount. `createPlan` asserts
this invariant and refuses to persist a plan that does not balance.

```
$100 financed over 3 installments → 33.33 + 33.33 + 33.34 = 100.00
```

## Limits (`DEFAULT_BNPL_CONFIG`)

| Setting | Value |
|---------|-------|
| Installments per plan | 2–12 |
| Financed amount | 10–100,000 |
| Currencies | `USD`, `EUR`, `GBP`, `XLM`, `USDC` |
| Frequencies | `weekly`, `biweekly`, `monthly` (default `monthly`) |

Override these by constructing `new BNPLInstallmentService({ config })`.

## REST API

All routes are mounted under `/api/v1/installments`.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/plans` | Create a plan and materialise its schedule. |
| `GET` | `/plans?tenantId=&status=&customerId=&merchantId=` | List a tenant's plans. |
| `GET` | `/plans/:id?tenantId=` | Fetch a single plan. |
| `GET` | `/plans/:id/summary?tenantId=` | Repayment summary (paid/remaining/next due). |
| `POST` | `/plans/:id/installments/:index/pay` | Record a successful collection. |
| `POST` | `/plans/:id/installments/:index/fail` | Record a failed collection (retryable). |
| `POST` | `/plans/:id/cancel` | Cancel the plan and void outstanding installments. |
| `POST` | `/sweep` | Flag `scheduled` installments whose due date passed as `due`. |

### Create a plan

```bash
curl -X POST http://localhost:3000/api/v1/installments/plans \
  -H 'Content-Type: application/json' \
  -d '{
    "tenantId": "tenant-1",
    "customerId": "cust-9",
    "amount": 300,
    "currency": "USD",
    "installmentCount": 3,
    "frequency": "monthly",
    "downPayment": 0,
    "startDate": "2026-10-01T00:00:00.000Z"
  }'
```

### Collect an installment

```bash
curl -X POST http://localhost:3000/api/v1/installments/plans/<planId>/installments/1/pay \
  -H 'Content-Type: application/json' \
  -d '{ "paymentId": "pay_123" }'
```

Paying the final outstanding installment transitions the plan to `completed`.

## Events

`BNPLInstallmentService` publishes domain events through the injectable
`InstallmentEventPublisher` interface:

- `installment_plan.created`
- `installment.paid`
- `installment.failed`
- `installment.overdue`
- `installment_plan.completed`
- `installment_plan.cancelled`

The default publisher logs; wire an event-bus adapter in production.

## Persistence

- Prisma models: `InstallmentPlan` (`installment_plans`) and `Installment`
  (`installments`), migration `20260927000000_bnpl_installments`.
- The service depends on `InstallmentPlanRepository`; `InMemoryInstallmentPlanRepository`
  backs tests and local development. Implement the same interface with Prisma
  for production.

## Overdue handling

`POST /installments/sweep` runs the dunning step: every outstanding
installment past its due date flips from `scheduled` to `due` and emits
`installment.overdue`. The sweep is idempotent — re-running it only rewrites
installments still in `scheduled` state.
