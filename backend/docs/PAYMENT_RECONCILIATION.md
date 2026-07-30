# Automated Payment Reconciliation

Issue #628. Automates a previously manual, time-consuming reconciliation
process: matching our own `Payment` ledger against external sources of
truth (bank statements, PSP settlement files, on-chain feeds), reporting on
the result, and giving operators a workflow for chasing down anything left
unmatched.

- `backend/src/services/payment-reconciliation/matching-engine.ts` — pure, DB-free
  matching algorithm (`runMatchingEngine`).
- `backend/src/services/payment-reconciliation/reconciliation-service.ts` —
  orchestration: batch creation, ingestion, persistence, exception
  workflow, reporting, analytics (`ReconciliationService`, singleton
  `reconciliationService`).
- `backend/src/services/payment-reconciliation/index.ts` — public exports, plus the
  scheduled-reconciliation entry point (`runScheduledReconciliation`).
- `backend/src/routes/payment-reconciliation.ts` — HTTP API (`paymentReconciliationRouter`,
  intended mount path `/api/v1/payment-reconciliation`).

## Data model

Four Prisma models back the engine (`prisma/schema.prisma`, already
migrated):

- **`ReconciliationBatch`** — one reconciliation run for a `tenantId` over
  `[periodStart, periodEnd)`. Carries aggregate stats
  (`totalRecords`, `matchedCount`, `exceptionCount`, `matchedAmount`,
  `unmatchedAmount`) and a `status` that progresses
  `pending → running → completed | completed_with_exceptions | failed`.
- **`ReconciliationRecord`** — a single line item pulled into the batch,
  either `source: internal` (from `Payment`) or from an external source
  (`bank_statement | psp_settlement | onchain`). Flags whether it ended up
  `matched`.
- **`ReconciliationMatch`** — a resolved pairing between one internal and
  one external `ReconciliationRecord`, with `matchType`
  (`exact | fuzzy | manual`), a `confidence` score (`Decimal(5,4)`, 0–1),
  and `amountDelta` (external amount − internal amount).
- **`ReconciliationException`** — anything left unmatched (or an internal
  record with no external counterpart, or vice versa), carrying a `reason`,
  a workflow `status`, and optional `assignedTo` / `resolutionNote` /
  `resolvedAt` for the resolution workflow.

### Postgres vs. in-memory fallback

