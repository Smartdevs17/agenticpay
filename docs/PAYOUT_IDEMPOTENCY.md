# Payout idempotency

Retries must never create a second payout. Payout creation is protected at two
layers.

## 1. HTTP middleware

`idempotency()` (`backend/src/middleware/idempotency.ts`) is applied to every
money-moving route. When a request carries `Idempotency-Key` (or the legacy
`X-Idempotency-Key`):

- the first request's response is cached for **24 hours**,
- a replay with the same body returns the original response and status code,
- reusing the key with a **different** body is rejected with
  `409 idempotency_key_reuse_mismatch`,
- a concurrent request with the same key that is still in flight is rejected with
  `409 idempotency_key_in_use`.

`purgeExpiredIdempotencyKeys()` — intended to run from a scheduled job — drops
expired entries so memory stays bounded.

## 2. Service-level store

The middleware cache can be evicted (process restart, TTL, memory ceiling). The
payout batcher keeps its own TTL-bounded idempotency store
(`backend/src/services/payouts/payout-idempotency.ts`) so a retry that arrives
after the cache is gone still returns the **original** scheduled payout.

`POST /api/v1/payouts/scheduled` passes the `Idempotency-Key` header through to
`PayoutBatcher.schedule()`, which:

- fingerprints the normalised request body,
- returns the original payout for a replayed key,
- throws `IDEMPOTENCY_KEY_REUSE_MISMATCH` when the key is reused with a different
  body (mapped to `409`),
- remembers keys for 24 hours by default (`idempotencyTtlMs` option) and caps the
  store so a flood of unique keys cannot exhaust memory.

Expired keys are dropped by `PayoutBatcher.purgeExpiredIdempotencyKeys()`.

## Tests

- `backend/src/middleware/__tests__/idempotency.test.ts` — replay, mismatch,
  in-flight collision, eviction.
- `backend/src/services/payouts/__tests__/payout-idempotency.test.ts` — store
  semantics and the batcher integration, including TTL expiry and body mismatch.
