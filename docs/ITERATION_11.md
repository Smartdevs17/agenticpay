# Iteration 11 Delivery Index

This iteration consolidates the operational documentation and verification
entry points for gateway integrations, payment correctness, and payout
reliability. The implementation is intentionally linked to the existing
services and tests so future changes remain reviewable.

## Gateway integrations

- Gateway routing and fallback behavior: [`PAYMENT_ROUTING.md`](PAYMENT_ROUTING.md)
- Provider-specific circuit breaking and degraded responses:
  [`CIRCUIT_BREAKER.md`](CIRCUIT_BREAKER.md)
- Webhook authentication and replay protection:
  [`../WEBHOOK_VERIFICATION.md`](../WEBHOOK_VERIFICATION.md)

When adding a provider, cover quote creation, timeout behavior, provider
failure mapping, and idempotent retry behavior in the provider test suite.

## Payment correctness

- Payment reconciliation and mismatch handling:
  [`PAYMENT_RECONCILIATION.md`](PAYMENT_RECONCILIATION.md)
- Split allocation invariants:
  [`SPLIT_PAYMENTS.md`](SPLIT_PAYMENTS.md)
- Refund and settlement behavior:
  [`REFUND_ENGINE.md`](REFUND_ENGINE.md)

The minimum correctness checks are conservation of value, a single terminal
state transition, idempotent replay of the same request, and preservation of
the original payment identifier in emitted events.

## Payout reliability

- Retry, backoff, and dead-letter behavior:
  [`PAYOUT_RELIABILITY.md`](PAYOUT_RELIABILITY.md)
- Approval gates and operator recovery:
  [`PAYOUT_APPROVALS.md`](PAYOUT_APPROVALS.md)
- Background job operation:
  [`JOB_QUEUE.md`](JOB_QUEUE.md)

Reliability changes must include a failure injection test, a bounded retry
policy, and an operator-visible terminal state. Do not retry a request unless
the provider operation is idempotent or its outcome can be reconciled safely.

## Verification

Run the repository checks from the root before merging:

```bash
npm test
npm run lint
npm run typecheck
```

Backend-only changes should also run the targeted backend test project. Update
the linked document when an endpoint, provider contract, or recovery state
changes.
