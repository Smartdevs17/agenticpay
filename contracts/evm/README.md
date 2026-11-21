# AgenticPay — EVM contracts & deployment automation

Hardhat workspace for the Solidity side of AgenticPay. The original
reference `Splitter.sol` lived at `contracts/Splitter.sol`; it has been
superseded by a UUPS-upgradeable implementation here, driven through
OpenZeppelin's upgrades plugin.

## What's in here

```
contracts/
  SplitterV1.sol          # Upgradeable Splitter (current production impl)
  SplitterV2.sol          # Example upgrade (pause switch) — exercises the
                          # upgrade path in tests
  test/BadSplitterV2.sol  # Negative test: storage layout intentionally broken
scripts/
  deploy.ts               # First-time UUPS deployment via hardhat-upgrades
  deploy-create2.ts       # Deterministic deploy via ImmutableCreate2Factory
  upgrade.ts              # Validate + upgrade (or --propose for multisig)
  verify.ts               # Etherscan (and compatible) verification
  propose-safe-upgrade.ts # Prints a Gnosis Safe payload for the upgrade
  rollback.ts             # Revert the proxy to any prior impl from history
  list-deployments.ts     # Print the full deployment history
  lib/deployment-store.ts # Shared JSON state helpers (see `deployments/`)
  lib/network.ts          # Network resolution helpers
test/
  Splitter.test.ts        # V1 behaviour, access control, edge cases
  Upgrade.test.ts         # V1→V2 state preservation, storage safety, rollback
  DeploymentStore.test.ts # Unit tests for the state helpers
deployments/              # <network>.json — committed deployment state
hardhat.config.ts         # Multi-network RPCs + Etherscan v2 unified key
```

## Quick start

```bash
cd contracts/evm

# install + compile + test
npm install
npm run compile
npm test               # 24 tests
npm run coverage       # solidity-coverage

# deploy to a persistent network (env-driven — see .env.example)
export DEPLOYER_PRIVATE_KEY=0x…
export SEPOLIA_RPC_URL=https://…
npm run deploy -- --network sepolia

# verify on the block explorer
export ETHERSCAN_API_KEY=…
npm run verify:deployment -- --network sepolia

# ship a new implementation
SPLITTER_CONTRACT=SplitterV2 npm run upgrade -- --network sepolia
#   SPLITTER_CALL=initializeV2  # optional post-upgrade initializer

# or prepare the upgrade without executing (produces Safe calldata)
SPLITTER_CONTRACT=SplitterV2 SAFE_ADDRESS=0x… \
  npm run propose:upgrade -- --network sepolia
```

## Environment variables

Copy `.env.example` → `.env` and fill in the networks you want. The config
falls back to dummy placeholders for unconfigured networks so Hardhat can
still parse; actually running a command against an unconfigured network
fails loudly.

| Variable | Notes |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | Signer for every script (never commit) |
| `*_RPC_URL` | Per-network RPC; see `hardhat.config.ts` for full list |
| `ETHERSCAN_API_KEY` | Etherscan v2 unified key; covers every supported chain |
| `POLYGONSCAN_API_KEY`, `ARBISCAN_API_KEY`, ... | Per-chain overrides |
| `CREATE2_FACTORY_ADDRESS` | Defaults to 0age's ImmutableCreate2Factory |
| `SAFE_ADDRESS`, `SAFE_SERVICE_URL`, `SAFE_SIGNER_PRIVATE_KEY` | Safe (multisig) integration |
| `REPORT_GAS`, `COINMARKETCAP_API_KEY` | Enable gas reporter columns |

## Supported networks

Configured out of the box:

- **Mainnet**: `mainnet`, `polygon`, `arbitrum`, `optimism`, `base`
- **Testnet**: `sepolia`, `polygonAmoy`, `arbitrumSepolia`, `optimismSepolia`, `baseSepolia`
- **Local**: `hardhat` (in-process), `localhost` (separate `npx hardhat node`)

Adding a new chain is a five-line change to `hardhat.config.ts`
(`networks` entry + optional `customChains` for non-Etherscan-family
explorers).

## Deployment state

