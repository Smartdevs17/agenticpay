# Recurring Payment Schedules (Issue #918)

Cron-based recurring billing. A schedule bills a customer a fixed amount on a
cron cadence; each due run materialises a pending invoice.

## Concepts

| Concept | Description |
|---------|-------------|
| **Schedule** | `customerId` + `amount` + `currency` + a `cronExpression` (or `preset`) evaluated in a `timezone`. |
| **Preset** | `hourly`, `daily`, `weekly`, `monthly`, `yearly` — expanded to a canonical cron expression. |
| **Next run** | First cron occurrence after the effective start, stored as `nextRunAt`. |
| **Invoice** | A `pending` charge created when a schedule's `nextRunAt` comes due. |
| **Bounds** | Optional `startAt`, `endAt` and `maxRuns` (invoices cap). |

Schedule states: `active → paused ⇄ active`, plus `cancelled` and `completed`
(no further runs possible).

## Cadence

`PRESET_CRONS`:

| Preset | Cron |
|--------|------|
| `hourly` | `0 * * * *` |
| `daily` | `0 0 * * *` |
| `weekly` | `0 0 * * 0` |
| `monthly` | `0 0 1 * *` |
| `yearly` | `0 0 1 1 *` |

Provide a raw `cronExpression` for a custom cadence (e.g. `*/15 * * * *`).
`cronExpression` and `preset` are mutually exclusive; the cron wins if both are
present at the service layer. Cron expressions are validated on create/update,
and timezones are validated as IANA zones (`Intl.DateTimeFormat`).

## Behaviour

- **First run** — the first cron occurrence on/after `max(startAt, now)`; a past
  `startAt` never backfills.
- **Advance** — after each run, `nextRunAt` is recomputed from the run's due
  instant. `runDue` produces at most one invoice per schedule per call, so a
  schedule that is behind catches up on subsequent sweeps.
- **Completion** — the schedule flips to `completed` when `maxRuns` is reached or
  the next run would fall after `endAt`.
- **Failure safety** — if invoice persistence throws, the schedule is left
  untouched, a `recurring_invoice.failed` event fires, and the run is retried on
  the next sweep.

## REST API

Mounted at `/api/v1/recurring-payments`.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/schedules` | Create a schedule. |
| `GET` | `/schedules?tenantId=&status=&customerId=&merchantId=` | List schedules. |
| `GET` | `/schedules/:id?tenantId=` | Fetch a schedule. |
| `GET` | `/schedules/:id/upcoming?tenantId=&count=` | Preview the next runs. |
| `GET` | `/schedules/:id/invoices?tenantId=` | List generated invoices. |
| `POST` | `/schedules/:id/pause?tenantId=` | Pause billing. |
| `POST` | `/schedules/:id/resume?tenantId=` | Resume billing (recomputes next run). |
| `POST` | `/schedules/:id/resume` → `/cancel?tenantId=` | Cancel billing. |
| `POST` | `/schedules/:id/reschedule` | Change cadence/timezone. |
| `POST` | `/run-due` | Bill every due schedule. |

### Create a schedule

```bash
curl -X POST http://localhost:3000/api/v1/recurring-payments/schedules \
  -H 'Content-Type: application/json' \
  -d '{
    "tenantId": "tenant-1",
    "customerId": "cust-9",
    "amount": 49.99,
    "currency": "USD",
    "preset": "monthly",
    "startAt": "2026-10-01T00:00:00.000Z",
    "maxRuns": 12
  }'
```

### Run due billing

```bash
curl -X POST http://localhost:3000/api/v1/recurring-payments/run-due \
  -H 'Content-Type: application/json' \
  -d '{ "at": "2026-11-01T00:00:00.000Z" }'
```

Wire `/run-due` to a scheduler (the repo already has a cron/BullMQ scheduler in
`src/config/scheduled-tasks.ts` and `src/services/bullmq-scheduler.ts`), e.g.
every 15 minutes.

## Events

`RecurringBillingService` publishes through the injectable
`RecurringBillingPublisher`:

- `recurring_schedule.created`
- `recurring_schedule.paused` / `resumed` / `rescheduled`
- `recurring_schedule.cancelled` / `completed`
- `recurring_invoice.generated` / `failed`

## Persistence

The service depends on `RecurringScheduleRepository` /
`RecurringInvoiceRepository`; `InMemoryRecurringBillingStore` backs both for
tests and local development. Implement the same interfaces with Prisma
(`recurring_schedules`, `recurring_invoices`) for production.
