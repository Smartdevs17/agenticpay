#!/usr/bin/env bash
# Runs on every container start — quick health checks only.
set -euo pipefail

echo "==> Devcontainer ready"
echo "    Postgres: postgresql://postgres:postgres@localhost:5432/agenticpay"
echo "    Redis:    redis://localhost:6379"
