#!/bin/bash
# Watch contracts for changes, recompile, redeploy, and update bindings
#
# Usage:
#   ./scripts/dev/watch-contracts.sh [--evm-only|--soroban-only]
#
# This script watches Solidity and Rust contract source files.
# On change it recompiles, redeploys to the local testnet, and
# updates the frontend SDK with new addresses/ABIs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$SCRIPT_DIR"

# ── Configuration ──────────────────────────────────────────────────────────
EVM_CONTRACTS_DIR="contracts"
EVM_SOURCES="$EVM_CONTRACTS_DIR/**/*.sol"
EVM_ARTIFACTS_DIR="contracts/evm/artifacts"

SOROBAN_CONTRACTS_DIR="contracts/src"
SOROBAN_SOURCES="$SOROBAN_CONTRACTS_DIR/**/*.rs"
SOROBAN_CARGO="contracts/Cargo.toml"

ADDRESS_REGISTRY="packages/contracts/src/addresses.json"
TYPES_OUTPUT="packages/contracts/src/generated"
SDK_BINDINGS_OUTPUT="packages/sdk/src/contracts"

CYCLES_DIR="/tmp/agenticpay-watch"
EVM_CYCLE="$CYCLES_DIR/evm-cycle"
SOROBAN_CYCLE="$CYCLES_DIR/soroban-cycle"

mkdir -p "$CYCLES_DIR" "$TYPES_OUTPUT" "$SDK_BINDINGS_OUTPUT"

# ── Color output ───────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()   { echo -e "${BLUE}[watch]${NC} $1"; }
ok()    { echo -e "${GREEN}[ok]${NC} $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $1"; }
error() { echo -e "${RED}[error]${NC} $1"; }

# ── Prerequisites check ────────────────────────────────────────────────────
check_prereqs() {
  if ! command -v npx &>/dev/null; then
    error "npx not found. Install Node.js."
    exit 1
  fi
  if [ "$1" != "--soroban-only" ]; then
    if ! command -v forge &>/dev/null; then
      warn "forge (foundry) not found. EVM contract compilation may fall back to Hardhat."
    fi
  fi
  if [ "$1" != "--evm-only" ]; then
    if ! command -v cargo &>/dev/null; then
      error "cargo not found. Soroban compilation requires Rust."
      exit 1
    fi
    # Check soroban CLI
    if ! command -v soroban &>/dev/null; then
      warn "soroban CLI not found. Install with: cargo install soroban-cli"
    fi
  fi
}

# ── Address registry ───────────────────────────────────────────────────────
init_address_registry() {
  if [ ! -f "$ADDRESS_REGISTRY" ]; then
    log "Initializing address registry..."
    mkdir -p "$(dirname "$ADDRESS_REGISTRY")"
    echo '{
  "network": "localhost",
  "chainId": 31337,
  "contracts": {},
  "soroban": {},
  "updatedAt": null
}' > "$ADDRESS_REGISTRY"
    ok "Address registry created at $ADDRESS_REGISTRY"
  fi
}

update_address_registry() {
  local network="$1"
  local contract_name="$2"
  local address="$3"
  local abi_path="$4"
  local chain_id="${5:-31337}"

  if command -v node &>/dev/null; then
    node -e "
      const fs = require('fs');
      const reg = JSON.parse(fs.readFileSync('$ADDRESS_REGISTRY', 'utf8'));
      reg.network = '$network';
      reg.chainId = $chain_id;
      reg.contracts['$contract_name'] = {
        address: '$address',
        abi: fs.existsSync('$abi_path') ? JSON.parse(fs.readFileSync('$abi_path', 'utf8')) : null,
        deployedAt: new Date().toISOString()
      };
      reg.updatedAt = new Date().toISOString();
      fs.writeFileSync('$ADDRESS_REGISTRY', JSON.stringify(reg, null, 2));
      console.log('Registry updated: $contract_name -> $address');
    "
  fi
}

update_soroban_registry() {
  local contract_id="$1"
  local wasm_hash="$2"

  if command -v node &>/dev/null; then
    node -e "
      const fs = require('fs');
      const reg = JSON.parse(fs.readFileSync('$ADDRESS_REGISTRY', 'utf8'));
      reg.soroban['agenticpay'] = {
        contractId: '$contract_id',
        wasmHash: '$wasm_hash',
        deployedAt: new Date().toISOString()
      };
      reg.updatedAt = new Date().toISOString();
      fs.writeFileSync('$ADDRESS_REGISTRY', JSON.stringify(reg, null, 2));
      console.log('Soroban registry updated: $contract_id');
    "
  fi
}

