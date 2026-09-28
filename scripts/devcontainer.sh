#!/usr/bin/env bash
# Devcontainer orchestrator — Issue #794
#
# Brings up the full local stack (Postgres, Redis, backend, frontend) with a
# single command, without opening VS Code. For the IDE-driven flow use
# "Dev Containers: Reopen in Container" and then run the dev servers inside.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE=".devcontainer/docker-compose.yml"
PROFILE="app"

compose() {
  docker compose -f "$COMPOSE_FILE" --profile "$PROFILE" "$@"
}

usage() {
  cat <<'EOF'
Devcontainer stack orchestrator

Usage:
  scripts/devcontainer.sh up        Build and start Postgres, Redis, backend, frontend
  scripts/devcontainer.sh down      Stop and remove the stack
  scripts/devcontainer.sh logs [svc] Tail logs (optionally for one service)
  scripts/devcontainer.sh ps        Show service status
  scripts/devcontainer.sh restart [svc]
  scripts/devcontainer.sh shell     Open a shell in the devcontainer service
  scripts/devcontainer.sh config    Validate the compose file

After `up`:
  Frontend : http://localhost:3000
  Backend  : http://localhost:3001/api/v1
  Postgres : localhost:5432 (postgres/postgres)
  Redis    : localhost:6379
EOF
}

cmd="${1:-up}"
shift || true

case "$cmd" in
  up)
    compose up -d --build
    echo "Stack is up. Frontend: http://localhost:3000  Backend: http://localhost:3001/api/v1"
    ;;
  down)
    compose down
    ;;
  logs)
    compose logs -f "${1:-}"
    ;;
  ps)
    compose ps
    ;;
  restart)
    if [ -n "${1:-}" ]; then
      compose restart "$1"
    else
      compose restart
    fi
    ;;
  shell)
    compose exec devcontainer bash
    ;;
  config)
    compose config
    ;;
  *)
    usage
    exit 1
    ;;
esac
