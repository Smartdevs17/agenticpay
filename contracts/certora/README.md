# Certora Formal Verification

This directory contains Certora Prover configuration and CVL specifications for the EVM reference contracts.

Run a single target:

```bash
certoraRun contracts/certora/conf/ERC20Gas.conf
```

Run the same suite used by CI:

```bash
for conf in contracts/certora/conf/*.conf; do certoraRun "$conf"; done
```

The GitHub Actions workflow requires `CERTORAKEY` to be configured as a repository secret.

## Scope

- `ERC20Gas`: total-supply consistency, allowance consumption, arithmetic safety, and insufficient-balance reverts.
- `SplitterOptimized`: owner-only configuration/withdrawal and platform-fee bounds.
- `MetaTxForwarder`: replay protection, deadline enforcement, and nonce consumption.
- `EIP7702Delegator`: self-call authorization, relayer deadline enforcement, and nonce consumption.

Specs are intentionally focused on public entry points and invariants that should block deployment when they fail.
