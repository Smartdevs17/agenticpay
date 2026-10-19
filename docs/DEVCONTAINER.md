# Devcontainer Setup

One-click development environment for AgenticPay with Node.js, Rust, Soroban CLI, Postgres, and Redis.

## Quick Start

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine on Linux).
2. Install the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension in VS Code or Cursor.
3. Open the repository and run **Dev Containers: Reopen in Container**.
4. Wait for `post-create.sh` to finish (dependencies, contract build, OpenAPI generation).

## What's Included

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 22 | Frontend, backend, workers |
| Rust | stable | Soroban smart contracts |
| Soroban CLI | 21.x | Contract build & deploy |
| PostgreSQL | 16 | Application database |
| Redis | 7 | Cache & job queues |
| Stellar Quickstart | latest | Local Soroban RPC + Stellar Core |
| Hardhat | local | Local EVM chain (opt-in `evm` profile) |

Recommended VS Code extensions are installed automatically (ESLint, Prettier, Tailwind, Playwright, Rust Analyzer, Prisma, OpenAPI, Docker).

## Services

Inside the devcontainer, Postgres, Redis and the local chain are reachable on
`localhost` via Docker Compose networking:

- **Postgres:** `postgresql://postgres:postgres@localhost:5432/agenticpay`
- **Redis:** `redis://localhost:6379`
- **Soroban RPC:** `http://localhost:8000/soroban/rpc`
- **Stellar Core:** `localhost:7001`
- **EVM (Hardhat):** `http://localhost:8545` (after `scripts/devcontainer.sh evm`)

On the host machine (without devcontainer), start the same stack:

```bash
docker compose up -d
```

## One-command stack (no IDE required)

To run Postgres, Redis, the backend, and the frontend together without opening
VS Code:

```bash
scripts/devcontainer.sh up
```

Under the hood this starts the `backend`, `frontend`, and one-time `deps` install
services behind the `app` Compose profile, so they are **not** started when the
devcontainer opens (you run the dev servers yourself in that flow) — only when
you ask for them:

```bash
docker compose -f .devcontainer/docker-compose.yml --profile app up -d --build
```

| Service | URL / address |
|---------|---------------|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:3001/api/v1 |
| Postgres | `localhost:5432` (postgres/postgres) |
| Redis | `localhost:6379` |
| Soroban RPC | http://localhost:8000/soroban/rpc |
| Stellar Core | `localhost:7001` |
| EVM (Hardhat) | http://localhost:8545 |

`scripts/devcontainer.sh` also supports `infra` (Postgres + Redis + local chain
only), `stellar`, `evm`, `down`, `reset`, `logs [service]`, `ps`,
`restart [service]`, `shell`, and `config` (validate the Compose file).

## Local Blockchain Nodes

Two chains are available locally so contract work never needs a testnet:

**Soroban / Stellar (started by default).** The `stellar` service runs
`stellar/stellar-quickstart` in local mode, matching the sandbox stack in
`docker-compose.sandbox.yml` so behaviour is identical whichever workflow you
use. It is a dependency of the devcontainer, and the backend receives
`STELLAR_RPC_URL` / `SOROBAN_RPC_URL` pointing at it.

```bash
scripts/devcontainer.sh stellar          # start just this service
curl http://localhost:8000/health        # readiness probe
```

**EVM / Hardhat (opt-in).** The `evm` service is behind the `evm` profile
because its image is large and most work does not need it:

```bash
scripts/devcontainer.sh evm
curl -X POST http://localhost:8545 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```

## Debug Configurations

Debug configurations ship as tracked templates in `.devcontainer/vscode/`;
`post-create.sh` copies them into `.vscode/` on create (the directory is
gitignored, and existing user files are never overwritten). Press **F5** to use
them:

| Configuration | What it does |
|---------------|--------------|
| Backend: API (debug) | `tsx watch` with the inspector on port 9229 |
| Backend: API (no watch) | Same, without file watching (better breakpoints) |
| Backend: current test file | Runs the open Vitest file under the debugger |
| Frontend: Next.js (debug) | Next dev server with child-process auto-attach |
| Contracts: Soroban tests | `cargo test` for `contracts/` |
| Attach to backend (9229) | Attach to an already-running backend |

