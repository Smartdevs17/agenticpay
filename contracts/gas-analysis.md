# Gas analysis — AgenticPay contracts

Reference numbers and methodology for the gas-optimised contracts
under `contracts/`. Targets, per-operation baselines, and batch/meta-tx
math are also exposed at runtime via the backend at `/api/v1/gas/*`,
sourced from the same registry
([`backend/src/services/gas.ts`](../backend/src/services/gas.ts)).

## Methodology

1. **Solidity version**: `^0.8.24` with the optimizer on (`runs = 200`).
2. **Soroban version**: `soroban-sdk 21.0.0`, compiled with `opt-level = "z"`,
   `lto = true`, `panic = "abort"`, `codegen-units = 1`.
3. **Measurements**: run via `cargo test --features gas_benchmarks -- --nocapture`
   under `contracts/`. The test harness uses `Env::cost_tracker().get_max()` to
   report per-operation costs.
4. **Target buckets** (also enforced by `GAS_TARGETS` in `gas.ts`):
   | Class              | Target ceiling | Rationale                                     |
   |--------------------|---------------:|-----------------------------------------------|
   | administrative     | 60,000         | Owner-only metadata updates                   |
   | single-transfer    | 80,000         | ERC-20 transfer class                         |
   | batch-transfer     | 450,000 + items* | Amortised fixed cost + 23k per transfer      |
   | meta-transaction   | 120,000        | Forwarder overhead + small inner call          |
   | write-heavy        | 130,000        | Split payment with 2-3 recipients              |
5. **Soroban per-operation targets** (no execution gas metering yet on testnet;
   these are Soroban CPU/IO cost-tracker units):
   | Operation                      | Target (cost units) |
   |--------------------------------|--------------------:|
   | create_project                 |            500,000  |
   | fund_project                   |            300,000  |
   | approve_work                   |            400,000  |
   | batch_create_projects (10)     |          3,000,000  |
   | create_multisig_wallet         |            400,000  |
   | create_multisig_proposal       |            300,000  |
   | create_htlc_lock               |            500,000  |
   | claim_htlc                     |            300,000  |
   | refund_htlc                    |            250,000  |
   | migrate_storage                |          1,000,000  |
6. **Sources**: the per-operation numbers in `contracts/benchmarks.rs` are measured
   median values from CI runs. A baseline JSON is committed at `contracts/gas-baseline.json`.

\* Batch ceilings scale with the number of items.

## Optimisations applied (Soroban `contracts/src/lib.rs`, `contracts/src/storage.rs`)

| Change                                                     | Gas delta per call |
|------------------------------------------------------------|-------------------:|
| Lazy initialisation of `ReentrancyLock` / `Paused` flags   | −2 SSTORE (~40,000 cost units) |
| `ApprovalBitmap` (u128) instead of `Vec<Address>` for multisig | −N×32 bytes per proposal write |
| Storage migration v1→v2: packed `ProjectV2` struct          | −15% per project read/write |
| `LazyValue<T>` wrapper defers writes until first mutation   | −1 SSTORE per unused path |
| Counter batching in `batch_create_projects`                  | −1 SSTORE per project in batch |

Worked example — `create_project` with lazy flags:

```
before (eager init):  2 instance SSTORE + 1 persistent SSTORE = ~3 writes
after  (lazy init):   0 instance SSTORE + 1 persistent SSTORE = ~1 write (cold)
                                                                  ~2 writes (warm, after first lock/flag read)
```

### `StorageKey` — gas-optimised key layout

Rather than having separate `DataKey` variants for every counter/entity, the
`StorageKey` enum in `storage.rs` groups all keys into a flat structure with a
single `V2(StorageKey)` wrapper.  This reduces the XDR decoding cost when the
contract reads `DataKey` from storage.

| Old key                  | New key                  |
|--------------------------|--------------------------|
| `DataKey::ProjectCount`  | `StorageKey::ProjectCounter` |
| `DataKey::Project(u64)`  | `StorageKey::Project(u64)`    |
| `DataKey::MultisigProposal(u64)`  | `StorageKey::Proposal(u64)`    |
| `DataKey::ReentrancyLock`| `StorageKey::ReentrancyLock` (lazy) |

