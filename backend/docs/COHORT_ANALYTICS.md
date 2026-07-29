# Subscription Cohort Retention Analytics

Issue #629. In-memory, event-sourced cohort analytics for on-chain-managed
subscriptions (see `backend/src/jobs/subscription.service.ts`). There is no
Prisma-persisted subscription/customer table in this codebase — subscriptions
are managed on-chain — so this service, like `backend/src/services/analytics.ts`
(Issue #192), ingests lifecycle events via `track()`/`trackMany()` and derives
everything else on read. Feed it from `SubscriptionProcessor`, payment
webhooks, or tests.

Service: `backend/src/services/cohort-analytics.ts` (`CohortAnalyticsService`,
singleton `cohortAnalyticsService`).
Routes: `backend/src/routes/cohort-analytics.ts` (`cohortAnalyticsRouter`,
mount at `/api/v1/analytics/cohorts`).
Tests: `backend/src/services/__tests__/cohort-analytics.test.ts`.

## Event model

```ts
interface SubscriptionLifecycleEvent {
  subscriptionId: string;
  customerId: string;
  event: 'started' | 'renewed' | 'cancelled' | 'payment_failed';
  amount: number;      // >= 0
  currency: string;
  occurredAt: Date;
  planId?: string;
}
```

- `started` — a new subscription begins (first payment / signup, or a
  re-subscription after a prior cancellation).
- `renewed` — a recurring billing cycle succeeded (revenue event).
- `cancelled` — the subscription was cancelled/churned.
- `payment_failed` — a billing attempt failed. This does **not** by itself
  mark a customer inactive (see "Active" definition below) — it's informational
  and does not contribute to revenue.

## Cohort assignment rule

A customer's **cohort** is the calendar month (UTC, `YYYY-MM`) of their
**first-ever `started` event**, considering their full event history across
all subscriptions. Customers with no `started` event in the ingested history
cannot be assigned a cohort and are excluded from all cohort analysis.

Cohort assignment never changes: if a customer cancels and later re-subscribes
(a new `started` event in a later month), they remain in their **original**
signup cohort. Re-subscribing does not create a new cohort entry or inflate
`cohortSize` — see "Re-subscribe rule" below for how this affects retention.

`monthOffset` is the number of whole calendar months between a cohort's start
month and the month being reported on (`monthOffset = 0` is the signup month
itself).

## "Active" definition and the re-subscribe rule

For a given customer and a given offset month, we look at all of that
customer's events **at or before the end of that month**, in chronological
order, and take the **most recent one**:

- If the most recent event is `cancelled` → the customer is **inactive** in
  that offset month.
- Otherwise (`started`, `renewed`, or `payment_failed` is most recent) → the
  customer is **active**.

**Re-subscribe rule (explicit design decision):** a customer who cancels and
later has a new `started` (or `renewed`) event is counted **active again**
starting from the month of that later event — "most recent event wins".
They are *not* excluded permanently just because they churned once. This
means a cohort's retention curve can go back up after a dip, which is
intentional: it reflects "engaged in a given month," not "never churned."
If you need "never churned" cohort integrity instead, filter customers by
`getChurnCohort`'s cumulative churn set before computing retention — that
composition is not built in, to keep the primitives simple.

A `payment_failed` event alone does not flip a customer to inactive — only an
explicit `cancelled` event does. This matches real dunning flows where a
failed payment is retried before a subscription is actually cancelled.

## Formulas

Let `cohortSize` = number of unique customers in the cohort (customers whose
first `started` event falls in the cohort month).

### Retention curve — `getRetentionCurve(cohortMonth)`

For each `monthOffset` from `0` to the highest offset with any event data for
the cohort:

```
activeCustomers(offset) = count of cohort customers considered "active" in that offset month
retentionPct(offset)    = activeCustomers(offset) / cohortSize * 100
```

### Revenue cohort — `getRevenueCohort(cohortMonth)`

Revenue is summed from `started` and `renewed` event `amount`s that occurred
in the corresponding calendar month (`cohortMonth + offset` months):

```
totalRevenue(offset)              = sum of amount over started/renewed events in that offset month
activeCustomers(offset)           = distinct customers with a started/renewed event in that offset month
averageRevenuePerCustomer(offset) = totalRevenue(offset) / activeCustomers(offset)   (0 if activeCustomers = 0)
```

Note: `activeCustomers` here is scoped to "had a revenue event this offset
month" — a narrower definition than the retention curve's "active" (which
also considers customers who are subscribed but had no billing event yet in
that exact month, e.g. `payment_failed` only). Use the retention curve's
`activeCustomers` for headcount and this field for revenue-generating count.

### Churn cohort — `getChurnCohort(cohortMonth)`

```
churnedCustomers(offset)      = distinct cohort customers with a `cancelled` event in that offset month
activeAtStartOfOffset(offset) = cohortSize                          if offset = 0
                               = activeCustomers(offset - 1)         if offset > 0   (from the retention curve)
churnRatePct(offset)          = churnedCustomers(offset) / activeAtStartOfOffset(offset) * 100
cumulativeChurnRatePct(offset)= |{customers with >=1 cancelled event at or before this offset}| / cohortSize * 100
```

`cumulativeChurnRatePct` counts a customer once even if they cancel more than
once (e.g. cancel, re-subscribe, cancel again) — it answers "what fraction of
the cohort has ever churned by this point," independent of the re-subscribe
rule used for the retention curve.

