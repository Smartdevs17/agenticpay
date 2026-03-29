#!/usr/bin/env bash
# =============================================================================
# deploy.sh — AgenticPay deployment script
#
# Usage:
#   ./scripts/deploy.sh [OPTIONS]
#
# Options:
#   --env <staging|production>  Target environment (default: staging)
#   --skip-frontend             Skip frontend build/deploy
#   --skip-backend              Skip backend build/deploy
#   --skip-migrations           Skip database migration step
#   --rollback                  Roll back to the previous saved backup
#
# Environment variables (all optional — defaults shown):
#   APP_NAME            agenticpay
#   APP_DIR             repo root (auto-detected)
#   BACKEND_PORT        3001
#   HEALTH_RETRIES      12        # attempts before declaring unhealthy
#   HEALTH_INTERVAL     5         # seconds between health-check attempts
#   BACKUP_DIR          /tmp/agenticpay-rollback
#   PM2_BACKEND_NAME    agenticpay-backend
#   PM2_FRONTEND_NAME   agenticpay-frontend
#
# Exit codes:
#   0  — success
#   1  — build / migration failure
#   2  — health check failed (rollback attempted)
#   3  — rollback itself failed
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

# ─── Resolve script location ─────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

# ─── Configuration (environment-variable overrides) ──────────────────────────

APP_NAME="${APP_NAME:-agenticpay}"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
BACKEND_PORT="${BACKEND_PORT:-3001}"
HEALTH_ENDPOINT="http://localhost:${BACKEND_PORT}/health"
HEALTH_RETRIES="${HEALTH_RETRIES:-12}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/${APP_NAME}-rollback}"
PM2_BACKEND_NAME="${PM2_BACKEND_NAME:-${APP_NAME}-backend}"
PM2_FRONTEND_NAME="${PM2_FRONTEND_NAME:-${APP_NAME}-frontend}"

# ─── Argument parsing ────────────────────────────────────────────────────────

DEPLOY_ENV="staging"
SKIP_FRONTEND=false
SKIP_BACKEND=false
SKIP_MIGRATIONS=false
DO_ROLLBACK=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)           DEPLOY_ENV="$2"; shift 2 ;;
    --skip-frontend) SKIP_FRONTEND=true; shift ;;
    --skip-backend)  SKIP_BACKEND=true; shift ;;
    --skip-migrations) SKIP_MIGRATIONS=true; shift ;;
    --rollback)      DO_ROLLBACK=true; shift ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Run with --help for usage information." >&2
      exit 1
      ;;
  esac
done

if [[ "$DEPLOY_ENV" != "staging" && "$DEPLOY_ENV" != "production" ]]; then
  echo "Invalid environment '$DEPLOY_ENV'. Must be 'staging' or 'production'." >&2
  exit 1
fi

# ─── Colour helpers ──────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()     { echo -e "${GREEN}[DEPLOY]${NC} $*"; }
info()    { echo -e "${CYAN}[INFO]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}   $*"; }
error()   { echo -e "${RED}[ERROR]${NC}  $*" >&2; }
section() { echo -e "\n${BOLD}──── $* ────${NC}"; }

# ─── Dependency check ────────────────────────────────────────────────────────

check_deps() {
  local missing=()

  command -v node   &>/dev/null || missing+=("node")
  command -v npm    &>/dev/null || missing+=("npm")
  command -v curl   &>/dev/null || missing+=("curl")

  # PM2 is required for process management
  if ! command -v pm2 &>/dev/null; then
    warn "pm2 not found — install it with: npm install -g pm2"
    missing+=("pm2")
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    error "Missing required tools: ${missing[*]}"
    exit 1
  fi
}

# ─── Backup ──────────────────────────────────────────────────────────────────

# Saves current build artefacts so rollback can restore them.
backup_current() {
  section "Backing up current build"

  rm -rf "$BACKUP_DIR"
  mkdir -p "$BACKUP_DIR"

  if [[ -d "$BACKEND_DIR/dist" ]]; then
    cp -r "$BACKEND_DIR/dist" "$BACKUP_DIR/backend-dist"
    info "Backend dist backed up → $BACKUP_DIR/backend-dist"
  else
    info "No existing backend dist to back up (first deploy)"
  fi

  if [[ -d "$FRONTEND_DIR/.next" ]]; then
    cp -r "$FRONTEND_DIR/.next" "$BACKUP_DIR/frontend-next"
    info "Frontend .next backed up → $BACKUP_DIR/frontend-next"
  else
    info "No existing frontend build to back up (first deploy)"
  fi

  # Record the commit SHA that is currently running
  if git -C "$APP_DIR" rev-parse HEAD &>/dev/null; then
    git -C "$APP_DIR" rev-parse HEAD > "$BACKUP_DIR/commit.txt"
    info "Current commit: $(cat "$BACKUP_DIR/commit.txt")"
  fi

  log "Backup complete."
}

