#!/usr/bin/env bash
# Devcontainer orchestrator — Issue #794, extended in Issue #238.
#
# Brings up the full local stack (Postgres, Redis, local chains, backend,
# frontend) with a single command, without opening VS Code. For the IDE-driven
# flow use "Dev Containers: Reopen in Container" and then run the dev servers
# inside (or press F5 for the debug configurations in .vscode/launch.json).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE=".devcontainer/docker-compose.yml"
INFRA_SERVICES="postgres redis stellar"

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

compose_app() {
  docker compose -f "$COMPOSE_FILE" --profile app "$@"
}

usage() {
  cat <<'EOF'
Devcontainer stack orchestrator

Usage:
  scripts/devcontainer.sh up            Start Postgres, Redis, local chain, backend, frontend
  scripts/devcontainer.sh infra         Start only Postgres, Redis and the local Stellar node
  scripts/devcontainer.sh stellar       Start just the local Soroban/Stellar node
  scripts/devcontainer.sh evm           Start the local Hardhat EVM node (opt-in profile)
  scripts/devcontainer.sh down          Stop and remove the stack (keeps volumes)
  scripts/devcontainer.sh reset         Stop and delete the stack AND its volumes (destructive)
  scripts/devcontainer.sh logs [svc]    Tail logs (optionally for one service)
  scripts/devcontainer.sh ps            Show service status
  scripts/devcontainer.sh restart [svc]
  scripts/devcontainer.sh shell         Open a shell in the devcontainer service
  scripts/devcontainer.sh config        Validate the compose file

Resource allocation controls (issue #238) — override per service before running:
  DEV_POSTGRES_MEMORY=1G DEV_STELLAR_CPUS=2 DEV_BACKEND_MEMORY=4G scripts/devcontainer.sh up

After `up`:
  Frontend   : http://localhost:3000
  Backend    : http://localhost:3001/api/v1
  Postgres   : localhost:5432 (postgres/postgres)
  Redis      : localhost:6379
  Soroban RPC: http://localhost:8000/soroban/rpc
  Stellar Core: localhost:7001
  EVM (Hardhat): http://localhost:8545   (after `scripts/devcontainer.sh evm`)
EOF
}

cmd="${1:-up}"
shift || true

case "$cmd" in
  up)
    compose_app up -d --build
    echo "Stack is up."
    echo "  Frontend   : http://localhost:3000"
    echo "  Backend    : http://localhost:3001/api/v1"
    echo "  Soroban RPC: http://localhost:8000/soroban/rpc"
    ;;
  infra)
    compose up -d $INFRA_SERVICES
    ;;
  stellar)
    compose up -d stellar
    echo "Local Soroban RPC: http://localhost:8000/soroban/rpc"
    ;;
  evm)
    compose_app --profile evm up -d evm deps
    echo "Local EVM RPC: http://localhost:8545"
    ;;
  down)
    compose_app down
    ;;
  reset)
    if [ "${1:-}" != "--yes" ]; then
      echo "This deletes Postgres, Redis, Stellar and build-cache volumes."
      echo "Re-run with: scripts/devcontainer.sh reset --yes"
      exit 1
    fi
    compose_app --profile evm down -v
    ;;
  logs)
    compose_app logs -f "${1:-}"
    ;;
  ps)
    compose_app --profile evm ps
    ;;
  restart)
    if [ -n "${1:-}" ]; then
      compose_app restart "$1"
    else
      compose_app restart
    fi
    ;;
  shell)
    compose exec devcontainer bash
    ;;
  config)
    compose_app --profile evm config
    ;;
  *)
    usage
    exit 1
    ;;
esac
