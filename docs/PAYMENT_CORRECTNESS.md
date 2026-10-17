# Payment Correctness

Invariants that payment and payout code must hold. Each one corresponds to a bug class
that has actually occurred in this codebase, with the guard that now prevents it.

## Money is never a floating-point expression

`0.1 + 0.2` is `0.30000000000000004`. Multiplying a fiat amount by an FX rate accumulates
the same error, and the conversion record stops agreeing with the amount charged.

Use `backend/src/services/money.ts`. It parses decimal strings into integer minor units
(`bigint`), does the arithmetic there, and formats back with a fixed scale. Rounding is
half-away-from-zero.

```ts
import { formatMinor, multiplyByRate, parseDecimalToMinor } from '../services/money.js';

const fiatMinor = parseDecimalToMinor('33.33', 2);       // 3333n
const cryptoMinor = multiplyByRate(fiatMinor, 1.08, 7);  // exact
formatMinor(cryptoMinor, 7);                             // '35.9964000'
```

When an API is typed as `number`, use `quantizeNumber(value, decimals)` rather than
`value.toFixed()` followed by `Number()`.

| Do                                       | Do not                                |
| ---------------------------------------- | ------------------------------------- |
| `parseDecimalToMinor(value, 2)`          | `Math.round(value * 100) / 100`       |
| `multiplyByRate(minor, rate, 7)`         | `(amount * rate).toFixed(7)`          |
| `quantizeNumber(value, 6)`               | `Number(value.toFixed(6))`            |
| `sumAmounts(values, 2)`                  | `values.reduce((a, b) => a + b, 0)`   |

## An unsupported FX pair is an error, not a rate of 1.0

`getCurrentRate` used to return `1.0` for any pair it did not recognise, so `GBP -> BTC`
would quote one Bitcoin per pound and `confirmConversion` would happily record it.

Only the pairs in `SUPPORTED_FIAT_PAIRS` are quotable. Anything else raises
`UNSUPPORTED_FIAT_PAIR`, `lockRate` refuses to create a lock, and `GET /api/v1/stripe/rates`
answers `400`.

## Amounts are validated before they are stored

`lockRate` rejects `0`, negative, `NaN` and infinite amounts, amounts above
`MAX_FIAT_CONVERSION_AMOUNT`, a missing user id, and sub-cent input is normalised to the
currency's minor units. A lock is quantised at creation so the crypto amount it later
produces cannot disagree with the fiat amount on record.

Payout balances go through the same gate: `setPendingAmount` rejects `NaN`, negative and
infinite values with `INVALID_PENDING_PAYOUT_AMOUNT`.

## A rate lock is single-use and owned by its creator

`confirmConversion` marks the lock consumed and ties the conversion to the lock's owner.
A second confirmation with the same lock id — from anyone — fails, so one locked amount
cannot mint unlimited conversions.

## Refunds are their own terminal state

`processFiatRefund` records `status = 'refunded'` with a `refundedAt` timestamp. It used
to write `'failed'`, which was indistinguishable from a genuine failure in reconciliation
and alerting.

It returns `false` when the conversion is missing, not `completed`, or has no refundable
Stripe payment intent: reporting success without moving money is worse than failing.
Concurrent calls for the same conversion collapse onto one Stripe refund.

## Settlement references are derived, not random

`settleToStellar` derives the transaction reference from
`hash(destination | amount | asset)` instead of `Math.random()`. A random reference cannot
be reconciled against the chain, and two settlements in the same millisecond could collide.

## Revenue pool shares may not exceed 100%

Recipient ratios were validated individually (`0 < ratioBps <= 10000`) but their sum was
not, so a pool could be configured to distribute more than it received.

`addRecipient` and `updateRecipientRatio` now reject any change that would push
`sum(ratioBps)` above `TOTAL_SHARE_BPS`.

## A transaction hash is recorded once

`recordDistribution` returns the existing row when the same `(poolId, txHash)` is submitted
again. Chain reorganisations and retried indexers replay transactions, and a duplicate row
double-counted revenue against every recipient.

## An idempotency key is bound to one payload

`backend/src/middleware/idempotency.ts` fingerprints the request body and stores it with
the cached response. Reusing a key with a **different** body answers
`409 idempotency_key_reuse_mismatch` instead of silently replaying the earlier response —
which would leave the caller believing it created a new resource while holding the old one.

Object keys are sorted before fingerprinting, so re-serialising a payload in a different
key order is still the same request.

Two other failure modes share a status:

- `409 idempotency_key_in_use` — the same key is being processed right now.
- `409 idempotency_key_reuse_mismatch` — the key was used with a different payload.

The cache is bounded (`DEFAULT_MAX_CACHE_ENTRIES = 10_000`, oldest evicted first), so a
flood of unique keys cannot exhaust memory. Call `purgeExpiredIdempotencyKeys()` from a
scheduled job to reclaim expired entries.

Only responses below `500` are cached: a `5xx` may be transient.

## Batch totals are exact and never span assets

`estimateBatch` and `getBatchReport` (`backend/src/services/batch.ts`) sum amounts with
`sumAmounts` at seven decimals (Stellar precision), not with `parseFloat`. Binary floating
point turned `0.1 + 0.2` into `0.30000000000000004` in reports shown to operators.

Totals are per asset. A batch that pays both XLM and USDC reports `totalAmount: null` and
lists each asset under `byAsset`, because XLM and USDC are not comparable.

## Unknown states are programming errors, not branches

`PayoutBatch.status` is only ever changed through the engine's transition table. A
`completed` batch cannot be reopened, and `executing` cannot return to `executing`.

## See also

- [Payout reliability](PAYOUT_RELIABILITY.md)
- [Payout approvals](PAYOUT_APPROVALS.md)
- [Payment security](security/payment-security.md)