#!/usr/bin/env bash
# Runs once after the devcontainer is created.
set -euo pipefail

ROOT="/workspaces/agenticpay"
cd "$ROOT"

echo "==> AgenticPay devcontainer post-create"

# Debug configurations and tasks (Issue #238). `.vscode/` is gitignored, so the
# templates live in `.devcontainer/vscode/` and are copied in on create. Existing
# user files are never overwritten.
mkdir -p "$ROOT/.vscode"
for template in "$ROOT"/.devcontainer/vscode/*.json; do
  [ -e "$template" ] || continue
  target="$ROOT/.vscode/$(basename "$template")"
  if [ -e "$target" ]; then
    echo "==> Keeping existing .vscode/$(basename "$template")"
  else
    cp "$template" "$target"
    echo "==> Installed .vscode/$(basename "$template")"
  fi
done

# Rust toolchain and Soroban CLI. The image already ships them, so this is a quick
# check. It installs anything missing (#1498).
echo "==> Verifying Rust and Soroban toolchain"
bash scripts/setup.sh || echo "WARN: toolchain check failed; run scripts/setup.sh to repair it"

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
