# Payment webhook correctness (#1174)

This increment protects fiat payment state against duplicate and out-of-order bank webhook delivery.

- Duplicate state notifications have no timestamp or event-history side effects.
- Only `processing -> settled/failed/returned` and `settled -> returned` are accepted.
- Provider events cannot bypass manual approval or compliance holds.
- Invalid transitions raise `INVALID_PAYMENT_STATUS_TRANSITION`.

Run regression tests from `backend`:

```sh
npx vitest run src/services/__tests__/fiat-webhook-correctness.test.ts
```

Operational note: The webhook HTTP handler should translate invalid transitions to a suitable permanent response or acknowledgement to avoid repeated provider redelivery.
