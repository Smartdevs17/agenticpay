# Payout Reliability

How a payout moves from a merchant's pending balance to a settled transaction, and what
the platform guarantees at each step.

The engine lives in `backend/src/services/payouts/payout-engine.ts` and is exposed over
HTTP at `/api/v1/payouts` (`backend/src/routes/payouts.ts`).

## Reliability properties

| Property             | How it is enforced                                                                 |
| -------------------- | ----------------------------------------------------------------------------------- |
| No double payment    | A batch's amount is reserved out of the pending balance when the batch is created.     |
| No premature settle  | A batch is only `completed` after the rail returns a transaction hash.                |
| No replayed batch    | Every batch carries a stable `idempotencyKey`, handed to the rail on every attempt.    |
| No double cycle      | Calendar schedules key their batches by period bucket; overlapping passes are rejected. |
| No silent loss       | Failed reservations stay reserved and visible in `stats().reservedAmount`.            |
| No review bypass     | Batches needing approval are re-queued for review after a failure, never auto-settled. |

## Lifecycle

```text
                    create
                      |
                      v
                  pending -------- reject --------> failed (funds released)
                      |                                ^
          approve     |                                | retry (approver only)
                      v                                |
                  executing                          |
                 /        \                           |
        success /          \ failure                 |
               v            v                        |
          completed     failed (retry scheduled) -----+
                          |  ^
                          |  | retryDueBatches(): backoff elapsed
                          |  |
                          +--+  (auto-approved only; batches needing review re-enter `pending`)
```

Only these transitions are legal; anything else raises `INVALID_PAYOUT_TRANSITION`:

| From        | To                          |
| ----------- | --------------------------- |
| `pending`   | `executing`, `completed`, `failed` |
| `executing` | `completed`, `failed`       |
| `failed`    | `pending`                   |
| `completed` | —                           |

## Scheduled cycles

| Cadence     | Due when                                                                  |
| ----------- | ------------------------------------------------------------------------- |
| `threshold` | Immediately, once `pendingAmount >= thresholdAmount`.                     |
| `daily`     | At most once per 24h from the previous materialisation.                   |
| `weekly`    | At most once per 7 days.                                                  |
| `monthly`   | At most once per 30 days.                                                 |

A threshold schedule with `thresholdAmount` of `0` or `undefined` is rejected with
`INVALID_PAYOUT_THRESHOLD_AMOUNT`; it used to silently behave like "pay everything".

Calendar schedules stamp each batch with a `cycleKey` of
`<scheduleId>:<merchantId>:<cadence>:<periodBucket>`. Re-arming a schedule does not clear
the marker, so a replayed evaluation inside the same period cannot pay twice.

## Retry policy

A failed attempt schedules a retry with exponential backoff plus symmetric jitter:

```text
delay(attempt) = min(retryBaseMs * 2^(attempt - 1), retryMaxMs) * (1 ± 25%)
```

Defaults: `retryBaseMs = 30_000`, `retryMaxMs = 3_600_000`, `maxAttempts = 5`. Set them
per engine instance rather than globally.

- Retries run through `retryDueBatches()`, driven by a scheduled worker.
- A batch that needed approval returns to `pending` for re-approval; it is never
  auto-settled by the retry worker.
- When the attempt budget is exhausted the batch is terminally `failed` with
  `errorCode = PAYOUT_ATTEMPTS_EXHAUSTED`. The reservation is **kept** on purpose —
  returning the funds to the pending balance would mint a fresh batch immediately and
  spin against a rail that is already down. The amount stays visible in
  `stats().reservedAmount` until an operator resolves it.

## Reserved funds

- Created: the amount leaves `pendingAmounts` and becomes the batch's reservation.
- Rejected: the reservation returns to `pendingAmounts` (`fundsReleased = true`).
- Exhausted: the reservation is **not** released. Call
  `releaseReservedFunds(batchId, approver)` once the rail is healthy again. It is
  idempotent — a second call returns `false`.

