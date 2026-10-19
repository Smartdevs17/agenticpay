# Payout reliability, payment correctness and payment security (iterations 10-11)

Closes #1183, #1184, #1185, #1186.

These four tickets are templated "deliver the next increment" issues with no fixed scope.
Following the precedent of #1286 and #1287, this PR takes one concrete, real problem per
theme instead of a broad sweep, and keeps each change independently reviewable.

## Scope

### #1185 — Improve payout reliability

`PayoutEngine` had **no execution path**. Auto-approved and manually approved batches were
stamped `completed` without anything being sent, `executing` was unreachable dead state,
there was no failure or retry path, and calendar schedules fired on every evaluation pass.

- `pending -> executing -> completed | failed` is now a guarded transition table.
  `completed` is only reached when the rail returns a transaction hash.
- An injected `executor` actually settles the batch and receives a stable
  `idempotencyKey` on every attempt.
- Failures schedule an exponential backoff with jitter, capped by `maxAttempts`.
- `daily` / `weekly` / `monthly` respect their period and key their batches by period
  bucket, so a replayed pass cannot pay the same period twice.
- `thresholdAmount` of `0` no longer falls through to the "pay anything" branch.
- `payout.created` / `pending_review` / `executing` / `completed` / `failed` / `delayed`
  events via a pluggable sink. A throwing subscriber cannot abort a payout decision.
- Reservations are released on rejection, and on exhaustion only after an approver
  explicitly calls `releaseReservedFunds` — returning them automatically would mint a
  fresh batch and spin against a rail that is already down.
- One merchant's misconfiguration is isolated from the rest of the evaluation pass.
- New REST surface at `/api/v1/payouts`, mounted in `backend/src/index.ts`.

### #1184 — Fix payment correctness bugs

- **Unsupported FX pairs were priced at `1.0`.** `getCurrentRate` returned par for any
  pair it did not know, so `GBP -> BTC` would quote one Bitcoin per pound and
  `confirmConversion` would record it. Unquoted pairs are now an error.
- **Money was derived with binary floating point.** `33.33 * 1.08` is
  `35.99640000000001`, so the crypto amount stopped agreeing with the fiat amount charged.
  Added `backend/src/services/money.ts` (bigint minor units, half-away-from-zero
  rounding) and routed conversions through it.
- **`lockRate` accepted `NaN`, negative and infinite amounts**, producing locks whose
  conversion amounts were `"NaN"`.
- **`processFiatRefund` recorded `'failed'`** — indistinguishable from a real failure —
  returned `true` without refunding anything when no payment intent was present, and was
  not idempotent, so a retry issued a second Stripe refund.
- **Revenue pool recipients were validated individually but not in aggregate**, so a pool
  could be configured to distribute more than 100% of what it received.
- **`recordDistribution` had no idempotency on `txHash`**, so a reorg or retried indexer
  double-counted revenue.
- **`getConversion` / `listConversions` returned live internal references**, letting a
  caller mutate a financial record.

### #1186 — Strengthen payment security

- Every `/api/v1/payouts` route, **including reads**, requires an authenticated approver
  principal. The check runs before any lookup, so an unauthenticated caller cannot probe
  batch existence from the status code.
- `Idempotency-Key` on every money-moving route. A key reused with a **different** body
  is rejected with `409 idempotency_key_reuse_mismatch` instead of silently replaying the
  earlier response — previously a caller could believe it created a new resource while
  holding the old one.
- Strict allowlists (asset, schedule cadence) and bounded amounts and identifiers.
- The asset allowlist and amount ceiling are enforced in the **engine** as well as the
  route, so a caller reaching the engine directly is not less protected.
- Route-scoped rate limits: 120/min for the router, 30/min for approval decisions.
- Engine errors are mapped to sanitised HTTP responses; rail text never reaches clients.

### #1183 — Improve documentation

- `docs/PAYOUT_RELIABILITY.md` — lifecycle, retry policy, reservations, events, API, ops runbook.
- `docs/PAYMENT_CORRECTNESS.md` — the money, FX, idempotency and allocation invariants.
- `docs/security/payment-security.md` — authentication, authorization, allowlists, rate limits, audit.
- `docs/README.md` index entries, and `PAYOUT_APPROVALS.md` cross-links.

## Files

| File | Change |
| ---- | ------ |
| `backend/src/services/money.ts` | new — decimal-safe money arithmetic |
| `backend/src/services/payouts/payout-engine.ts` | execution, retry, cadence, events, limits |
| `backend/src/services/fiat-crypto.ts` | pair validation, amount validation, exact conversion, refund semantics |
| `backend/src/services/revenue-pool/index.ts` | allocation ceiling, distribution idempotency |
| `backend/src/middleware/idempotency.ts` | payload fingerprinting, bounded cache |
| `backend/src/routes/payouts.ts` | new — `/api/v1/payouts` |
| `backend/src/routes/stripe.ts` | unsupported-pair and settlement guards |
| `backend/src/index.ts` | mount the payouts router |
| `backend/src/**/__tests__/*` | new and updated tests |
| `docs/PAYOUT_RELIABILITY.md`, `docs/PAYMENT_CORRECTNESS.md`, `docs/security/payment-security.md` | new |

## Tests

- `services/__tests__/money.test.ts` (new) — parsing, rounding, exact rate application.
- `services/payouts/__tests__/payout-engine.test.ts` — execution, backoff growth,
  attempt exhaustion, reservation release, cadence, cycle keys, event emission,
  per-merchant isolation, concurrency collapse.
- `services/__tests__/fiat-crypto.test.ts` — unquoted pairs, amount validation, exact
  conversion, refund state and idempotency, deterministic settlement references, snapshot
  isolation.
- `services/revenue-pool/__tests__/revenue-pool.test.ts` (new) — allocation ceiling on
  add and update, distribution replay.
- `middleware/__tests__/idempotency.test.ts` — fingerprint mismatch, key ordering,
  nested payloads, cache eviction.
- `routes/__tests__/payouts.test.ts` (new) — auth on every route, validation, idempotency
  replay and mismatch, approve/reject lifecycle, rate limiting.

## Verification

`npm run test --workspace backend`, `npm run lint --workspace backend` and
`npm run test:docs` are the relevant commands. **Note:** this change set was authored in an
environment without a Node runtime, so the suites were not executed locally — CI is the
first run. The changes were reviewed by hand against the existing suites, and the two
pre-existing payout tests that assert the old "no execution" behaviour were updated to the
new contract.