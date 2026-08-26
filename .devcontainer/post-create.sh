#!/usr/bin/env bash
# Runs once after the devcontainer is created.
set -euo pipefail

ROOT="/workspaces/agenticpay"
cd "$ROOT"

echo "==> AgenticPay devcontainer post-create"

# Rust WASM target (Soroban contracts)
if command -v rustup >/dev/null 2>&1; then
  echo "==> Adding wasm32-unknown-unknown target"
  rustup target add wasm32-unknown-unknown
fi

# Soroban CLI (optional but required for contract work)
if command -v cargo >/dev/null 2>&1; then
  if ! command -v soroban >/dev/null 2>&1; then
    echo "==> Installing Soroban CLI (this may take a few minutes)"
    cargo install --locked soroban-cli --version 21.0.0 || {
      echo "WARN: soroban-cli install failed; run manually: cargo install --locked soroban-cli"
    }
  fi
fi

# Node workspaces
echo "==> Installing npm dependencies (root + workspaces)"
npm ci --prefer-offline 2>/dev/null || npm install

echo "==> Backend: Prisma generate"
(cd backend && npm run db:generate)

echo "==> Compiling Soroban contracts"
if [ -f contracts/Cargo.toml ]; then
  (cd contracts && cargo build --target wasm32-unknown-unknown --release) || {
    echo "WARN: contract build failed; fix Rust/Soroban setup and re-run:"
    echo "  cd contracts && cargo build --target wasm32-unknown-unknown --release"
  }
fi

echo "==> Generating OpenAPI spec"
if [ -f backend/scripts/generate-openapi.ts ]; then
  (cd backend && npm run openapi:generate) || true
fi

echo "==> Playwright browsers (frontend E2E)"
if [ -d frontend ]; then
  (cd frontend && npx playwright install chromium --with-deps) || true
fi

echo ""
echo "Post-create complete. Start services:"
echo "  docker compose -f docker-compose.yml up -d   # Postgres + Redis (host)"
echo "  cd backend && npm run dev"
echo "  cd frontend && npm run dev"
