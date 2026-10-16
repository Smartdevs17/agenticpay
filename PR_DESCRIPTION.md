# Docs, payment correctness, payout reliability, and withdrawal security (#1258–#1261)

Closes #1258
Closes #1259
Closes #1260
Closes #1261

## Scope

This PR delivers one focused increment for each issue, in issue order:

### #1258 — Documentation discovery

- Adds `docs/README.md` as a curated entry point for contributor, payment, SDK, operations, and security guides.
- Links the root README to the index.
- Adds a dependency-free Node test that verifies every local link in the index exists, and runs it from the root `test` command.

### #1259 — Payment amount correctness

- Rejects non-finite, zero, and negative amounts at the shared payment-provider router boundary.
- Returns `INVALID_PAYMENT_AMOUNT` with status `400` before invoking or recording metrics for any provider.
- Documents amount validation and provider selection/fallback behavior.

### #1260 — Payout state reliability

- Rejects negative and non-finite pending payout balances.
- Returns defensive copies from payout evaluation, history, and audit APIs, including cloned `Date` values.
- Prevents callers from corrupting authoritative payout status, amount, or audit state by mutating returned objects.
- Updates the payout approval guide with the new state-integrity guarantees.

### #1261 — Withdrawal decision security

- Applies the configured approver allowlist to rejection as well as approval.
- Fails closed when a non-allowlisted withdrawal has no configured approvers.
- Documents approver configuration, the API identity trust boundary, and velocity controls.

## Tests

- `npm run test:docs`
- `npm --workspace backend test -- src/services/payments/__tests__/payment-router.test.ts src/services/payouts/__tests__/payout-engine.test.ts src/services/__tests__/issues-456-459.test.ts src/services/__tests__/withdrawal-allowlist.test.ts`
- `npm run lint`
- `npm run build`

New regression coverage includes invalid payment amounts, invalid payout balances, mutation isolation for payout/audit snapshots, missing withdrawal approvers, unauthorized withdrawal rejection, and documentation link integrity.
