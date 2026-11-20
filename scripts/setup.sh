#!/usr/bin/env bash
# Installs and verifies the Rust / Soroban toolchain used by contracts/ (#1498).
#
# Used by .devcontainer/post-create.sh and by developers setting up the host.
# The devcontainer image already ships this toolchain, so on a devcontainer this
# is a quick verification. Elsewhere it installs whatever is missing.
#
#   scripts/setup.sh           install what is missing
#   scripts/setup.sh --check   report status only; exit 1 if anything is missing
#   scripts/setup.sh --help    show this help
set -euo pipefail

# Must match soroban-sdk in contracts/Cargo.toml and the ARG in .devcontainer/Dockerfile.
SOROBAN_CLI_VERSION="21.0.0"
WASM_TARGET="wasm32-unknown-unknown"
RUST_COMPONENTS=(clippy rustfmt)

CHECK_ONLY=0
MISSING=0

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
}

case "${1:-}" in
  "") ;;
  --check) CHECK_ONLY=1 ;;
  -h|--help) usage; exit 0 ;;
  *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
esac

log() { printf '==> %s\n' "$*"; }
ok() { printf '  ok       %s\n' "$*"; }
missing() { printf '  missing  %s\n' "$*"; MISSING=$((MISSING + 1)); }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: $1 is required. $2" >&2
    exit 127
  fi
}

require_cmd rustup "Install it from https://rustup.rs"
require_cmd cargo "Install Rust with rustup (https://rustup.rs)"

log "Rust toolchain"
rustc --version | sed 's/^/  /'

log "WebAssembly target ($WASM_TARGET)"
if rustup target list --installed | grep -qx "$WASM_TARGET"; then
  ok "$WASM_TARGET installed"
elif [ "$CHECK_ONLY" -eq 1 ]; then
  missing "$WASM_TARGET"
else
  rustup target add "$WASM_TARGET"
fi

log "Rust components (${RUST_COMPONENTS[*]})"
installed_components="$(rustup component list --installed)"
for component in "${RUST_COMPONENTS[@]}"; do
  if printf '%s\n' "$installed_components" | grep -q "^${component}"; then
    ok "$component installed"
  elif [ "$CHECK_ONLY" -eq 1 ]; then
    missing "$component"
  else
    rustup component add "$component"
  fi
done

log "Soroban CLI (pinned to $SOROBAN_CLI_VERSION)"
installed_soroban=""
if command -v soroban >/dev/null 2>&1; then
  installed_soroban="$(soroban --version 2>/dev/null | awk '{print $2}' || true)"
fi
if [ "$installed_soroban" = "$SOROBAN_CLI_VERSION" ]; then
  ok "soroban $SOROBAN_CLI_VERSION installed"
elif [ "$CHECK_ONLY" -eq 1 ]; then
  missing "soroban $SOROBAN_CLI_VERSION (found: ${installed_soroban:-none})"
else
  cargo install --locked soroban-cli --version "$SOROBAN_CLI_VERSION"
fi

if [ "$CHECK_ONLY" -eq 1 ] && [ "$MISSING" -gt 0 ]; then
  echo "" >&2
  echo "$MISSING item(s) missing. Run scripts/setup.sh to install them." >&2
  exit 1
fi

log "Toolchain ready"