### Cohort comparison — `compareCohorts(cohortMonths)`

Returns the retention/revenue/churn curves for every requested cohort month
keyed by cohort month, plus:

- `cohortSizes` — size of each cohort.
- `averageRetentionPctByCohort` — mean of `retentionPct` across that cohort's
  own curve (simple average across its available offsets, not aligned across
  cohorts of different lengths).
- `bestRetentionCohort` / `worstRetentionCohort` — the single
  `(cohortMonth, monthOffset, retentionPct)` point with the highest/lowest
  retention across *all* requested cohorts and *all* their offsets (ties keep
  the first one encountered, in the order `cohortMonths` was given).

### CSV export — `exportToCsv(cohortMonth, kind)`

`kind` is `'retention' | 'revenue' | 'churn'`. Produces a header row plus one
row per `monthOffset`:

- `retention`: `cohortMonth,monthOffset,activeCustomers,retentionPct`
- `revenue`: `cohortMonth,monthOffset,totalRevenue,averageRevenuePerCustomer,activeCustomers`
- `churn`: `cohortMonth,monthOffset,churnedCustomers,churnRatePct,cumulativeChurnRatePct`

Percentages and money amounts are formatted with 2 decimal places. An unknown
cohort month returns just the header row (no data rows), never an error.

## API — `/api/v1/analytics/cohorts`

All responses are wrapped as `{ data: ... }` except `/track` and CSV export.
Validation failures return `AppError`-shaped `400` responses via the shared
`errorHandler` middleware (`{ error: { code: 'VALIDATION_ERROR', message, status } }`).

### `POST /api/v1/analytics/cohorts/track`

Ingest one subscription lifecycle event.

Request body:

```json
{
  "subscriptionId": "sub_123",
  "customerId": "cust_abc",
  "event": "started",
  "amount": 29.99,
  "currency": "USD",
  "occurredAt": "2025-01-05T00:00:00Z",
  "planId": "plan_pro"
}
```

`occurredAt` is optional (defaults to "now"); `planId` is optional.

Response `201`:

```json
{ "ok": true }
```

### `GET /api/v1/analytics/cohorts`

List all cohort months present with their size.

```json
{
  "data": [
    { "cohortMonth": "2025-01", "cohortSize": 3 },
    { "cohortMonth": "2025-02", "cohortSize": 2 }
  ]
}
```

### `GET /api/v1/analytics/cohorts/:cohortMonth/retention`

`cohortMonth` must match `YYYY-MM`.

```json
{
  "data": {
    "cohortMonth": "2025-01",
    "retention": [
      { "monthOffset": 0, "activeCustomers": 3, "retentionPct": 100 },
      { "monthOffset": 1, "activeCustomers": 2, "retentionPct": 66.666... }
    ]
  }
}
```

### `GET /api/v1/analytics/cohorts/:cohortMonth/revenue`

```json
{
  "data": {
    "cohortMonth": "2025-01",
    "revenue": [
      { "monthOffset": 0, "totalRevenue": 30, "averageRevenuePerCustomer": 10, "activeCustomers": 3 }
    ]
  }
}
```

### `GET /api/v1/analytics/cohorts/:cohortMonth/churn`

```json
{
  "data": {
    "cohortMonth": "2025-01",
    "churn": [
      { "monthOffset": 0, "churnedCustomers": 0, "churnRatePct": 0, "cumulativeChurnRatePct": 0 },
      { "monthOffset": 1, "churnedCustomers": 1, "churnRatePct": 33.33, "cumulativeChurnRatePct": 33.33 }
    ]
  }
}
```

### `POST /api/v1/analytics/cohorts/compare`

Request:

```json
{ "cohortMonths": ["2025-01", "2025-02"] }
```

Response:

```json
{
  "data": {
    "cohortMonths": ["2025-01", "2025-02"],
    "retention": { "2025-01": [...], "2025-02": [...] },
    "revenue": { "2025-01": [...], "2025-02": [...] },
    "churn": { "2025-01": [...], "2025-02": [...] },
    "summary": {
      "cohortSizes": { "2025-01": 3, "2025-02": 2 },
      "bestRetentionCohort": { "cohortMonth": "2025-01", "monthOffset": 0, "retentionPct": 100 },
      "worstRetentionCohort": { "cohortMonth": "2025-02", "monthOffset": 1, "retentionPct": 50 },
      "averageRetentionPctByCohort": { "2025-01": 88.9, "2025-02": 75 }
    }
  }
}
```

### `GET /api/v1/analytics/cohorts/:cohortMonth/export?kind=retention|revenue|churn`

CSV download. `kind` defaults to `retention` if omitted or invalid.
Response headers:

```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="cohort-retention-2025-01.csv"
```

Body example (`kind=retention`):

```csv
cohortMonth,monthOffset,activeCustomers,retentionPct
2025-01,0,3,100.00
2025-01,1,2,66.67
```

## Mounting

This route module is not wired into `src/index.ts` by this change (per task
scope — index.ts is owned by another workstream). To enable it, mount:

```ts
import { cohortAnalyticsRouter } from './routes/cohort-analytics.js';
app.use('/api/v1/analytics/cohorts', cohortAnalyticsRouter);
```
