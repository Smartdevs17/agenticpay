#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_FILES=("docker-compose.yml")
if [ -f "docker-compose.sandbox.yml" ]; then
  COMPOSE_FILES+=("docker-compose.sandbox.yml")
fi

COMPOSE_ARGS=()
for f in "${COMPOSE_FILES[@]}"; do
  COMPOSE_ARGS+=(-f "$f")
done

usage() {
  cat <<'EOF'
Dev environment orchestrator

Usage:
  scripts/dev.sh up            Start infra + backend + frontend with hot reload
  scripts/dev.sh down          Stop all services
  scripts/dev.sh logs [svc]    Tail logs (optionally for a single service)
  scripts/dev.sh ps            Show service status
  scripts/dev.sh restart [svc] Restart one or all services
  scripts/dev.sh seed          Run the sandbox seed script
  scripts/dev.sh watch         Start infra then stream all logs
EOF
}

cmd="${1:-up}"
shift || true

case "$cmd" in
  up)
    docker compose "${COMPOSE_ARGS[@]}" up -d --build
    echo "Dev environment is up. Frontend: http://localhost:3000  Backend: http://localhost:4000"
    ;;
  down)
    docker compose "${COMPOSE_ARGS[@]}" down
    ;;
  logs)
    docker compose "${COMPOSE_ARGS[@]}" logs -f "${1:-}"
    ;;
  watch)
    docker compose "${COMPOSE_ARGS[@]}" up -d --build
    docker compose "${COMPOSE_ARGS[@]}" logs -f
    ;;
  ps)
    docker compose "${COMPOSE_ARGS[@]}" ps
    ;;
  restart)
    if [ -n "${1:-}" ]; then
      docker compose "${COMPOSE_ARGS[@]}" restart "$1"
    else
      docker compose "${COMPOSE_ARGS[@]}" restart
    fi
    ;;
  seed)
    docker compose "${COMPOSE_ARGS[@]}" exec backend node /app/scripts/seed.js
    ;;
  *)
    usage
    exit 1
    ;;
esac