A **Full stack (backend + frontend)** compound starts both at once. Port 9229
is forwarded by `devcontainer.json`, so breakpoints also work from the host.
The same directory provides `tasks.json`, exposing the stack and chain commands
as VS Code tasks. Re-run `bash .devcontainer/post-create.sh` to reinstall the
templates after changing them.

## Resource Allocation Controls

Every service has CPU/memory limits and reservations in
`.devcontainer/docker-compose.yml`, all overridable by environment variable so
constrained machines can be dialled down without editing the file:

```bash
DEV_POSTGRES_MEMORY=256M DEV_REDIS_MEMORY=128M \
DEV_STELLAR_CPUS=1 DEV_BACKEND_MEMORY=1G \
  scripts/devcontainer.sh up
```

| Variable | Default |
|----------|---------|
| `DEV_DEVCONTAINER_CPUS` / `DEV_DEVCONTAINER_MEMORY` | `4.0` / `6G` |
| `DEV_POSTGRES_CPUS` / `DEV_POSTGRES_MEMORY` | `1.0` / `512M` |
| `DEV_REDIS_CPUS` / `DEV_REDIS_MEMORY` | `0.5` / `256M` |
| `DEV_STELLAR_CPUS` / `DEV_STELLAR_MEMORY` | `2.0` / `2G` |
| `DEV_BACKEND_CPUS` / `DEV_BACKEND_MEMORY` | `2.0` / `2G` |
| `DEV_FRONTEND_CPUS` / `DEV_FRONTEND_MEMORY` | `2.0` / `2G` |

`devcontainer.json` also declares `hostRequirements` (4 CPUs / 8 GB RAM /
32 GB disk) so Dev Containers refuses to start on a host that cannot run the
stack instead of failing halfway through.

## Volume Persistence

Named volumes keep state across `scripts/devcontainer.sh down` / `up`:

| Volume | Holds |
|--------|-------|
| `postgres-data` | Database |
| `redis-data` | Cache / queue AOF |
| `stellar-data` | Ledger state — deployed contracts survive restarts |
| `hardhat-cache` | Hardhat compilation cache |
| `node-modules` | Shared install across backend/frontend/deps |
| `contract-target` | Rust build cache for Soroban contracts |

To wipe everything and start clean (destructive — also drops the database):

```bash
scripts/devcontainer.sh reset --yes
```

## Environment Variables

The devcontainer sets safe defaults in `devcontainer.json`. Copy and customize for secrets:

```bash
cp backend/.env.example backend/.env   # if present
# Set OPENAI_API_KEY, Web3Auth keys, etc.
```

## Post-Create Script

`.devcontainer/post-create.sh` runs automatically and:

1. Adds the `wasm32-unknown-unknown` Rust target
2. Installs Soroban CLI via Cargo
3. Runs `npm ci` for all workspaces
4. Generates Prisma client
5. Builds Soroban contracts (`contracts/`)
6. Generates OpenAPI documentation
7. Installs Playwright Chromium for E2E tests
8. Installs the `.vscode/` debug + task templates from `.devcontainer/vscode/`

Re-run manually if needed:

```bash
bash .devcontainer/post-create.sh
```

## ARM (Apple Silicon) & Windows Notes

- **ARM/M1:** Images use multi-arch bases (`bookworm` Node image). Soroban CLI compiles from source on first create; allow extra time. `postgres`, `redis` and `stellar` are arm64-native; the EVM node defaults to `linux/amd64` (emulated) and can be pinned with `DEV_EVM_PLATFORM=linux/arm64`.
- **Windows:** Use WSL2 backend for Docker. Open the repo from the WSL filesystem (`\\wsl$\...`) to avoid slow bind mounts. If file watching is unreliable, set `"mountType": "delegated"` in devcontainer overrides.

## Running the App

```bash
# Terminal 1 — API (port 3001)
cd backend && npm run dev

# Terminal 2 — Web (port 3000)
cd frontend && npm run dev
```

API docs: `http://localhost:3001/docs` (Swagger UI)

## CI Validation

The Devcontainer image is built on every PR via `.github/workflows/devcontainer.yml` to catch Dockerfile and compose regressions early.