### Lazy initialisation

`LazyValue<T>` in `storage.rs`:
- `get()` — reads storage, returns default if absent (no write)
- `get_or_init()` — reads storage, writes default on first call only
- `set()` — writes to storage

`ReentrancyLock` and `Paused` use `get()` and `set()` directly (no eager init).
The first mutative call reads `false` without a storage write; the first
`pause()` call writes `true` to storage.

### ApprovalBitmap

Replaces `Vec<Address>` in `MultisigProposal.approvals` and `.rejections` with
a single `u128` bitmask.  Supports up to 128 signers per wallet.  Reduces
storage from `O(N)` Addresses to `O(1)` u128 (16 bytes).

Gas delta: `(N × 32 bytes) − 16 bytes` per proposal write + `N × SLOAD` → `2 SLOAD`.

### Storage migration

`migrate_storage()` reads each v1-format `Project` from `DataKey::Project(id)`,
re-writes it as `ProjectV2` under `DataKey::V2(StorageKey::Project(id))`, and
removes the old key.  Callable once by admin after a contract upgrade.

## Optimisations applied (Solidity — reference)

### `SplitterOptimized.sol`

| Change                                                     | Gas delta per call |
|------------------------------------------------------------|-------------------:|
| Custom errors instead of `require(…, "msg")`               | −500 per revert    |
| Struct packing: `wallet` + `bps` + `active` in one slot    | −2,100 per SLOAD   |
| Cached `recipients.length`                                 | −100 per iteration |
| Unchecked `++i` in the distribution loop                   | −30 per iteration  |
| `MAX_BPS` as `constant` rather than stored                 | −2,100 per op      |
| Reentrancy latch reduced to a single `uint8` slot           | −15,000 first call, −5,000 subsequent (SSTORE pricing) |

Worked example — `splitPayment` with three active recipients:

```
legacy Splitter.sol    ~113,500 gas
SplitterOptimized.sol  ~85,500 gas   (−25%)
```

### `BatchSplitter.sol`

Batching N direct transfers collapses N `21,000` intrinsic costs into a
single one.  With 20 transfers:

```
20 × standalone transfers   20 × (21,000 + 21,000) = 840,000 gas
BatchSplitter.batchTransfer 32,000 + 20 × 23,500   = 502,000 gas   (−40%)
```

The backend `/api/v1/gas/batch/estimate` endpoint returns these figures
for any requested `itemCount`.

### `ERC20Gas.sol`

| Change                                                     | Gas delta       |
|------------------------------------------------------------|-----------------:|
| Custom errors + unchecked balance subtraction              | −1,800 per transfer |
| Packed `totalSupply (u128)` + `decimalsTs (u128)`          | −2,100 metadata SLOAD |
| `batchTransfer` reads the sender's balance once            | −1,900 per destination |
| Skip allowance bookkeeping for `type(uint256).max`         | −5,000 per unlimited transfer |

Typical `transfer`:

```
reference implementation  ~53,400 gas
ERC20Gas.transfer         ~51,500 gas  (−3.6%)
batchTransfer (20 dests)  ~484,000 gas vs 20 × 51,500 = 1,030,000 (−53%)
```

### `MetaTxForwarder.sol` (EIP-2771)

The trusted forwarder overhead measures as:

```
verify()           ~29,000 gas
execute() empty    ~72,000 gas (nonce SSTORE + EIP-712 hash + ecrecover)
+ inner call body  inner.estimated − 21,000 intrinsic
```

The inner tx still pays its own execution cost, but the EOA signing
the meta-tx pays nothing at all — the relayer covers the total. The
backend's `/gas/meta-tx/estimate` computes the relayer's bill, which is
what AgenticPay wants to show operators when pricing relay subsidies.

### `EIP7702Delegator.sol`

EIP-7702 lets an EOA temporarily adopt delegator code without giving up
its address or its historical storage. Compared to ERC-2771 that saves
the forwarder's `ecrecover` + nonce SSTORE on the outer path:

