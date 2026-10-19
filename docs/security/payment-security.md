# Payment and Payout Security

Controls on the endpoints that move money. Covers the payout API (`/api/v1/payouts`) and
the fiat conversion endpoints on `/api/v1/stripe`.

## Authentication

Every `/api/v1/payouts` route — including reads — requires an authenticated principal.
Unauthenticated requests are rejected with `401 ERR_AUTH_UNAUTHENTICATED` **before** any
lookup runs, so an anonymous caller cannot use the status code to probe which batch ids
exist.

The principal is resolved from `req.user` (populated by the auth middleware) or, for
service-to-service calls, from the `x-actor-id` / `x-actor-role` headers. See
[withdrawal approval security](../WITHDRAWAL_SECURITY.md) for the equivalent controls on
withdrawals.

## Authorization

Only these roles may approve, reject, retry or release a payout:

| Role                | Approve | Reject | Retry | Release |
| ------------------- | ------- | ------ | ----- | ------- |
| `finance_approver`  | Yes     | Yes    | Yes   | Yes     |
| `admin`             | Yes     | Yes    | Yes   | Yes     |
| anything else       | No      | No     | No    | No      |

The check is enforced twice: the route rejects a principal without an approver role, and
`PayoutEngine` re-checks the role on every decision. A caller that reaches the engine by
another path still cannot move money without an approver role.

## Idempotency

All money-moving routes accept `Idempotency-Key`. Replaying a request with the same key and
the same body returns the original response instead of creating a second payout.

Reusing a key with a **different** body is rejected with `409` and the request is not
applied. See [payment correctness](../PAYMENT_CORRECTNESS.md#an-idempotency-key-is-bound-to-one-payload).

## Input validation and allowlists

| Field             | Rule                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| `preferredAsset`  | Must be one of `USDC`, `USDT`, `XLM`, `EURC`.                         |
| `scheduleType`    | Must be `daily`, `weekly`, `monthly` or `threshold`.                   |
| `thresholdAmount` | Required and positive for `threshold`; rejected for other cadences.    |
| `autoApproveLimit`| Non-negative finite number.                                           |
| `amount`          | Positive, finite, at most `1_000_000`.                                 |
| Identifiers       | Non-empty strings, at most 128 characters.                             |

The asset allowlist and the amount ceiling are enforced **in the engine as well as the
route**, so a caller that reaches `PayoutEngine` directly cannot pay an unlisted asset or
an unbounded amount.

## Rate limiting

The payouts router carries its own ceilings **on top of** the global `/api` limiter
(100 requests per 15 minutes per IP), so payout traffic stays bounded even if the global
limit is raised for general API traffic:

| Scope                                 | Limit                |
| ------------------------------------- | -------------------- |
| Every `/api/v1/payouts` route          | 120 requests / minute |
| `approve`, `reject`, `retry`, `release`| 30 requests / minute  |

`evaluate` and `retries` fan out to the settlement rail, so an unthrottled caller can turn
a rail hiccup into a payout stampede. Approval decisions are rarer than reads and are
given a tighter ceiling because each one moves money.

Exceeding either ceiling returns `429 ERR_RATE_LIMIT_EXCEEDED`.

## Error handling

The engine throws bare sentinel codes (`UNSUPPORTED_PAYOUT_ASSET`,
`PAYOUT_AMOUNT_EXCEEDED`, ...) so it stays transport-agnostic. `routes/payouts.ts` maps
them to HTTP responses with a generic message. Rail error text never reaches the client,
and the stack is only included outside production by the shared `errorHandler`.

## Audit

Every decision that moves money is recorded with the actor id, and payout batches carry
their own audit trail:

```text
created -> approved -> executing -> settled
                   -> rejected  (funds released)
```

Settlement failures are recorded too, with the reason. `payout.failed` events are the alert
signal; see [payout reliability](../PAYOUT_RELIABILITY.md#operating-the-queue).

## Settlement rail

- The rail must be handed the batch's `idempotencyKey` so it can deduplicate a retry.
- The engine treats a missing `transactionHash` as a failed attempt, so a rail that
  acknowledges without confirming cannot mark a payout settled.
- Exhausted retries keep the reservation instead of re-queueing it, which prevents an
  unattended retry loop against a failing rail.

## Rate locks and conversions

- A rate lock is owned by its creator and can be spent exactly once.
- Only quoted currency pairs can be locked or quoted; an unquoted pair is an error, never a
  rate of `1.0`.
- Conversions are capped at `MAX_FIAT_CONVERSION_AMOUNT`.
- Settlement destinations must match the Stellar address format, and settlement
  references are derived from the transfer inputs so they reconcile against the chain.

## See also

- [Webhook signature verification](webhook-signatures.md)
- [Withdrawal approval security](../WITHDRAWAL_SECURITY.md)
- [Security policy](../security-policy.md)