# ── Generate TypeScript bindings ──────────────────────────────────────────
generate_bindings() {
  log "Generating TypeScript contract bindings..."

  mkdir -p "$TYPES_OUTPUT" "$SDK_BINDINGS_OUTPUT"

  if command -v node &>/dev/null && [ -f "$ADDRESS_REGISTRY" ]; then
    node -e "
      const fs = require('fs');
      const reg = JSON.parse(fs.readFileSync('$ADDRESS_REGISTRY', 'utf8'));
      const contracts = reg.contracts || {};
      const lines = [];

      lines.push('// Auto-generated contract addresses and ABIs');
      lines.push('// Generated at: ' + new Date().toISOString());
      lines.push('');
      lines.push('export const CHAIN_ID = ' + (reg.chainId || 31337) + ';');
      lines.push('export const NETWORK = \"' + (reg.network || 'localhost') + '\";');
      lines.push('');

      for (const [name, info] of Object.entries(contracts)) {
        lines.push('export const ' + name + '_ADDRESS = \"' + info.address + '\";');
      }

      lines.push('');
      lines.push('export const contractAddresses = {');
      const entries = Object.entries(contracts);
      for (let i = 0; i < entries.length; i++) {
        const [name, info] = entries[i];
        const comma = i < entries.length - 1 ? ',' : '';
        lines.push('  \"' + name + '\": \"' + info.address + '\"' + comma);
      }
      lines.push('} as const;');
      lines.push('');
      lines.push('export type ContractName = keyof typeof contractAddresses;');

      fs.writeFileSync('$TYPES_OUTPUT/contracts.ts', lines.join('\n'));
      fs.writeFileSync('$SDK_BINDINGS_OUTPUT/addresses.ts', lines.join('\n'));
      console.log('Bindings generated: ' + Object.keys(contracts).length + ' contracts');
    "
    ok "TypeScript bindings generated"
  else
    warn "Could not generate bindings (node or registry missing)"
  fi
}

# ── EVM compilation & deployment ──────────────────────────────────────────
compile_and_deploy_evm() {
  log "Recompiling EVM contracts..."
  
  # Use Foundry if available, otherwise Hardhat
  if command -v forge &>/dev/null; then
    forge build --contracts "$EVM_CONTRACTS_DIR" --out "$EVM_ARTIFACTS_DIR" 2>&1 | tail -5
  else
    (cd contracts/evm && npx hardhat compile 2>&1) | tail -5
  fi

  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    error "EVM compilation failed (exit code $exit_code)"
    return $exit_code
  fi
  ok "EVM compilation successful"

  # Deploy to local Hardhat node (must be running)
  log "Deploying to local Hardhat node..."
  (cd contracts/evm && npx hardhat run --network localhost scripts/deploy.ts 2>&1) || {
    warn "Deploy failed. Is Hardhat node running on port 8545?"
    warn "Start it with: npx hardhat node"
    return 1
  }

  # Update address registry from deployment artifacts
  local deploy_record="contracts/evm/deployments/localhost.json"
  if [ -f "$deploy_record" ]; then
    local proxy_addr
    proxy_addr=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$deploy_record','utf8')).proxy || '')")
    if [ -n "$proxy_addr" ]; then
      update_address_registry "localhost" "SplitterV2" "$proxy_addr" \
        "$EVM_ARTIFACTS_DIR/contracts/SplitterV2.sol/SplitterV2.json"
      generate_bindings
    fi
  fi

  # Notify frontend dev server via websocket
  notify_frontend "contracts:updated" "evm"
}

# ── Soroban compilation & deployment ─────────────────────────────────────
compile_and_deploy_soroban() {
  log "Recompiling Soroban contracts..."

  (cd contracts && cargo build --target wasm32-unknown-unknown --release 2>&1) | tail -10

  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    error "Soroban compilation failed (exit code $exit_code)"
    return $exit_code
  fi
  ok "Soroban compilation successful"

  # Deploy to local Soroban testnet
  local wasm_file="contracts/target/wasm32-unknown-unknown/release/agenticpay.wasm"
  if [ ! -f "$wasm_file" ]; then
    error "WASM artifact not found at $wasm_file"
    return 1
  fi

  log "Deploying Soroban contract..."
  if command -v soroban &>/dev/null; then
    local deploy_output
    deploy_output=$(soroban contract deploy \
      --wasm "$wasm_file" \
      --source default \
      --network local 2>&1) || {
      warn "Soroban deploy failed. Is Soroban QuickStart running?"
      return 1
    }
    local contract_id
    contract_id=$(echo "$deploy_output" | grep -oE '[Cc][0-9a-f]{55}' | head -1)
    if [ -n "$contract_id" ]; then
      update_soroban_registry "$contract_id" ""
      generate_bindings
      ok "Soroban deployed: $contract_id"
    fi
  else
    warn "soroban CLI not available. Skip deploy."
  fi

  notify_frontend "contracts:updated" "soroban"
}

