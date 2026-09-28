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

Recommended VS Code extensions are installed automatically (ESLint, Prettier, Tailwind, Playwright, Rust Analyzer, Prisma, OpenAPI, Docker).

## Services

Inside the devcontainer, Postgres and Redis are reachable on `localhost` via Docker Compose networking:

- **Postgres:** `postgresql://postgres:postgres@localhost:5432/agenticpay`
- **Redis:** `redis://localhost:6379`

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

`scripts/devcontainer.sh` also supports `down`, `logs [service]`, `ps`,
`restart [service]`, `shell`, and `config` (validate the Compose file).

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

Re-run manually if needed:

```bash
bash .devcontainer/post-create.sh
```

## ARM (Apple Silicon) & Windows Notes

- **ARM/M1:** Images use multi-arch bases (`bookworm` Node image). Soroban CLI compiles from source on first create; allow extra time.
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
