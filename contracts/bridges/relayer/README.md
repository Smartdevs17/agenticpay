# Settlement proof relayer (Stellar ⇄ EVM)

This relayer proves that a settlement finalised on one chain to the other chain. An M-of-N attester set signs an EIP-712 proof. An off-chain relayer collects the signatures and submits them to the destination verifier.

| Piece | Path |
| --- | --- |
| EVM verifier and outbound commit log | `contracts/bridges/relayer/SettlementProofRelay.sol` |
| Off-chain relayer (observe → attest → submit) | `backend/src/services/settlementProof.ts` |
| Contract tests (Foundry) | `contracts/bridges/relayer/test/SettlementProofRelay.t.sol` |
| Relayer tests (Vitest) | `backend/src/services/__tests__/settlementProof.test.ts` |

## Lanes

| Lane | Source event | Default finality floor | Destination |
| --- | --- | --- | --- |
| `stellar->evm` | Stellar ledger close for the settlement transaction | 1 ledger (Stellar ledgers are final on close) | `SettlementProofRelay.relayProof` |
| `evm->stellar` | `SettlementCommitted` emitted by `commitSettlement` | Set per lane (`minConfirmations`), e.g. 12 blocks on mainnet | The Soroban verifier, through an injected `ProofSubmitter` |

## Proof format

```
SettlementProof(bytes32 settlementId,bytes32 sourceChain,uint64 sourceHeight,
                bytes32 sourceTxHash,bytes32 recipient,bytes32 token,uint256 amount)
domain: name "AgenticPaySettlementProofRelay", version "1", chainId, verifyingContract
```

- `sourceChain` is `keccak256("stellar:pubnet")`, `keccak256("evm:1")` and so on (`chainIdentifier()`).
- `recipient` and `token` are 32 bytes on both lanes. An EVM address is left-padded with zeros. A Stellar `G…` key or Soroban `C…` contract id fills all 32 bytes as its raw key. The EVM verifier rejects any value that does not fit in an address (`NonEvmAddress`).
- A `settlementId` that is already 32-byte hex is used as-is. Any other id is hashed with `keccak256`.
- Both test suites check the same digest test vector, so the Solidity and TypeScript encoders cannot drift apart without a test failing.

## On-chain guarantees

- Each settlement id is accepted at most once (`AlreadyRelayed`).
- At least `threshold` signatures from current attesters are required. Signers must be in strictly ascending address order, which rejects duplicate signers cheaply.
- High-`s` (malleable) and malformed signatures are rejected.
- Source and destination chains are allow-listed. The owner can pause the contract, rotate attesters and change the threshold. The threshold can never exceed the attester count.

## Relayer lifecycle

```
awaiting_finality ──(confirmations ≥ floor)──► pending ──(threshold sigs)──► attested ──(submit ok)──► relayed
                                                  │                             │
                                                  └──── failure: retry with backoff, then `failed` after maxAttempts
```

- `observe()` is idempotent per settlement id. A repeat call only raises the confirmation count. A repeat call with a different payload throws `CONFLICTING_OBSERVATION`.
- A signature counts only if it recovers to the attester that returned it. Each attester gets `attestationTimeoutMs` to respond.
- Collected signatures are reused when a submission is retried. Retry `n` waits `baseBackoffMs * 2^(n-1)`. Call `processDue()` from a scheduler to pick up records whose backoff has elapsed.
- If a proof is already on-chain (seen by the `isRelayed` pre-check or an `AlreadyRelayed` revert), the record is marked `relayed`. This is not counted as an error, so several relayer instances can run safely.

## Observability

All metrics are tagged with `lane` and sent through `backend/src/observability/datadog.ts`.

| Metric | Meaning |
| --- | --- |
| `settlement_proof.observed` | A new settlement was recorded |
| `settlement_proof.attested` | The threshold of valid signatures was collected |
| `settlement_proof.relayed` / `settlement_proof.relay_latency_ms` | The proof landed, and the time from observation to landing |
| `settlement_proof.already_relayed` | Another relayer landed the proof first |
| `settlement_proof.invalid_attestation` | A signature did not recover to its attester. Investigate the key or the attester |
| `settlement_proof.attestation_shortfall` | Too few valid signatures in this attempt |
| `settlement_proof.submit_error` | The destination submission failed and will be retried |
| `settlement_proof.failed` | Retries are exhausted. Needs operator action |
| `settlement_proof.conflict` | Two observations disagree for one settlement id. Investigate the source indexer |

Structured logs use the `[settlement-proof]` prefix.

## Runbook

- **`failed` records**: check `lastError` with `relayer.list('failed')`. For attestation shortfalls, confirm the attesters are reachable and their keys match the on-chain set. For submission errors, check the destination RPC and the relayer's gas balance.
- **Rotating an attester**: call `setAttester(new, true)` and deploy the new signer to the relayer before calling `setAttester(old, false)`. The contract rejects any removal that would leave fewer attesters than `threshold`.
- **Emergency stop**: `setPaused(true)` blocks both `relayProof` and `commitSettlement`. Records that were submitted while paused retry with backoff.

## Running the tests

```bash
make test-contracts-relayer      # forge test --root contracts/bridges/relayer
cd backend && npx vitest run src/services/__tests__/settlementProof.test.ts
```
