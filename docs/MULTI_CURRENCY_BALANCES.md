# Multi-currency wallet balances

Balances are tracked **per currency**, not as a single blended number, so an XLM
balance can never be spent as USDC.

## Isolation

`WalletAggregationService.getAggregatedBalance(userId)` returns a `byCurrency`
array. Each entry is one currency with:

- `currency` — the currency code,
- `amount` — the sum of that currency across every chain that holds it,
- `balanceUSD` — that currency's USD value,
- `chains` — which chains contributed,
- `includesNative` — whether a native (gas) balance is part of the entry.

`getCurrencyBalance(userId, currency)` returns a single isolated balance, or
`undefined` when the user holds none — "no balance" is never silently coerced into
`0` of a different currency.

## Reporting

`getBalancesByCurrency(userId)` returns the per-currency report plus the aggregate
`totalUSD` headline, so reports can aggregate by currency while still showing a
single portfolio figure.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/v1/wallet/aggregated` | All chains plus `byCurrency` |
| `GET` | `/api/v1/wallet/balances` | Per-currency report |
| `GET` | `/api/v1/wallet/balances?currency=usdc` | One isolated currency (404 if none) |

## UI

`frontend/components/wallet/WalletManager.tsx` renders a **Balances by Currency**
table from `aggregatedBalance.byCurrency`, alongside the per-chain breakdown and
the USD headline. The wallet slice lives in `frontend/store/web3Store.ts`
(`fetchAggregatedBalance`).

## Tests

`backend/src/services/__tests__/wallet-multi-currency.test.ts` asserts that
currencies are isolated, the same symbol on two chains is summed with both chains
recorded, a single currency can be fetched without leaking others, and an empty
wallet returns no currencies.
