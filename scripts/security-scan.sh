#!/usr/bin/env bash
# scripts/security-scan.sh — Issue #594
#
# Unified security scan script. Runs locally or in CI.
# Usage:
#   ./scripts/security-scan.sh [all|sast|dast|dependencies|contracts]
#
# Environment:
#   SKIP_ZAP=1          skip DAST/ZAP scan (requires running app)
#   ZAP_TARGET          override ZAP target URL (default: http://localhost:3001)
#   REPORT_DIR          override report output directory (default: security-reports)

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

SCAN_TYPE="${1:-all}"
REPORT_DIR="${REPORT_DIR:-security-reports}"
ZAP_TARGET="${ZAP_TARGET:-http://localhost:3001}"
SKIP_ZAP="${SKIP_ZAP:-0}"

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()    { echo -e "${BLUE}[security-scan]${NC} $*"; }
ok()     { echo -e "${GREEN}[✓]${NC} $*"; }
warn()   { echo -e "${YELLOW}[!]${NC} $*"; }
fail()   { echo -e "${RED}[✗]${NC} $*"; }

# ── Setup ─────────────────────────────────────────────────────────────────────

mkdir -p "${REPORT_DIR}"
ERRORS=0

log "Starting security scan — type: ${SCAN_TYPE}"
log "Reports will be written to: ${REPORT_DIR}/"

# ── SAST ──────────────────────────────────────────────────────────────────────

run_sast() {
  log "─── SAST: Static Analysis ────────────────────────────────"

  # ESLint — backend
  log "Running ESLint (backend)…"
  if (cd backend && npx eslint src \
        --format json \
        --output-file "../${REPORT_DIR}/eslint-backend.json" 2>/dev/null \
      || true); then
    ok "ESLint backend: ${REPORT_DIR}/eslint-backend.json"
  else
    warn "ESLint backend: encountered issues (see report)"
    ERRORS=$((ERRORS + 1))
  fi

  # ESLint — frontend
  log "Running ESLint (frontend)…"
  if (cd frontend && npx eslint app components lib \
        --format json \
        --output-file "../${REPORT_DIR}/eslint-frontend.json" 2>/dev/null \
      || true); then
    ok "ESLint frontend: ${REPORT_DIR}/eslint-frontend.json"
  else
    warn "ESLint frontend: encountered issues (see report)"
    ERRORS=$((ERRORS + 1))
  fi

  # TypeScript type-check
  log "Running TypeScript type-check (backend)…"
  (cd backend && npx tsc --noEmit 2>&1 \
    | tee "../${REPORT_DIR}/tsc-backend.txt" || true)
  ok "TSC backend: ${REPORT_DIR}/tsc-backend.txt"

  log "Running TypeScript type-check (frontend)…"
  (cd frontend && npx tsc --noEmit 2>&1 \
    | tee "../${REPORT_DIR}/tsc-frontend.txt" || true)
  ok "TSC frontend: ${REPORT_DIR}/tsc-frontend.txt"

  # Semgrep (optional)
  if command -v semgrep &>/dev/null; then
    log "Running Semgrep…"
    semgrep scan \
      --config=p/security-audit \
      --config=p/typescript \
      --config=p/nodejs \
      --json \
      --output="${REPORT_DIR}/semgrep.json" \
      backend/src frontend/app frontend/components 2>/dev/null || true
    ok "Semgrep: ${REPORT_DIR}/semgrep.json"
  else
    warn "semgrep not found — skipping (install with: pip install semgrep)"
  fi
}

# ── Dependency scanning ───────────────────────────────────────────────────────

run_dependency_scan() {
  log "─── Dependency Vulnerability Scan ────────────────────────"

  # npm audit — backend
  log "Running npm audit (backend)…"
  (cd backend && npm audit --json \
    > "../${REPORT_DIR}/npm-audit-backend.json" 2>&1 \
    || true)
  (cd backend && npm audit 2>&1 \
    | tee "../${REPORT_DIR}/npm-audit-backend.txt" \
    || true)
  ok "npm audit backend: ${REPORT_DIR}/npm-audit-backend.json"

  # npm audit — frontend
  log "Running npm audit (frontend)…"
  (cd frontend && npm audit --json \
    > "../${REPORT_DIR}/npm-audit-frontend.json" 2>&1 \
    || true)
  (cd frontend && npm audit 2>&1 \
    | tee "../${REPORT_DIR}/npm-audit-frontend.txt" \
    || true)
  ok "npm audit frontend: ${REPORT_DIR}/npm-audit-frontend.json"

  # Cargo audit (Rust/Soroban)
  if command -v cargo &>/dev/null; then
    log "Running cargo audit…"
    if command -v cargo-audit &>/dev/null || cargo audit --version &>/dev/null 2>&1; then
      (cd contracts && cargo audit --json \
        > "../${REPORT_DIR}/cargo-audit.json" 2>&1 \
        || true)
      ok "cargo audit: ${REPORT_DIR}/cargo-audit.json"
    else
      warn "cargo-audit not installed — run: cargo install cargo-audit"
    fi
  else
    warn "cargo not found — skipping Rust dependency audit"
  fi

  # Snyk (optional)
  if command -v snyk &>/dev/null; then
    log "Running Snyk…"
    snyk test \
      --all-projects \
      --severity-threshold=high \
      --json \
      > "${REPORT_DIR}/snyk.json" 2>&1 || true
    ok "Snyk: ${REPORT_DIR}/snyk.json"
  else
    warn "snyk not found — skipping (install with: npm i -g snyk)"
  fi
}