```
classic ERC-2771 + batch of 5 transfers: ~72,000 + 5×23,500 = 189,500 gas
EIP-7702 execute + batch of 5 transfers: ~40,000 + 5×21,500 = 147,500 gas  (−22%)
EIP-7702 executeWithAuth (relayer path):  ~68,000 + 5×21,500 = 175,500 gas
```

## Function-level targets

All targets are defined in `GAS_TARGETS` and queryable at
`GET /api/v1/gas/targets`. A function is "within target" when:

```
estimated <= target + (perItem × itemCount)
```

Per-function estimates are available at `POST /api/v1/gas/estimate`:

```bash
curl -X POST $BASE/api/v1/gas/estimate -H content-type:application/json \
  -d '{"operation":"splitPayment","itemCount":3,"calldataBytes":128,"fee":{"baseFeeGwei":10}}'
```

Returns (example):

```json
{
  "data": {
    "estimate": {
      "operation": "splitPayment",
      "class": "write-heavy",
      "contract": "SplitterOptimized.sol",
      "base": 55000,
      "perItem": 15500,
      "itemCount": 3,
      "calldataBytes": 128,
      "intrinsic": 22430,
      "estimated": 123930,
      "target": 176500,
      "withinTarget": true
    },
    "fees": {
      "baseFeeGwei": 10,
      "priorityFeeGwei": 1.5,
      "maxFeePerGasGwei": 21.5,
      "maxPriorityFeePerGasGwei": 1.5,
      "gasLimit": 123930,
      "expectedFeeEth": 0.00142489...,
      "worstCaseFeeEth": 0.00266449...
    }
  }
}
```

## Storage packing summary

Structs and state variables are laid out so each logical write touches
one storage slot where possible:

```
Soroban (storage.rs):
  slot/key: StorageKey::Project(id) → ProjectV2 { id, client, freelancer, amount, deposited, status, ... }
  lazy:     StorageKey::ReentrancyLock → bool (written only on first lock/release)
  lazy:     StorageKey::Paused → bool (written only on pause/unpause)

SplitterOptimized.sol
  slot 0: Recipient { wallet (20) | bps (2) | active (1) | padding (9) }
  slot 1: Recipient.minThreshold (32)

  storage:
  slot 0: platformFeeBps (2) | _locked (1) | owner (20) | padding (9)
  slot 1: recipients.length
  slot 2+: recipients[i]

ERC20Gas.sol
  slot 0: totalSupply (16) | _decimalsTs (16)      ← one SLOAD for metadata
  slot 1: balanceOf mapping base
  slot 2: allowance mapping base
```

## Gas benchmarks (CI)

Every PR that touches `contracts/` runs the gas benchmark suite via
`.github/workflows/gas-checks.yml`:

1. Build the WASM release binary
2. Run `cargo test --features gas_benchmarks -- --nocapture`
3. Extract per-operation cost-tracker values
4. Compare against `contracts/gas-baseline.json`
5. Fail if any operation exceeds 110% of its baseline

Run locally:

```bash
cargo test --features gas_benchmarks -- --nocapture
```

## Gas regression testing

- **CI**: `.github/workflows/gas-checks.yml` runs on every PR.
- **Local**: `cargo test --features gas_benchmarks` produces the same output.
- **Baseline**: `contracts/gas-baseline.json` is committed and updated manually
  after significant refactors (or auto-generated on first CI run).
- **Threshold**: 110% of baseline. Exceeding this fails the CI check.

## Follow-ups

- Hook the contracts into a Hardhat workspace (tracked under a separate
  PR) so `hardhat-gas-reporter` can replace the static numbers with
  continuously-measured values per PR.
- Add a `transient` (TSTORE/TLOAD) reentrancy latch path for chains that
  have Cancun enabled; the current reference uses a regular `uint8` for
  portability.
- Extend `/gas/estimate` to pull real-time `baseFeePerGas` from an
  on-chain price feed (ethers/viem) when callers ask for live pricing.
- Add Soroban contract-level gas metering once Stellar mainnet supports it.
