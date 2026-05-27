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