## Settlement rail

The engine ships a default executor that performs no network I/O. A deployment must
inject a real one:

```ts
new PayoutEngine({
  executor: async ({ batchId, idempotencyKey, merchantId, asset, amount, attempt }) => {
    const receipt = await rail.transfer({ idempotencyKey, to: destinationOf(merchantId), asset, amount });
    return { transactionHash: receipt.hash, settledAt: new Date() };
  },
  onEvent: (event) => metrics.record(event.type, event),
});
```

An executor that resolves without a `transactionHash`, or that rejects, is treated as a
failed attempt — the batch is never marked `completed` on an unconfirmed settlement.

## Events

The `onEvent` sink receives `payout.created`, `payout.pending_review`, `payout.executing`,
`payout.completed`, `payout.failed` and `payout.delayed`. `payout.delayed` carries the
scheduled retry time. A subscriber that throws is ignored so a webhook outage cannot
abort a payout decision.

## API

All endpoints require an authenticated principal holding `finance_approver` or `admin`.
Money-moving requests accept an `Idempotency-Key` header, and the router is rate limited.
See [payment security](security/payment-security.md).

| Method | Path                                  | Purpose                              |
| ------ | ------------------------------------- | ------------------------------------ |
| PUT    | `/api/v1/payouts/schedules/:merchantId` | Create or replace a payout schedule |
| DELETE | `/api/v1/payouts/schedules/:merchantId` | Remove a payout schedule            |
| POST   | `/api/v1/payouts/balances/:merchantId` | Credit a merchant's pending balance |
| GET    | `/api/v1/payouts/balances/:merchantId` | Read a pending balance              |
| POST   | `/api/v1/payouts/evaluate`             | Run one payout pass                  |
| POST   | `/api/v1/payouts/retries`              | Settle batches whose backoff elapsed |
| POST   | `/api/v1/payouts/:batchId/approve`     | Approve and settle                   |
| POST   | `/api/v1/payouts/:batchId/reject`      | Reject and release the reservation   |
| POST   | `/api/v1/payouts/:batchId/retry`       | Re-enter a failed batch in review    |
| POST   | `/api/v1/payouts/:batchId/release`     | Release an exhausted reservation     |
| GET    | `/api/v1/payouts?merchantId=`          | List batches                         |
| GET    | `/api/v1/payouts/stats`                | Counts plus money owed               |
| GET    | `/api/v1/payouts/:batchId`             | Batch detail plus its audit trail    |

Amounts must be positive, finite, and at most `1_000_000`. Assets are restricted to
`USDC`, `USDT`, `XLM` and `EURC`.

## Operating the queue

1. Alert on any `payout.failed` event — it means a batch needs a decision.
2. Watch `stats().reservedAmount`; a non-zero value that does not fall means funds are held.
3. Watch `stats().awaitingSettlement` for balances that never reach a batch (usually a
   missing or misconfigured schedule).
4. Alert on `payout.delayed` bursts: a rail that is timing out rather than rejecting will
   keep every batch in retry for minutes.

The scheduled payout worker also has an in-flight guard. A slow provider call cannot
overlap the next timer tick, and a rejected pass is logged while the worker remains
available for the following tick. This keeps a transient rail slowdown from creating a
second batch pass over the same due payouts.

## Audit trail

Every decision records `(batchId, action, actorId, timestamp, details)` with actions
`created`, `approved`, `rejected`, `retried`, `executing`, `settled`, `failed` and
`released`. Pre-batch failures (for example a balance above the engine cap) are recorded
against the schedule id so one merchant's misconfiguration cannot hide.

History, batch and audit reads all return defensive snapshots; mutating a returned object
does not affect engine state.

## See also

- [Payout approvals](PAYOUT_APPROVALS.md) — the approval thresholds and roles
- [Payment correctness](PAYMENT_CORRECTNESS.md) — money arithmetic and idempotency rules
- [Payment security](security/payment-security.md) — authentication and authorization