# ─── Database migrations ─────────────────────────────────────────────────────

# AgenticPay is currently a stateless service backed by the Stellar blockchain.
# This function is a structured hook for future database migration tooling
# (Prisma, TypeORM, Flyway, etc.).  Drop your migration command below when
# a database is introduced.
run_migrations() {
  section "Database migrations"

  if [[ "$SKIP_MIGRATIONS" == "true" ]]; then
    warn "Skipping migrations (--skip-migrations flag set)."
    return 0
  fi

  # ── Prisma (uncomment when Prisma is added) ──────────────────────────────
  # if [[ -f "$BACKEND_DIR/prisma/schema.prisma" ]]; then
  #   log "Running Prisma migrations..."
  #   (cd "$BACKEND_DIR" && npx prisma migrate deploy)
  #   log "Prisma migrations complete."
  #   return 0
  # fi

  # ── TypeORM (uncomment when TypeORM is added) ────────────────────────────
  # if [[ -f "$BACKEND_DIR/src/data-source.ts" ]]; then
  #   log "Running TypeORM migrations..."
  #   (cd "$BACKEND_DIR" && npx typeorm-ts-node-commonjs -d src/data-source.ts migration:run)
  #   log "TypeORM migrations complete."
  #   return 0
  # fi

  # ── Custom migration script ──────────────────────────────────────────────
  # if [[ -f "$BACKEND_DIR/scripts/migrate.sh" ]]; then
  #   log "Running custom migration script..."
  #   bash "$BACKEND_DIR/scripts/migrate.sh"
  #   return 0
  # fi

  info "No database migration tooling detected — skipping (no-op)."
}

# ─── Build ───────────────────────────────────────────────────────────────────

build_backend() {
  section "Building backend"
  log "Installing backend dependencies..."
  (cd "$BACKEND_DIR" && npm ci --prefer-offline)

  log "Compiling TypeScript..."
  (cd "$BACKEND_DIR" && npm run build)
  log "Backend build complete."
}

build_frontend() {
  section "Building frontend"
  log "Installing frontend dependencies..."
  (cd "$FRONTEND_DIR" && npm ci --prefer-offline)

  log "Running Next.js build..."
  (cd "$FRONTEND_DIR" && npm run build)
  log "Frontend build complete."
}

# ─── Process management (PM2) ────────────────────────────────────────────────

start_or_reload_backend() {
  section "Starting / reloading backend"

  local start_cmd="node $BACKEND_DIR/dist/index.js"

  if pm2 describe "$PM2_BACKEND_NAME" &>/dev/null; then
    log "Reloading existing PM2 process '$PM2_BACKEND_NAME' (zero-downtime)..."
    pm2 reload "$PM2_BACKEND_NAME" --update-env
  else
    log "Starting new PM2 process '$PM2_BACKEND_NAME'..."
    pm2 start "$start_cmd" \
      --name "$PM2_BACKEND_NAME" \
      --env "$DEPLOY_ENV" \
      --log "$APP_DIR/logs/backend.log" \
      --time \
      -- \
      2>/dev/null || \
    pm2 start "$start_cmd" --name "$PM2_BACKEND_NAME"
  fi

  pm2 save
  log "Backend process started."
}

start_or_reload_frontend() {
  section "Starting / reloading frontend"

  local start_cmd="npm start"

  if pm2 describe "$PM2_FRONTEND_NAME" &>/dev/null; then
    log "Reloading existing PM2 process '$PM2_FRONTEND_NAME' (zero-downtime)..."
    pm2 reload "$PM2_FRONTEND_NAME" --update-env
  else
    log "Starting new PM2 process '$PM2_FRONTEND_NAME'..."
    pm2 start "$start_cmd" \
      --name "$PM2_FRONTEND_NAME" \
      --cwd "$FRONTEND_DIR" \
      2>/dev/null || \
    pm2 start "$start_cmd" --name "$PM2_FRONTEND_NAME" --cwd "$FRONTEND_DIR"
  fi

  pm2 save
  log "Frontend process started."
}

# ─── Health check ────────────────────────────────────────────────────────────