# ── Frontend notification ─────────────────────────────────────────────────
notify_frontend() {
  local event_type="$1"
  local source="$2"
  if command -v node &>/dev/null; then
    node -e "
      const http = require('http');
      const msg = JSON.stringify({ type: '$event_type', source: '$source', timestamp: new Date().toISOString() });
      const req = http.request({ hostname: 'localhost', port: 3000, path: '/api/dev/reload', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(msg) } });
      req.write(msg);
      req.end();
      req.on('error', () => { /* frontend dev server may not be running */ });
    " 2>/dev/null || true
  fi
}

# ── File watcher using fswatch or polling ──────────────────────────────────
start_watch_evm() {
  log "Watching EVM contracts: $EVM_CONTRACTS_DIR/**/*.sol"
  
  if command -v fswatch &>/dev/null; then
    fswatch -o --event Updated "$EVM_CONTRACTS_DIR" | while read -r _; do
      compile_and_deploy_evm
    done
  else
    warn "fswatch not found. Using polling (every 2s). Install fswatch for efficiency."
    while true; do
      local current
      current=$(find "$EVM_CONTRACTS_DIR" -name "*.sol" -newer "$EVM_CYCLE" 2>/dev/null | head -1)
      if [ -n "$current" ]; then
        touch "$EVM_CYCLE"
        compile_and_deploy_evm
      fi
      sleep 2
    done
  fi
}

start_watch_soroban() {
  log "Watching Soroban contracts: $SOROBAN_CONTRACTS_DIR/**/*.rs"
  
  if command -v fswatch &>/dev/null; then
    fswatch -o --event Updated "$SOROBAN_CONTRACTS_DIR" | while read -r _; do
      compile_and_deploy_soroban
    done
  else
    warn "fswatch not found. Using polling (every 3s). Install fswatch for efficiency."
    while true; do
      local current
      current=$(find "$SOROBAN_CONTRACTS_DIR" -name "*.rs" -newer "$SOROBAN_CYCLE" 2>/dev/null | head -1)
      if [ -n "$current" ]; then
        touch "$SOROBAN_CYCLE"
        compile_and_deploy_soroban
      fi
      sleep 3
    done
  fi
}

# ── Run contract tests ────────────────────────────────────────────────────
run_contract_tests() {
  local source="$1"
  log "Running $source contract tests..."

  if [ "$source" = "evm" ]; then
    (cd contracts/evm && npx hardhat test 2>&1) | tail -20
  elif [ "$source" = "soroban" ]; then
    (cd contracts && cargo test 2>&1) | tail -20
  fi

  local exit_code=$?
  if [ $exit_code -eq 0 ]; then
    ok "$source tests passed"
  else
    error "$source tests failed (exit code $exit_code)"
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║   AgenticPay Contract Hot Reload                           ║"
  echo "║   Watching for changes → recompile → redeploy → update SDK ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""

  check_prereqs "$@"
  init_address_registry

  case "${1:-}" in
    --evm-only)
      compile_and_deploy_evm
      start_watch_evm
      ;;
    --soroban-only)
      compile_and_deploy_soroban
      start_watch_soroban
      ;;
    *)
      # Initial compile + deploy for both
      compile_and_deploy_evm || warn "EVM initial deploy skipped"
      compile_and_deploy_soroban || warn "Soroban initial deploy skipped"

      # Watch both in parallel
      touch "$EVM_CYCLE" "$SOROBAN_CYCLE"
      
      # Start watchers in background
      start_watch_evm &
      WATCH_EVM_PID=$!
      start_watch_soroban &
      WATCH_SOROBAN_PID=$!

      log "Watching both EVM and Soroban contracts. Press Ctrl+C to stop."

      # Trap to clean up
      trap 'log "Stopping watchers..."; kill $WATCH_EVM_PID $WATCH_SOROBAN_PID 2>/dev/null; exit 0' SIGINT SIGTERM

      # Wait for background processes
      wait
      ;;
  esac
}

main "$@"
