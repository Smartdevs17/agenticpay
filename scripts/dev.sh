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
  scripts/dev.sh dev [target]    Run dev servers in watch mode (target: all, backend, frontend, contracts, packages, or <pkg>)
  scripts/dev.sh build [target]  Build workspaces (target: all, backend, frontend, contracts, packages, or <pkg>)
  scripts/dev.sh lint [target]   Lint workspaces (target: all, backend, frontend, contracts, packages, or <pkg>)
  scripts/dev.sh test [target]   Run tests (target: all, backend, frontend, contracts, packages, or <pkg>)
  scripts/dev.sh up              Start infra + backend + frontend with hot reload
  scripts/dev.sh down            Stop all services
  scripts/dev.sh logs [svc]      Tail logs (optionally for a single service)
  scripts/dev.sh ps              Show service status
  scripts/dev.sh restart [svc]   Restart one or all services
  scripts/dev.sh seed            Run the sandbox seed script
  scripts/dev.sh watch           Start infra then stream all logs
EOF
}

run_make_target() {
  local action="$1"
  local target="${2:-all}"

  case "$target" in
    all|"")
      make "$action"
      ;;
    backend|frontend|contracts|packages)
      make "${action}-${target}"
      ;;
    packages/*)
      local pkg="${target#packages/}"
      make "${action}-packages" "PKG=${pkg}"
      ;;
    *)
      if [ -d "packages/$target" ]; then
        make "${action}-packages" "PKG=${target}"
      else
        echo "Error: Unknown target '$target'. Supported targets: all, backend, frontend, contracts, packages, or a package under packages/" >&2
        exit 1
      fi
      ;;
  esac
}

cmd="${1:-up}"
shift || true

case "$cmd" in
  dev|build|lint|test)
    run_make_target "$cmd" "${1:-all}"
    ;;
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
  help|-h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
