# Cross-Border Payments (#920)

Send payments across borders with automatic FX conversion, transparent fees,
and corridor-aware settlement rails.

The feature has two layers:

- **FX rates** — `services/fx` (issue #626) supplies cached, auditable
  mid-market rates for every conversion.
- **Cross-border orchestration** — `services/cross-border` prices a corridor
  (fees, recipient amount, settlement estimate), holds the rate in a quote,
  and turns quotes into payments that a settlement rail completes or fails.

## Flow

```
POST /api/v1/cross-border/quote      → quote (rate held for 2 minutes)
POST /api/v1/cross-border/payments   → payment (status: processing)
POST /api/v1/cross-border/payments/:id/complete → payment (status: completed)
POST /api/v1/cross-border/payments/:id/fail     → payment (status: failed)
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/v1/cross-border/corridors` | Supported corridors with limits, fees, and rails |
| `POST` | `/api/v1/cross-border/quote` | Price a transfer |
| `GET`  | `/api/v1/cross-border/quotes/:id` | Fetch a quote |
| `POST` | `/api/v1/cross-border/payments` | Create a payment from a quote |
| `GET`  | `/api/v1/cross-border/payments` | List payments (`senderId`, `recipientId`, `status`) |
| `GET`  | `/api/v1/cross-border/payments/:id` | Fetch a payment |
| `POST` | `/api/v1/cross-border/payments/:id/complete` | Settlement success (`txHash`) |
| `POST` | `/api/v1/cross-border/payments/:id/fail` | Settlement failure (`reason`) |

FX rates and conversion remain available directly at `/api/v1/fx`
(see `backend/docs/FX_CONVERSION.md`).

## Pricing model

```
fxFee           = sourceAmount × corridor.fxFeePct
fees.total      = fxFee + corridor.fixedFee
convertible     = sourceAmount − fees.total
targetAmount    = convertible × fxRate
```

Quotes can be requested in two modes:

- `mode: "source"` (default) — `amount` is what the sender is debited.
- `mode: "target"` — `amount` is what the recipient should receive; the
  required source amount is solved for (`(target/rate + fixedFee) / (1 − fxFeePct)`).

Amounts are rounded to the currency's minor units (2 decimals for fiat,
7 for crypto such as XLM).

### Example

```bash
curl -X POST http://localhost:3001/api/v1/cross-border/quote \
  -H 'Content-Type: application/json' \
  -d '{ "amount": 100, "sourceCurrency": "USD", "targetCurrency": "EUR" }'
```

```json
{
  "data": {
    "corridorId": "USD:EUR",
    "rail": "sepa",
    "sourceAmount": 100,
    "rate": 0.92,
    "fees": { "fxFee": 0.5, "fixedFee": 1.5, "total": 2 },
    "convertibleAmount": 98,
    "targetAmount": 90.16,
    "expiresAt": "2026-01-01T00:02:00.000Z"
  }
}
```

## Corridors

| Corridor | Rail | Fee | Settlement |
|----------|------|-----|------------|
| USD→EUR / GBP→EUR | SEPA | 0.5% + 1.5 | ~60 min |
| USD→GBP / EUR→GBP | Faster Payments | 0.5% + 1.5 | ~30 min |
| EUR→USD / GBP→USD | ACH | 0.5% + 2 | ~4 h |
| USD/EUR/GBP→XLM | Stellar | 0.3% + 0.5 | ~5 min |
| XLM→USD/EUR/GBP | Stellar | 0.3% + 0.5 | ~5 min |

Unsupported pairs return `422 CORRIDOR_NOT_SUPPORTED`; amounts outside a
corridor's `minAmount`/`maxAmount` return `422 AMOUNT_OUT_OF_RANGE`.

## Idempotency & rate holds

- Quotes expire after `quoteTtlMs` (default 2 minutes). Consuming an expired
  quote returns `409 QUOTE_EXPIRED`.
- `POST /payments` accepts an `idempotencyKey`; replaying the same key returns
  the original payment instead of debiting twice.
- Payments move `processing → completed | failed`; invalid transitions return
  `409 CONFLICT`.

## Persistence

`CrossBorderPaymentService` uses an in-memory store, matching the testability
convention of `services/fx` and `services/archival`. Swap the store for Prisma
models once `CrossBorderPayment`/`CrossBorderQuote` tables are added.

## Tests

`backend/src/services/__tests__/cross-border-service.test.ts` covers corridor
lookups, source/target quoting, fee math, limits, expiry, idempotency, and
payment status transitions.