Every write path (`deploy`, `upgrade`, `rollback`) appends a record to
`deployments/<network>.json` and refreshes the `currentImplementation`
pointer. The file is intended to be committed — diffing it is the audit
trail.

```json
{
  "network": "sepolia",
  "chainId": 11155111,
  "contract": "SplitterV2",
  "proxy": "0x…",
  "currentImplementation": "0x…",
  "currentVersion": "2.0.0",
  "history": [
    { "action": "deploy",   "version": "1.0.0", "implementation": "0x…", ... },
    { "action": "upgrade",  "version": "2.0.0", "implementation": "0x…", ... },
    { "action": "rollback", "version": "1.0.0", "implementation": "0x…", ... }
  ]
}
```

`scripts/list-deployments.ts` prints these in a readable format and
`scripts/rollback.ts` consumes them to find the previous implementation
for an emergency revert (`ROLLBACK_TARGET=previous|initial|<index>|<address>`).

Tests isolate themselves via the `AGENTICPAY_DEPLOYMENTS_DIR` env var so
running `npm test` never mutates the committed records.

## CREATE2 (deterministic addresses)

`scripts/deploy-create2.ts` uses
[ImmutableCreate2Factory](https://etherscan.io/address/0x0000000000FFe8B47B3e2130213B802212439497#code)
(deployed on every major EVM chain) for both the implementation and the
proxy. With the same salt + bytecode the script yields the same addresses
across every network, which makes cross-chain allow-listing trivial.

```bash
CREATE2_SALT="agenticpay.splitter.v1.mainnet" \
  npm run deploy:create2 -- --network mainnet
```

The script refuses to run if the factory is not deployed on the target
chain.

## Multisig upgrades (Gnosis Safe)

1. Transfer proxy ownership to the Safe after the initial deploy
   (`splitter.transferOwnership(SAFE_ADDRESS)`).
2. Run `npm run propose:upgrade -- --network <name>` — this compiles the
   new implementation, validates storage safety, deploys only the
   *implementation* (no proxy changes), and prints the `upgradeToAndCall`
   payload plus a Safe Transaction Service JSON body.
3. Submit that payload via the Safe UI / `safe-cli` / `@safe-global/protocol-kit`.
4. Once the Safe executes, refresh local state with `npm run list -- --network <name>`.

Nothing about the on-chain proxy changes until the Safe signers approve
the transaction.

## Rollback

`scripts/rollback.ts` re-points the proxy at a previous implementation.
Because every prior impl address is in the deployment file, rollback is
instantaneous and doesn't require re-compiling the old source.

```bash
# previous impl (default)
npm run rollback -- --network sepolia
# jump back to the very first deploy
ROLLBACK_TARGET=initial npm run rollback -- --network sepolia
# roll back to an exact address
ROLLBACK_TARGET=0xabc… npm run rollback -- --network sepolia
```

The script skips the initializer on the target impl to avoid resetting
state.

## Testing

`npm test` runs three suites:

- **SplitterV1 behaviour** — fees, recipient lifecycle, withdraw, access
  control, `NoPayment` + `InvalidFee` reverts.
- **Upgrade path** — state preservation across V1→V2, owner gating of
  `upgradeToAndCall`, storage-layout safety (via `BadSplitterV2`),
  pause-switch enforcement, and manual proxy rollback.
- **Deployment store** — append/read/list helpers, history indexing,
  fixture isolation via `AGENTICPAY_DEPLOYMENTS_DIR`.

`npm run test:gas` sets `REPORT_GAS=true` for a gas-usage column. `npm
run coverage` produces solidity-coverage HTML under `coverage/`.

## CI

`.github/workflows/contracts-evm.yml` runs on every PR/push that touches
`contracts/evm/**` or the workflow file itself. It compiles, lints,
tests, and reports coverage as an artifact.

## Related

- Soroban (Stellar) side of AgenticPay lives in `contracts/src/` and is
  built with `cargo build --target wasm32-unknown-unknown --release` — it
  is untouched by this workspace.
- App-level deployment scripting for the backend/frontend is in
  `../../scripts/deploy.sh` (PM2-based, unrelated to contract deploys).
