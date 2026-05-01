# Foundry CI Notes

- `forge test` runs integration, fuzz, and invariant suites.
- `forge snapshot` generates gas baselines to catch regressions.
- Fork-dependent differential tests are soft-skipped when `MAINNET_RPC_URL` is unset.
- Set `MAINNET_RPC_URL` in CI secrets for mainnet-fork execution.