health_check() {
  section "Health check"
  info "Polling $HEALTH_ENDPOINT (up to $HEALTH_RETRIES attempts, ${HEALTH_INTERVAL}s apart)..."

  local attempt=0
  local status

  while [[ $attempt -lt $HEALTH_RETRIES ]]; do
    attempt=$(( attempt + 1 ))
    info "Attempt $attempt/$HEALTH_RETRIES..."

    # curl exits non-zero on connection refused — capture both response and exit
    local http_body
    local http_code
    http_code=$(curl --silent --max-time 5 --write-out '%{http_code}' \
      --output /tmp/agenticpay_health.json \
      "$HEALTH_ENDPOINT" 2>/dev/null) || true

    if [[ "$http_code" == "200" || "$http_code" == "206" ]]; then
      status=$(python3 -c "import json,sys; d=json.load(open('/tmp/agenticpay_health.json')); print(d.get('status','unknown'))" 2>/dev/null || echo "unknown")

      if [[ "$status" == "healthy" || "$status" == "degraded" ]]; then
        log "Service is ${status} (HTTP $http_code). Deploy successful."
        rm -f /tmp/agenticpay_health.json
        return 0
      else
        warn "Unexpected status='$status' in response. Retrying..."
      fi
    elif [[ "$http_code" == "503" ]]; then
      status=$(python3 -c "import json,sys; d=json.load(open('/tmp/agenticpay_health.json')); print(d.get('status','unknown'))" 2>/dev/null || echo "unknown")
      warn "Service reports status='$status' (HTTP 503). Retrying..."
    else
      warn "No response or HTTP $http_code. Service may still be starting..."
    fi

    if [[ $attempt -lt $HEALTH_RETRIES ]]; then
      sleep "$HEALTH_INTERVAL"
    fi
  done

  rm -f /tmp/agenticpay_health.json
  error "Health check failed after $HEALTH_RETRIES attempts."
  return 1
}

# ─── Rollback ────────────────────────────────────────────────────────────────

rollback() {
  section "Rolling back"

  if [[ ! -d "$BACKUP_DIR" ]]; then
    error "No backup found at $BACKUP_DIR — cannot roll back."
    return 1
  fi

  local rolled_back=false

  if [[ -d "$BACKUP_DIR/backend-dist" ]]; then
    log "Restoring backend dist..."
    rm -rf "$BACKEND_DIR/dist"
    cp -r "$BACKUP_DIR/backend-dist" "$BACKEND_DIR/dist"
    rolled_back=true

    if pm2 describe "$PM2_BACKEND_NAME" &>/dev/null; then
      pm2 reload "$PM2_BACKEND_NAME" --update-env || pm2 restart "$PM2_BACKEND_NAME"
    fi
  fi

  if [[ -d "$BACKUP_DIR/frontend-next" ]]; then
    log "Restoring frontend build..."
    rm -rf "$FRONTEND_DIR/.next"
    cp -r "$BACKUP_DIR/frontend-next" "$FRONTEND_DIR/.next"
    rolled_back=true

    if pm2 describe "$PM2_FRONTEND_NAME" &>/dev/null; then
      pm2 reload "$PM2_FRONTEND_NAME" --update-env || pm2 restart "$PM2_FRONTEND_NAME"
    fi
  fi

  if [[ "$rolled_back" == "false" ]]; then
    warn "Backup exists but contains no build artefacts — nothing to restore."
    return 1
  fi

  if [[ -f "$BACKUP_DIR/commit.txt" ]]; then
    log "Rolled back to commit: $(cat "$BACKUP_DIR/commit.txt")"
  fi

  log "Rollback complete."
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  section "AgenticPay Deployment"
  info "Environment : $DEPLOY_ENV"
  info "App dir     : $APP_DIR"
  info "Backend     : $([ "$SKIP_BACKEND" == "true" ] && echo "skip" || echo "yes")"
  info "Frontend    : $([ "$SKIP_FRONTEND" == "true" ] && echo "skip" || echo "yes")"
  info "Migrations  : $([ "$SKIP_MIGRATIONS" == "true" ] && echo "skip" || echo "yes")"

  # Handle explicit --rollback flag
  if [[ "$DO_ROLLBACK" == "true" ]]; then
    rollback
    exit $?
  fi

  check_deps

  # 1. Backup
  backup_current

  # 2. Migrations (before the new code is served)
  run_migrations || {
    error "Migration failed — aborting deploy."
    exit 1
  }

  # 3. Build
  if [[ "$SKIP_BACKEND" == "false" ]]; then
    build_backend || {
      error "Backend build failed — rolling back."
      rollback || exit 3
      exit 1
    }
  fi

  if [[ "$SKIP_FRONTEND" == "false" ]]; then
    build_frontend || {
      error "Frontend build failed — rolling back."
      rollback || exit 3
      exit 1
    }
  fi

  # 4. Reload / start processes
  if [[ "$SKIP_BACKEND" == "false" ]]; then
    start_or_reload_backend
  fi

  if [[ "$SKIP_FRONTEND" == "false" ]]; then
    start_or_reload_frontend
  fi

  # 5. Health check — roll back if it fails
  health_check || {
    error "Health check failed after deploy."
    warn "Attempting automatic rollback..."
    rollback && {
      error "Rolled back successfully. Investigate the failed build before re-deploying."
      exit 2
    } || {
      error "Rollback also failed. Manual intervention required."
      exit 3
    }
  }

  section "Deploy complete"
  log "AgenticPay ($DEPLOY_ENV) is live."
  pm2 list
}

main "$@"
