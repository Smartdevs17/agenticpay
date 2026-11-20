#!/usr/bin/env bash
# =============================================================================
# verify-contract-hash.sh — verify the deployed Soroban contract bytecode
# against the locally built WASM and the committed build manifest.
#
# The backend reads contracts/build-manifest.json at startup and refuses to
# serve traffic when the on-chain WASM hash differs from the manifest.
#
# Usage:
#   ./scripts/verify-contract-hash.sh --contract-id C... [OPTIONS]
#
# Options:
#   --contract-id ID   Deployed Soroban contract ID (or SOROBAN_CONTRACT_ID)
#   --network NAME     testnet | mainnet | public (default: STELLAR_NETWORK or testnet)
#   --wasm PATH        Locally built WASM (default: contracts/target/wasm32-unknown-unknown/release/agenticpay.wasm)
#   --manifest PATH    Build manifest path (default: contracts/build-manifest.json)
#   --write            Write/refresh the manifest after a successful on-chain check
#   --help             Show this help
#
# Requirements:
#   - stellar CLI (https://developers.stellar.org/docs/tools/developer-tools/cli)
#   - node (used to read and write the JSON manifest)
#   - sha256sum or shasum
#
# Exit codes:
#   0  — deployed bytecode, local WASM and manifest all agree
#   1  — usage error, missing dependency, or missing build artifacts
#   2  — verification mismatch (local vs on-chain, or manifest vs local)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

WASM_FILE="$REPO_ROOT/contracts/target/wasm32-unknown-unknown/release/agenticpay.wasm"
MANIFEST_FILE="$REPO_ROOT/contracts/build-manifest.json"
NETWORK="${STELLAR_NETWORK:-testnet}"
CONTRACT_ID="${SOROBAN_CONTRACT_ID:-}"
WRITE_MANIFEST=false

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${GREEN}[contract-hash]${NC} $*"; }
info()  { echo -e "${CYAN}[contract-hash]${NC} $*"; }
warn()  { echo -e "${YELLOW}[contract-hash]${NC} $*" >&2; }
error() { echo -e "${RED}[contract-hash]${NC} $*" >&2; }

usage() {
  sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --contract-id) CONTRACT_ID="$2"; shift 2 ;;
    --network)     NETWORK="$2"; shift 2 ;;
    --wasm)        WASM_FILE="$2"; shift 2 ;;
    --manifest)    MANIFEST_FILE="$2"; shift 2 ;;
    --write)       WRITE_MANIFEST=true; shift ;;
    --help|-h)     usage; exit 0 ;;
    *)
      error "Unknown option: $1"
      usage >&2
      exit 1
      ;;
  esac
done

case "$NETWORK" in
  testnet)
    CLI_NETWORK="testnet"
    MANIFEST_NETWORK="testnet"
    ;;
  mainnet|public)
    CLI_NETWORK="mainnet"
    MANIFEST_NETWORK="public"
    ;;
  *)
    error "Invalid network '$NETWORK'. Must be 'testnet', 'mainnet' or 'public'."
    exit 1
    ;;
esac

if [[ -z "$CONTRACT_ID" ]]; then
  error "A contract ID is required. Pass --contract-id or set SOROBAN_CONTRACT_ID."
  exit 1
fi

missing=()
command -v node   &>/dev/null || missing+=("node")
command -v stellar &>/dev/null || missing+=("stellar")

HASH_CMD=()
if command -v sha256sum &>/dev/null; then
  HASH_CMD=(sha256sum)
elif command -v shasum &>/dev/null; then
  HASH_CMD=(shasum -a 256)
else
  missing+=("sha256sum or shasum")
fi