Like `services/archival/archival-service.ts`, `ReconciliationService` gates
all persistence behind `usePrisma() { return Boolean(process.env.DATABASE_URL) }`.
When `DATABASE_URL` is unset (this repo's default test run), batches,
records, matches, and exceptions live in in-memory maps on the service
instance instead of the Prisma tables, and internal "Payment" records come
from an injected list (`seedPayments()`) rather than a live query — so the
whole service, including the exception workflow, reporting, and analytics,
is unit-testable without a live Postgres connection. Call `resetForTests()`
to clear in-memory state between tests.

## Matching algorithm

`runMatchingEngine(internal, external, options?)` is a pure function — no
I/O — that takes two pools of normalized `MatchCandidate` records and
returns `{ matches, unmatchedInternal, unmatchedExternal }`. It runs three
passes, each claiming records so no record is ever matched twice:

1. **Exact — by reference.** Same `currency`, same `amount` (to
   floating-point epsilon), and a non-empty `externalRef` (the internal
   record's `txHash`, or the external record's statement reference) that is
   identical on both sides. Confidence `1.0`.
2. **Exact — by amount + tight date window.** For records with no usable
   reference match: same `currency`, identical `amount`, and `occurredAt`
   within `exactDateWindowMs` (default **5 minutes**) of each other.
   Confidence `1.0`. When several external candidates qualify, the closest
   in time wins.
3. **Fuzzy — by tolerance.** Same `currency`, amount within
   `amountTolerancePct` (default **2%**) of the internal amount, and
   `occurredAt` within `fuzzyDateWindowMs` (default **3 days**). All viable
   pairs across the whole remaining pool are scored and assigned
   highest-confidence-first (so a good match elsewhere doesn't get starved
   by a mediocre one claimed first).

Records that clear none of the three passes are left unmatched and become
`ReconciliationException` rows (see below) — this includes **currency
mismatches** (never matched, regardless of amount/date) and **split
payments**, where one internal payment was settled as several external
partial amounts; the engine does not attempt sum/partial matching, so both
sides of a split are surfaced as exceptions for manual review.

### Confidence scoring (fuzzy pass only)

```
amountScore = 1 - (amountDeltaPct / amountTolerancePct)   // 1 at 0% delta, 0 at the tolerance boundary
dateScore   = 1 - (dateDeltaMs / fuzzyDateWindowMs)        // 1 at 0 delta, 0 at the window edge
confidence  = amountScore * 0.7 + dateScore * 0.3
```

Amount closeness is weighted higher than date closeness. A pair is only
accepted once `confidence >= minFuzzyConfidence` (default **0.3** — chosen
so that a pair sitting exactly at the amount-tolerance boundary, on the
same day, still clears the gate: `0 * 0.7 + 1 * 0.3 = 0.3`). All tolerance
and window values are configurable per call via `MatchingOptions`.

## Batch lifecycle

`reconciliationService.runBatch({ tenantId, periodStart, periodEnd, externalRecords })`:

1. Creates a `ReconciliationBatch` row (`status: running`, `startedAt` set).
2. Ingests **internal** records: `Payment` rows for the tenant with
   `createdAt` in `[periodStart, periodEnd)` (or the in-memory seeded list
   when `DATABASE_URL` is unset).
3. Ingests **external** records from the request body (already-parsed
   `{ source, externalRef?, amount, currency, occurredAt, metadata? }`
   objects — this service does not itself fetch bank/PSP files; upstream
   ingestion is out of scope here and expected to hand off parsed rows).
4. Runs the matching engine over the two pools.
5. Persists a `ReconciliationRecord` per input record (`matched` flag set
   from the match outcome), a `ReconciliationMatch` per pairing, and a
   `ReconciliationException` per unmatched record
   (`no_matching_external_record` / `no_matching_internal_record`).
6. Updates the batch's aggregate stats and finalizes `status` to
   `completed` (no exceptions) or `completed_with_exceptions`, with
   `completedAt` set. On an unexpected error mid-run, the batch is marked
   `failed`.

## Exception workflow

`ReconciliationException.status` moves through:

```
open ──▶ investigating ──▶ resolved
  │                             ▲
  └───────────────▶ written_off ┘   (either state can also be reopened back to `open`)
```

- `open` — default state when an exception is created.
- `investigating` — an operator has picked it up (set `assignedTo`).
- `resolved` — the discrepancy was explained and closed out (e.g. matched
  manually) — record a `resolutionNote`.
- `written_off` — accepted as a permanent discrepancy (e.g. a bank fee)
  rather than resolved against a counterpart.

`resolved` and `written_off` are terminal for reporting purposes: moving
*into* either stamps `resolvedAt`; moving *out* of either (back to `open` or
`investigating`) clears `resolvedAt` again. Update via
`reconciliationService.updateException(id, { status?, assignedTo?, resolutionNote? })`.

## Reporting & analytics

- **`getBatchReport(batchId)`** — one batch's `matchRatePct`, matched vs.
  unmatched amounts, a per-source breakdown (`internal` /
  `bank_statement` / `psp_settlement` / `onchain`: total / matched /
  unmatched counts), and exceptions grouped by `reason` with count + amount.
  `reportToCsv(report)` renders the same data as CSV.
- **`getAnalytics({ tenantId, from?, to? })`** — cross-batch view:
  aggregate `matchRatePct`, mean time-to-resolve exceptions (hours, `null`
  if nothing has been resolved yet in the window), open/investigating
  exception count, exception reasons ranked by frequency, and a `trend`
  array (one entry per batch, ordered by `periodStart` ascending) so
  match-rate drift over time is visible at a glance.

## API

Mounted at `/api/v1/payment-reconciliation` (router: `paymentReconciliationRouter`,
`backend/src/routes/payment-reconciliation.ts`). All responses are wrapped as
`{ data: ... }`.

### `POST /batches`

Create and immediately run a batch.

```jsonc
// Request
{
  "tenantId": "tenant_1",
  "periodStart": "2026-07-28T00:00:00Z",
  "periodEnd": "2026-07-29T00:00:00Z",
  "externalRecords": [
    {
      "source": "bank_statement",
      "externalRef": "tx_abc123",
      "amount": 500.00,
      "currency": "USD",
      "occurredAt": "2026-07-28T10:05:00Z",
      "metadata": { "statementLine": 42 }
    }
  ]
}
```

```jsonc
// Response 201
{
  "data": {
    "id": "b_...", "tenantId": "tenant_1", "status": "completed",
    "totalRecords": 2, "matchedCount": 1, "exceptionCount": 0,
    "matchedAmount": 500, "unmatchedAmount": 0,
    "records": [ /* ReconciliationRecord[] */ ],
    "matches": [ /* ReconciliationMatch[] */ ],
    "exceptions": [ /* ReconciliationException[] */ ]
  }
}
```

### `GET /batches?tenantId=&from=&to=`

List batches for a tenant, optionally filtered to batches whose
`periodStart >= from` and `periodEnd <= to`.

### `GET /batches/:id`

Full batch detail — batch fields plus `records`, `matches`, `exceptions`.

### `GET /batches/:id/report`

The `ReconciliationReport` described above.

### `GET /exceptions?tenantId=&status=`

List exceptions for a tenant, optionally filtered by `status`
(`open | investigating | resolved | written_off`).

### `PATCH /exceptions/:id`

```jsonc
// Request — any subset of these fields
{ "status": "resolved", "assignedTo": "ops_alex", "resolutionNote": "Matched against late bank feed entry." }
```

### `GET /analytics?tenantId=&from=&to=`

The `ReconciliationAnalytics` object described above.

### `GET /export?batchId=`

CSV download of that batch's report
(`Content-Disposition: attachment; filename="reconciliation-<batchId>.csv"`).

## Scheduling

The service exposes `runScheduledReconciliation(): Promise<void>` from
`backend/src/services/payment-reconciliation/index.ts`. It reconciles the
**previous full UTC day** (`[yesterday 00:00Z, today 00:00Z)`) for every
tenant with `Payment` activity in that window (via
`reconciliationService.getTenantsWithActivity`), running a batch per tenant
with no external records supplied (i.e. it reconciles internal payments
against nothing, surfacing every payment as an exception until an external
feed is layered in via a follow-up `POST /batches` call, or until callers
extend this function to source external records automatically). Per-tenant
failures are caught and logged, not thrown, so one tenant's failure doesn't
block the rest.

This module intentionally does **not** register itself in
`backend/src/config/scheduled-tasks.ts` — that file is centrally owned.
Suggested registration:

```ts
import { runScheduledReconciliation } from '../services/payment-reconciliation/index.js';

{
  id: 'daily-payment-reconciliation',
  name: 'Daily Payment Reconciliation',
  description: 'Reconciles the previous day\'s Payment activity against external records for every active tenant.',
  schedule: '0 5 * * *', // 05:00 UTC daily — after overnight settlement files typically land
  timeoutMs: 10 * 60 * 1000,
  maxFailures: 3,
  handler: runScheduledReconciliation,
}
```
