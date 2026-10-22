# Financial Reporting — Issues #937, #938, #939, #940

This document describes the reporting endpoints added for the financial reporting wave.

| Issue | Feature | Endpoint |
| --- | --- | --- |
| #937 | Transaction reconciliation report | `POST /api/v1/reports/reconciliation` |
| #938 | Merchant settlement reports | `POST /api/v1/reports/settlement`, `GET /api/v1/reports/settlement` |
| #939 | Payout failure analytics dashboard | `GET /api/v1/reports/payout-failure-analytics` |
| #940 | Automated financial statements | `POST /api/v1/reports/financial-statement` |

All endpoints are mounted under the existing `reports` router at `/api/v1/reports` and are
tenant-scoped through the `x-tenant-id` request header (defaulting to `default`).

---

## Shared conventions

### Date range

`dateFrom` and `dateTo` are required and accept either `yyyy-mm-dd` or a full ISO timestamp.
A date-only value is interpreted as a UTC day, so `dateTo` always covers the whole day.
A range where `dateFrom` is after `dateTo` is rejected with `400 VALIDATION_ERROR`.

### Fees

Reports need a platform fee to report net figures. The rate is read from the
`REPORT_PLATFORM_FEE_BPS` environment variable (basis points, `0`–`10000`) and defaults to `0`.
Every request may override it with a `feeBps` field in the request body.

### Row limits

A single report materialises at most 10 000 ledger rows. When the limit is reached the response
carries `"truncated": true` so the caller knows the totals describe a partial window.

### Exports

Every report can be exported:

* `format: "csv"` — returns `text/csv` with a `Content-Disposition` attachment header.
* `format: "pdf"` — returns `application/pdf`, a dependency-free text PDF.
* `format: "json"` (default) — returns the structured payload.

### Report jobs

Statement and settlement runs are recorded as `ReportJob` rows (`type` is
`financial_statement` or `settlement`) so a run can be audited. The job is written before
generation, marked `completed` on success and marked `failed` with the error message otherwise.
A `ReportArchive` row is attached to every successful run.

---

## #940 — Automated financial statements

`POST /api/v1/reports/financial-statement`

```json
{
  "dateFrom": "2026-01-01",
  "dateTo": "2026-01-31",
  "chain": "stellar",
  "currency": "XLM",
  "feeBps": 100,
  "format": "json"
}
```

Response (`format: "json"`):

```json
{
  "statement": {
    "dateFrom": "2026-01-01",
    "dateTo": "2026-01-31",
    "tenantId": "default",
    "generatedAt": "2026-01-31T12:00:00.000Z",
    "feeBps": 100,
    "incomeStatement": [
      { "label": "Gross revenue", "amount": 150 },
      { "label": "Refunds and reversals", "amount": 0 },
      { "label": "Net revenue", "amount": 150 },
      { "label": "Platform fees", "amount": -1.5 },
      { "label": "Net income", "amount": 148.5 }
    ],
    "balanceSheet": {
      "assets": [],
      "liabilities": [],
      "equity": [],
      "totalAssets": 148.5,
      "totalLiabilities": 0,
      "totalEquity": 148.5,
      "balanced": true
    },
    "cashFlow": [],
    "transactions": [],
    "daily": [],
    "monthly": [],
    "totals": {},
    "truncated": false
  },
  "jobId": "b0f1..."
}
```

### Ledger classification

| Payment | Statement bucket |
| --- | --- |
| `status = completed`, `type != refund` | Gross revenue (net of the platform fee) |
| `status = completed`, `type = refund` | Cash outflow, reduces net revenue |
| `status = refunded` | Reversal, reduces net revenue |
| `status = pending` / `processing` | Accounts receivable, not revenue |
| `status = failed` | Not recognised |
| `status = cancelled` | Not recognised |

The balance sheet is built so that assets always equal liabilities plus equity; the
`balanced` flag reports that invariant explicitly.

### Job endpoints

* `GET /api/v1/reports/financial-statement/jobs?page=1&limit=20`
* `GET /api/v1/reports/financial-statement/jobs/:id`

---

## #938 — Merchant settlement reports

`POST /api/v1/reports/settlement` (records a job) and `GET /api/v1/reports/settlement`
(ad-hoc report).

```json
{
  "dateFrom": "2026-01-01",
  "dateTo": "2026-01-31",
  "merchantId": "G_MERCHANT_ADDRESS"
}
```

A merchant is the settlement account a payment was made to: `Payment.toAddress`, falling back to
`Payment.userId` and finally to `unassigned`.

Each merchant row reports `grossCollected`, `refunds`, `reversals`, `fees`, `netSettlement`,
`inFlight`, `failedAmount`, `transactionCount` and `lastActivityAt`. The response also carries
daily and monthly breakdowns plus tenant totals.

---

## #939 — Payout failure analytics dashboard

`GET /api/v1/reports/payout-failure-analytics?dateFrom=…&dateTo=…&merchantId=…&asset=…`

```json
{
  "analytics": {
    "totals": {
      "totalPayouts": 12,
      "failedPayouts": 3,
      "completedPayouts": 8,
      "pendingPayouts": 1,
      "failureRate": 25,
      "totalAmount": 1200,
      "failedAmount": 300,
      "settledAmount": 850
    },
    "failures": [],
    "byErrorCode": [{ "code": "INSUFFICIENT_FUNDS", "count": 2 }],
    "byMerchant": [],
    "byAsset": [],
    "byPeriod": []
  }
}
```

Failure rates are measured against **every** payout in the window, not only the failed ones.
Each failure is classified with the shared failure-analysis engine, so the dashboard reports a
root cause, a severity and suggested resolutions. Error-code counts are computed per request,
so repeated calls never leak into one another.

The dashboard UI lives at `frontend/app/[locale]/dashboard/payout-failures/page.tsx` and is backed
by the pure helpers in `frontend/lib/analytics/payout-failures.ts`.

---

## #937 — Transaction reconciliation report

`POST /api/v1/reports/reconciliation`

```json
{
  "dateFrom": "2026-01-01",
  "dateTo": "2026-01-31",
  "chain": "stellar",
  "status": "completed",
  "format": "csv"
}
```

Every transaction is classified with a reconciliation status:

| Status | Meaning |
| --- | --- |
| `matched` | Settled, carries a transaction hash, unique and positive. |
| `missing_tx_hash` | A settled payment without a settlement reference. |
| `duplicate_tx_hash` | The settlement reference was already reconciled in this window. |
| `invalid_amount` | The amount is not greater than zero. |
| `not_settled` | The payment has not settled yet. |

The report also reconciles the totals: `expectedSettlement` (net amount that should have been
settled) against `collectedAmount` (net amount that was collected), leaving `outstandingAmount`.

The legacy reconciliation router is now mounted at `/api/v1/reconciliation` (`/generate`,
`/preview`, `/jobs`), which is what the existing dashboard page under
`frontend/app/[locale]/dashboard/reports/reconciliation` calls.

---

## Tests

* `backend/src/services/reports/__tests__/report-format.test.ts`
* `backend/src/services/reports/__tests__/financial-statements.test.ts`
* `backend/src/services/reports/__tests__/reconciliation-report.test.ts`
* `backend/src/services/reports/__tests__/merchant-settlement.test.ts`
* `backend/src/services/payouts/__tests__/payout-failure-analytics.test.ts`
* `frontend/lib/analytics/payout-failures.test.ts`