if [[ ${#missing[@]} -gt 0 ]]; then
  error "Missing required tools: ${missing[*]}"
  exit 1
fi

hash_file() {
  "${HASH_CMD[@]}" "$1" | awk '{print $1}'
}

if [[ ! -f "$WASM_FILE" ]]; then
  error "WASM not found at $WASM_FILE"
  error "Build it first: (cd contracts && cargo build --target wasm32-unknown-unknown --release)"
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

LOCAL_WASM="$WASM_FILE"
if [[ "$LOCAL_WASM" != /* ]]; then
  LOCAL_WASM="$(cd "$(dirname "$LOCAL_WASM")" && pwd)/$(basename "$LOCAL_WASM")"
fi
WASM_RELATIVE="${LOCAL_WASM#"$REPO_ROOT"/}"

info "Contract ID      : $CONTRACT_ID"
info "Network          : $NETWORK"
info "Local WASM       : $WASM_RELATIVE"
info "Build manifest   : $MANIFEST_FILE"

# ─── 1. Hash the locally built WASM ──────────────────────────────────────────

LOCAL_HASH="$(hash_file "$LOCAL_WASM")"
info "Local SHA-256    : $LOCAL_HASH"

# ─── 2. Fetch the deployed WASM and hash it ──────────────────────────────────

ONCHAIN_WASM="$TMP_DIR/onchain.wasm"
info "Fetching deployed WASM via stellar CLI..."

if ! stellar contract fetch \
  --id "$CONTRACT_ID" \
  --network "$CLI_NETWORK" \
  --out-file "$ONCHAIN_WASM"; then
  error "Failed to fetch the deployed contract $CONTRACT_ID from $NETWORK."
  exit 1
fi

if [[ ! -s "$ONCHAIN_WASM" ]]; then
  error "stellar CLI returned no bytecode for $CONTRACT_ID."
  exit 1
fi

ONCHAIN_HASH="$(hash_file "$ONCHAIN_WASM")"
info "On-chain SHA-256 : $ONCHAIN_HASH"

if [[ "$LOCAL_HASH" != "$ONCHAIN_HASH" ]]; then
  error "Deployed bytecode does not match the local build."
  error "  local    : $LOCAL_HASH"
  error "  on-chain : $ONCHAIN_HASH"
  error "Rebuild with the pinned toolchain or confirm the contract ID before writing the manifest."
  exit 2
fi

log "Deployed bytecode matches the local WASM build."

# ─── 3. Write or verify the build manifest ───────────────────────────────────

MANIFEST_JS='
const fs = require("node:fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (
  typeof m.contractId !== "string" ||
  typeof m.network !== "string" ||
  typeof m.wasmSha256 !== "string"
) {
  console.error("Invalid build manifest: contractId, network and wasmSha256 are required");
  process.exit(1);
}
process.stdout.write([m.contractId.trim(), m.network.trim(), m.wasmSha256.trim().toLowerCase()].join("\t"));
'

if [[ "$WRITE_MANIFEST" == "true" ]]; then
  mkdir -p "$(dirname "$MANIFEST_FILE")"
  MANIFEST_CONTRACT_ID="$CONTRACT_ID" \
  MANIFEST_NETWORK="$MANIFEST_NETWORK" \
  MANIFEST_WASM_SHA="$LOCAL_HASH" \
  MANIFEST_WASM_FILE="$WASM_RELATIVE" \
  node -e '
const fs = require("node:fs");
const manifest = {
  contractId: process.env.MANIFEST_CONTRACT_ID,
  network: process.env.MANIFEST_NETWORK,
  wasmSha256: process.env.MANIFEST_WASM_SHA,
  wasmFile: process.env.MANIFEST_WASM_FILE,
  builtAt: new Date().toISOString(),
};
fs.writeFileSync(process.argv[1], `${JSON.stringify(manifest, null, 2)}\n`);
' "$MANIFEST_FILE"
  log "Wrote build manifest: $MANIFEST_FILE"
fi

if [[ ! -f "$MANIFEST_FILE" ]]; then
  error "Build manifest not found at $MANIFEST_FILE"
  error "Run this script with --write to generate it after a verified deployment."
  exit 1
fi

if ! MANIFEST_ROW="$(node -e "$MANIFEST_JS" "$MANIFEST_FILE")"; then
  error "Could not read the build manifest at $MANIFEST_FILE."
  exit 1
fi

IFS=$'\t' read -r MANIFEST_CONTRACT MANIFEST_NET MANIFEST_HASH <<< "$MANIFEST_ROW"

if [[ "$MANIFEST_CONTRACT" != "$CONTRACT_ID" ]]; then
  error "Manifest is for contract $MANIFEST_CONTRACT but the deployed contract is $CONTRACT_ID."
  exit 2
fi

if [[ "$MANIFEST_NET" != "$MANIFEST_NETWORK" ]]; then
  error "Manifest targets network $MANIFEST_NET but this check targets $MANIFEST_NETWORK."
  exit 2
fi

if [[ "$MANIFEST_HASH" != "$LOCAL_HASH" ]]; then
  error "Manifest hash does not match the local WASM build."
  error "  manifest : $MANIFEST_HASH"
  error "  local    : $LOCAL_HASH"
  exit 2
fi

log "Build manifest, local WASM and deployed bytecode all agree ($LOCAL_HASH)."
