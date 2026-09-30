#!/usr/bin/env bash
# Runs on every container start — quick health checks only.
set -euo pipefail

echo "==> Devcontainer ready"
echo "    Postgres:    postgresql://postgres:postgres@localhost:5432/agenticpay"
echo "    Redis:       redis://localhost:6379"
echo "    Soroban RPC: http://localhost:8000/soroban/rpc"
echo "    Stellar Core: localhost:7001"
echo "    EVM (opt-in): http://localhost:8545  (scripts/devcontainer.sh evm)"
echo "    Debug:       press F5 (configurations in .vscode/launch.json)"