# ── DAST ──────────────────────────────────────────────────────────────────────

run_dast() {
  if [[ "${SKIP_ZAP}" == "1" ]]; then
    warn "DAST skipped (SKIP_ZAP=1)"
    return
  fi

  log "─── DAST: Dynamic Application Security Testing ───────────"

  if ! command -v zap.sh &>/dev/null && ! docker info &>/dev/null; then
    warn "Neither ZAP nor Docker found — skipping DAST."
    warn "Install OWASP ZAP or Docker to enable dynamic scanning."
    return
  fi

  # Check if target is reachable
  if ! curl -s --max-time 5 "${ZAP_TARGET}/api/v1/health" &>/dev/null; then
    warn "Target ${ZAP_TARGET} is not reachable — skipping DAST."
    warn "Start the backend first: cd backend && npm run dev"
    return
  fi

  log "Running OWASP ZAP baseline scan against ${ZAP_TARGET}…"
  docker run --rm \
    -v "$(pwd)/${REPORT_DIR}:/zap/wrk/:rw" \
    ghcr.io/zaproxy/zaproxy:stable \
    zap-baseline.py \
      -t "${ZAP_TARGET}" \
      -J zap-report.json \
      -r zap-report.html \
      -m 10 \
    2>&1 | tee "${REPORT_DIR}/zap-scan.txt" \
    || warn "ZAP found issues (check ${REPORT_DIR}/zap-report.*)"

  ok "ZAP scan complete: ${REPORT_DIR}/zap-report.*"
}

# ── Smart contract scan ───────────────────────────────────────────────────────

run_contract_scan() {
  log "─── Smart Contract Security Analysis ─────────────────────"

  # Slither (Solidity)
  if command -v slither &>/dev/null; then
    log "Running Slither…"
    (slither contracts/ \
      --json "${REPORT_DIR}/slither.json" \
      --exclude-dependencies \
      --exclude-low \
      2>&1 | tee "${REPORT_DIR}/slither.txt" \
      || true)
    ok "Slither: ${REPORT_DIR}/slither.json"
  else
    warn "slither not found — skipping (install with: pip install slither-analyzer)"
  fi

  # Mythril (optional)
  if command -v myth &>/dev/null; then
    log "Running Mythril…"
    find contracts -name "*.sol" | while read -r sol_file; do
      base=$(basename "${sol_file}" .sol)
      myth analyze "${sol_file}" \
        --output json \
        > "${REPORT_DIR}/mythril-${base}.json" 2>&1 || true
    done
    ok "Mythril reports: ${REPORT_DIR}/mythril-*.json"
  else
    warn "myth not found — skipping (install with: pip install mythril)"
  fi
}

# ── Aggregated summary ────────────────────────────────────────────────────────

print_summary() {
  echo ""
  log "─── Security Scan Summary ─────────────────────────────────"
  echo ""

  if [[ -f "${REPORT_DIR}/npm-audit-backend.txt" ]]; then
    echo -e "${BLUE}Backend npm audit:${NC}"
    grep -E "found [0-9]+ vulnerabilit" "${REPORT_DIR}/npm-audit-backend.txt" || true
  fi

  if [[ -f "${REPORT_DIR}/npm-audit-frontend.txt" ]]; then
    echo -e "${BLUE}Frontend npm audit:${NC}"
    grep -E "found [0-9]+ vulnerabilit" "${REPORT_DIR}/npm-audit-frontend.txt" || true
  fi

  if [[ -f "${REPORT_DIR}/tsc-backend.txt" ]]; then
    TS_ERRORS=$(grep -c "error TS" "${REPORT_DIR}/tsc-backend.txt" || echo 0)
    if [[ "${TS_ERRORS}" -gt 0 ]]; then
      warn "TypeScript backend: ${TS_ERRORS} type error(s)"
      ERRORS=$((ERRORS + TS_ERRORS))
    else
      ok "TypeScript backend: no errors"
    fi
  fi

  if [[ -f "${REPORT_DIR}/tsc-frontend.txt" ]]; then
    TS_ERRORS=$(grep -c "error TS" "${REPORT_DIR}/tsc-frontend.txt" || echo 0)
    if [[ "${TS_ERRORS}" -gt 0 ]]; then
      warn "TypeScript frontend: ${TS_ERRORS} type error(s)"
      ERRORS=$((ERRORS + TS_ERRORS))
    else
      ok "TypeScript frontend: no errors"
    fi
  fi

  echo ""
  log "Reports saved to: ${REPORT_DIR}/"
  echo ""

  if [[ "${ERRORS}" -gt 0 ]]; then
    fail "Security scan completed with ${ERRORS} issue(s). Review reports in ${REPORT_DIR}/"
    exit 1
  else
    ok "Security scan completed. No blocking issues found."
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

case "${SCAN_TYPE}" in
  sast)         run_sast ;;
  dependencies) run_dependency_scan ;;
  dast)         run_dast ;;
  contracts)    run_contract_scan ;;
  all)
    run_sast
    run_dependency_scan
    run_dast
    run_contract_scan
    ;;
  *)
    fail "Unknown scan type: ${SCAN_TYPE}"
    echo "Usage: $0 [all|sast|dast|dependencies|contracts]"
    exit 1
    ;;
esac

print_summary
