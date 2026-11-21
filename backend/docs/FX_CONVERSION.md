# Multi-Currency Invoices & FX Conversion

Issue #626. Adds multi-currency invoice presentment on top of the existing
single-currency invoice generator: a merchant still settles in one currency
(`amount`/`currency` on the `Invoice` model, `total`/`currency` on the
legacy in-memory `InvoiceRecord`), but the customer-facing invoice can be
*presented* in a different currency, with the FX rate looked up, cached, and
locked at generation time — and re-locked at payment time.

Service: `backend/src/services/fx/fx-service.ts` (`FxService`, singleton
`fxService` from `backend/src/services/fx/index.ts`).
Routes: `backend/src/routes/fx.ts` (`fxRouter`, intended mount:
`/api/v1/fx` — see "Mounting" below).
Invoice integration: `backend/src/services/invoice.ts` /
`backend/src/routes/invoice.ts`.
Tests: `backend/src/services/__tests__/fx-service.test.ts`.

## Design: rate cache with TTL, backed by history

Every fetched rate is written as a **new row** in `FxRate` (base, quote,
rate, source, `fetchedAt`, `expiresAt`) rather than upserted in place. This
means:

- **Caching** is just "find the newest non-expired row for this pair."
- **History** is free — it's the same table, just queried without the
  `expiresAt` filter and ordered by `fetchedAt`.

`FxService.getRate(base, quote)`:

1. If `base === quote`, returns an identity rate of `1` without touching
   storage or the fetcher.
2. Looks for a cached row where `expiresAt > now`. If found, returns it
   (no fetch).
3. Otherwise calls the injected `fetchRate(base, quote)`, validates the
   result (`> 0`, finite), evaluates rate alerts for the pair (see below)
   against the previously-cached rate, stores the new rate as a fresh
   `FxRate` row with `expiresAt = now + ttlMs`, and returns it.

Default TTL is **5 minutes** (`DEFAULT_TTL_MS` in `fx-service.ts`), overridable
per-instance via `new FxService({ ttlMs })`.

### Postgres vs. in-memory fallback

