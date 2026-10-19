# Instant Account-to-Account Transfers

Issue: [#913](https://github.com/Smartdevs17/agenticpay/issues/913)

Real-time transfers between two registered accounts, with short-lived quotes,
idempotent initiation, velocity limits, cancellation and reversals.

## Backend

Service: `backend/src/services/transfers.ts`
Routes: `backend/src/routes/transfers.ts` (mounted at `/api/v1/transfers`)

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/accounts` | Register an account (currency, status, holder) |
| `POST` | `/quotes` | Lock the fee and FX rate for a transfer |
| `POST` | `/transfers` | Initiate a transfer (idempotent) |
| `GET` | `/transfers` | List transfers (`accountId`, `status`, `limit`, `offset`) |
| `GET` | `/transfers/:id` | Read a transfer |
| `POST` | `/transfers/:id/cancel` | Cancel a not-yet-settled transfer |
| `POST` | `/transfers/:id/reverse` | Reverse a completed transfer inside the window |
| `GET` | `/accounts/:id/volume` | Rolling 24h volume for an account |

### Behaviour

- **Quotes** live for 60 seconds (`quoteTtlMs`) and lock the fee and FX rate.
  The fee is 0.5% of the amount with a 0.50 floor and 25.00 cap.
- **Idempotency** — reusing an `idempotencyKey` (body or `Idempotency-Key`
  header) returns the original transfer instead of moving money twice.
- **Limits** — 25,000 per transfer and 100,000 per source account per rolling
  24 hours by default (`DEFAULT_TRANSFER_LIMITS`).
- **Settlement** — same-currency instant-rail transfers settle synchronously
  and return `completed`. Transfers with a future `scheduledFor` stay `pending`
  on the standard rail and can be cancelled.
- **Reversals** are allowed for 24 hours after settlement.

## Tests

`backend/src/services/__tests__/instant-transfers.test.ts`
