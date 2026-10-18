# Nano (XNO) Settle Rail

Issue: **#1004 — A Nano (XNO) settle rail: escrow release and instant payment as one feeless block**

AgenticPay's escrow model is rail-agnostic: something holds funds until a
milestone is approved, then a single release moves them. On Stellar/Soroban that
release is a contract call. On **Nano (XNO)** the same "hold then release" is two
feeless sends, with no smart-contract execution, no gas and no submission fee.

- `hold` — one feeless send from the payer to the escrow/agent account.
- `release` — one feeless send from the escrow/agent account to the payee.

The release block **is** the confirmation: it is final in roughly a second, and
because the ledger is the public receipt, an independent party can verify the
destination, amount and ordering of the transfer without trusting either party.
No Horizon-style indexer is required.

## Implementation

| Layer | Location |
| --- | --- |
| Rail | `backend/src/services/settlement/nano-settle-rail.ts` |
| HTTP API | `backend/src/routes/nano.ts` (mounted at `/api/v1/nano`) |
| Tests | `backend/src/services/settlement/__tests__/nano-settle-rail.test.ts` |

`resolveSettlementRail(asset)` returns `'nano'` for `XNO` and `'stellar'`
otherwise, so a payment can select the rail next to the existing Soroban escrow
path.

## Amounts and addresses

- Nano amounts are expressed as decimal XNO. The smallest unit, *raw*, is
  `10^-30` XNO. Helpers: `xnoToRaw()` and `rawToXno()`.
- Addresses are validated with `isValidNanoAddress()` (`nano_`/`xrb_` plus 60
  base32 characters).

## API

### `GET /api/v1/nano/status`

Returns `rail: "nano"`, `ticker: "XNO"`, `feeless: true`, the simulated
`finalityMs`, the supported rail list, and rail metrics.

### `POST /api/v1/nano/escrows` — hold

```json
{
  "payer": "nano_3111...hifc8npp",
  "payee": "nano_3t6k35gi...uohr3",
  "amountXno": 25,
  "idempotencyKey": "milestone-42",
  "metadata": { "projectId": "proj_1" }
}
```

Returns `201` with a `NanoEscrow` containing the `holdBlock`. An
`idempotencyKey` replays the original hold; reusing it with different details
fails with `IDEMPOTENCY_KEY_REUSE_MISMATCH`.

### `POST /api/v1/nano/escrows/:id/release` — release

```json
{ "approvedBy": "agent-7" }
```

Creates the release send block, marks the escrow `released`, and is idempotent —
calling it again returns the same block and never double-credits the payee.

### `POST /api/v1/nano/escrows/:id/refund` — refund

```json
{ "reason": "milestone rejected" }
```

Sends the held amount back to the payer.

### Read endpoints

- `GET /api/v1/nano/escrows?status=&payer=&payee=` — list escrows.
- `GET /api/v1/nano/escrows/:id` — fetch an escrow.
- `GET /api/v1/nano/escrows/:id/receipt` — verify the public release receipt
  (`verified`, destination, amount, `feeless`, `finalityMs`, explorer hint).
- `GET /api/v1/nano/blocks/:hash` — look up any hold/release/refund block.
- `POST /api/v1/nano/fund` — sandbox/faucet helper to fund a simulated account.

## Notes and limitations

- Block hashes and signatures are **deterministic simulations** so the rail can
  be unit tested offline; real broadcast uses Nano's `block_create`/`process`
  RPC and BLAKE2b signatures. Wire `NanoSettleRail` to a node for production.
- The escrow/agent account and balances are held in memory for this
  implementation; persist them alongside the existing escrow records.
- Nano transfers are feeless regardless of amount; `getMetrics()` reports
  `feesCollectedRaw: "0"`.