Like `services/archival/archival-service.ts`, `FxService` gates all
persistence behind `usePrisma() { return Boolean(process.env.DATABASE_URL) }`.
When `DATABASE_URL` is unset (e.g. this repo's default test run), rates and
alerts are kept in in-memory arrays scoped to the `FxService` instance
instead of the `FxRate`/`FxRateAlert` tables — so the whole service, and
anything built on it (multi-currency invoices), is unit-testable without a
live Postgres connection. Call `resetForTests()` to clear in-memory state
between tests.

## Pluggable rate source

There is no live market-data provider configured in this repo. `FxService`
accepts an injectable fetcher:

```ts
export type RateFetcher = (base: string, quote: string) => Promise<number>;

new FxService({ fetchRate: myRealProvider });
```

The default (`defaultFetchRate`, also exported) is a **placeholder**: a
small static table for common pairs (USD/EUR/GBP/XLM) plus a deterministic
(non-random, hash-based) fallback for unlisted pairs, so repeated lookups
for the same unknown pair are stable rather than jittering on every call.
**This is not a real feed and must not be used in production.**

To swap in a real provider (e.g. exchangerate.host, Open Exchange Rates,
currencylayer, or a Stellar path-payment quote), implement `RateFetcher` and
either:

- construct a dedicated `FxService` instance with it (`new FxService({ fetchRate })`), or
- edit `getFxService()` in `backend/src/services/fx/index.ts` to pass it
  into the shared singleton.

```ts
const fetchFromExchangerateHost: RateFetcher = async (base, quote) => {
  const res = await fetch(`https://api.exchangerate.host/convert?from=${base}&to=${quote}`);
  const json = await res.json();
  return json.result;
};
```

## Conversion

`FxService.convert(amount, base, quote)` calls `getRate` and returns:

```ts
interface FxConversion {
  amount: number;
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  convertedAmount: number; // amount * rate, rounded to 8 decimal places
  source: string;
  fetchedAt: Date;
  expiresAt: Date; // cache metadata — when this rate will next be refetched
}
```

## History

`FxService.getHistory(base, quote, { since?, until? })` returns matching
`FxRate` rows for the pair, **oldest first**, optionally bounded by
`fetchedAt`.

## Rate alerts

`FxRateAlert` rows (`tenantId`, `baseCurrency`, `quoteCurrency`,
`thresholdPct`, `direction: 'up' | 'down' | 'both'`, `active`) describe a
threshold to watch. Whenever `getRate` performs a **fresh fetch** (cache
miss/expiry — not a cache hit), it calls `checkAlerts(base, quote, newRate)`
before storing the new rate:

1. Look up the rate currently cached for the pair (the "last cached rate" —
   this is still the *old* value at this point, since the new one hasn't
   been stored yet).
2. Compute `pctChange = (newRate - lastCached) / lastCached * 100`.
3. For every **active** alert on that pair: it triggers if
   `direction === 'up' && pctChange >= thresholdPct`, or
   `direction === 'down' && pctChange <= -thresholdPct`, or
   `direction === 'both'` and either of the above.
4. Triggered alerts get `lastTriggeredAt`/`lastTriggeredRate` updated and
   are returned.

If there is no prior cached rate for the pair yet, `checkAlerts` returns an
empty list (nothing to compare against). `checkAlerts` can also be called
directly (e.g. from a monitoring job) — it does not require going through
`getRate`.

CRUD: `createAlert`, `listAlerts({ tenantId?, baseCurrency?, quoteCurrency?, activeOnly? })`,
`deactivateAlert(id)` (sets `active = false`; does not delete the row).

## Multi-currency invoices

The existing invoice generator (`backend/src/services/invoice.ts`,
`generateInvoice`) is in-memory and settles in a fixed `currency` (`'USD'`).
Issue #626 extends `InvoiceRecord` with the same presentment fields already
migrated onto the Prisma `Invoice` model (`presentmentCurrency`,
`presentmentAmount`, `fxRate`, `fxRateLockedAt`):

```ts
interface InvoiceRequest {
  // ...existing fields...
  presentmentCurrency?: string; // customer-facing display currency
}
```

When `presentmentCurrency` is supplied and differs from the settlement
currency, `generateInvoice` calls `fxService.convert(total, currency,
presentmentCurrency)` and locks the result onto the invoice:
`presentmentAmount`, `fxRate`, `fxRateLockedAt` (ISO timestamp of when the
lock happened, not the underlying rate's `fetchedAt`).

### Re-locking at payment time

The rate locked at generation time may have expired (past its TTL) or moved
by the time the invoice is actually paid. `reconvertInvoiceFxAtPayment(invoiceId, presentmentCurrency?)`
re-runs the conversion and overwrites the invoice's FX fields — it does
**not** touch payment processing/webhook handling, only the invoice's stored
FX snapshot. Call it:

- from a payment webhook/handler right before marking an invoice paid, or
- via `POST /api/v1/invoice/:id/convert` (see below) to lock or re-lock on
  demand.

### Multi-currency reporting

`generateMultiCurrencyReport({ merchantId? })` aggregates invoices by
`(currency, presentmentCurrency)` pair: invoice count, total settlement
amount, total presentment amount, and average locked FX rate per pair.
Single-currency invoices (no `presentmentCurrency` set) appear as a
`currency === presentmentCurrency` pair.

## HTTP API

### `/api/v1/fx/*` (`fxRouter`)

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/rates?base=USD&quote=EUR` | — | Current cached/fresh rate for a pair |
| POST | `/convert` | `{ amount, base, quote }` | Converted amount + rate metadata |
| GET | `/history?base=USD&quote=EUR&since=&until=` | — | Historical cached rates (oldest first) |
| POST | `/alerts` | `{ tenantId, baseCurrency, quoteCurrency, thresholdPct, direction? }` | Create a rate alert |
| GET | `/alerts?tenantId=&base=&quote=&activeOnly=true` | — | List alerts |
| DELETE | `/alerts/:id` | — | Deactivate an alert |

Examples:

```bash
curl "http://localhost:3000/api/v1/fx/rates?base=USD&quote=EUR"
# { "data": { "id": "...", "baseCurrency": "USD", "quoteCurrency": "EUR", "rate": 0.92, "source": "mock-static-table", "fetchedAt": "...", "expiresAt": "...", "createdAt": "..." } }

curl -X POST http://localhost:3000/api/v1/fx/convert \
  -H 'content-type: application/json' \
  -d '{"amount": 100, "base": "USD", "quote": "EUR"}'
# { "data": { "amount": 100, "baseCurrency": "USD", "quoteCurrency": "EUR", "rate": 0.92, "convertedAmount": 92, ... } }

curl -X POST http://localhost:3000/api/v1/fx/alerts \
  -H 'content-type: application/json' \
  -d '{"tenantId": "t1", "baseCurrency": "USD", "quoteCurrency": "EUR", "thresholdPct": 5, "direction": "both"}'
```

**Note on mounting:** this task's file ownership excludes `src/index.ts`, so
`fxRouter` is implemented but not yet wired into the Express app. To enable
it, add in `backend/src/index.ts`:

```ts
import { fxRouter } from './routes/fx.js';
// ...
apiV1Router.use('/fx', fxRouter);
```

### `/api/v1/invoice/*` additions (`invoiceRouter`)

| Method | Path | Body / Query | Description |
|---|---|---|---|
| POST | `/generate/multi-currency` | `{ projectId, merchantId, workDescription, hoursWorked?, hourlyRate?, countryCode?, presentmentCurrency }` | Generate an invoice with FX locked at creation |
| POST | `/:id/convert` | `{ presentmentCurrency? }` | Lock/re-lock the FX rate for an existing invoice (e.g. at payment time) |
| GET | `/reporting/multi-currency?merchantId=` | — | Aggregate report by currency/presentment-currency pair |

`presentmentCurrency` was deliberately **not** added to the existing
`invoiceSchema` (`backend/src/schemas/index.ts`, used by `POST
/generate`) — that file is shared with other in-flight work, and
`validate()` strips any body field a schema doesn't declare, so extending it
here would have silently dropped the field for every other consumer of that
schema in the meantime. `POST /generate/multi-currency` does its own inline
validation instead, mirroring the style of `routes/tax.ts`'s `/track`
endpoint.

Examples:

```bash
curl -X POST http://localhost:3000/api/v1/invoice/generate/multi-currency \
  -H 'content-type: application/json' \
  -d '{
    "projectId": "proj_1",
    "merchantId": "merchant_1",
    "workDescription": "Website redesign",
    "hoursWorked": 10,
    "hourlyRate": 150,
    "countryCode": "GB",
    "presentmentCurrency": "EUR"
  }'
# invoice.presentmentCurrency = "EUR", presentmentAmount, fxRate, fxRateLockedAt all set

curl -X POST http://localhost:3000/api/v1/invoice/inv_.../convert \
  -H 'content-type: application/json' \
  -d '{}'
# re-locks against the invoice's existing presentmentCurrency using the current rate

curl "http://localhost:3000/api/v1/invoice/reporting/multi-currency?merchantId=merchant_1"
# { "data": { "rows": [{ "currency": "USD", "presentmentCurrency": "EUR", "invoiceCount": 3, "totalSettlement": 450, "totalPresentment": 414, "averageFxRate": 0.92 }], "totalInvoices": 5, "multiCurrencyInvoices": 3 } }
```
