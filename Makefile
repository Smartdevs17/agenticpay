# AgenticPay developer tasks.
#
#   make            list every target (same as `make help`)
#   make doctor     check the local toolchain
#   make setup      install all dependencies
#
# Every target is a thin wrapper over the npm / cargo / forge / docker command
# it names, so `make -n <target>` shows exactly what will run. Tool binaries
# can be overridden, e.g. `make test-backend NPM=pnpm` or `make up COMPOSE="podman compose"`.
# Set VERBOSE=1 to echo commands; TIMINGS=1 to print each target's duration.

SHELL := /bin/bash
.DEFAULT_GOAL := help

NODE    ?= node
NPM     ?= npm
CARGO   ?= cargo
FORGE   ?= forge
DOCKER  ?= docker
COMPOSE ?= $(DOCKER) compose
NODE_MIN_MAJOR := 20

BACKEND   := backend
FRONTEND  := frontend
CONTRACTS := contracts
EVM       := contracts/evm
RELAYER   := contracts/bridges/relayer
SANDBOX_COMPOSE := -f docker-compose.yml -f docker-compose.sandbox.yml

ifneq ($(VERBOSE),1)
.SILENT:
endif

# $(call step,<message>) — banner shown before each task so long runs stay readable in CI logs.
step = printf '\033[1;34m▸ %s\033[0m\n' "$(1)"
# $(call require,<binary>,<install hint>) — fail fast with an actionable message instead of "command not found".
require = command -v $(firstword $(1)) >/dev/null 2>&1 || { printf '\033[1;31m✗ missing required tool: %s\033[0m — %s\n' "$(firstword $(1))" "$(2)" >&2; exit 127; }
# $(call timed,<target>,<command>) — run a command in a subshell and, with TIMINGS=1, report how long it took.
timed = start=$$(date +%s); ($(2)); status=$$?; \
	if [ "$(TIMINGS)" = "1" ]; then printf '⏱  %s finished in %ss (exit %s)\n' "$(1)" "$$(( $$(date +%s) - start ))" "$$status"; fi; \
	exit $$status

##@ Getting started

.PHONY: help
help: ## Show this help
	awk 'BEGIN { FS = ":.*## " } \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5); next } \
		/^[a-zA-Z0-9_-]+:.*## / { printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

.PHONY: doctor
doctor: ## Check required tools and versions
	$(call step,Checking toolchain)
	$(call require,$(NODE),install Node.js $(NODE_MIN_MAJOR)+ (https://nodejs.org or nvm))
	$(call require,$(NPM),npm ships with Node.js)
	major=$$($(NODE) -p 'process.versions.node.split(".")[0]'); \
	if [ "$$major" -lt $(NODE_MIN_MAJOR) ]; then \
		printf '\033[1;31m✗ Node.js %s found, %s+ required\033[0m\n' "$$major" "$(NODE_MIN_MAJOR)" >&2; exit 1; \
	fi; printf '✓ node %s\n' "$$($(NODE) --version)"
	for tool in "$(CARGO)|contract builds (https://rustup.rs)" "$(FORGE)|relayer contract tests (https://getfoundry.sh)" "$(DOCKER)|sandbox and integration stack"; do \
		bin=$${tool%%|*}; why=$${tool#*|}; bin=$${bin%% *}; \
		if command -v $$bin >/dev/null 2>&1; then printf '✓ %s\n' "$$bin"; else printf '\033[33m! %s not found — needed for %s\033[0m\n' "$$bin" "$$why"; fi; \
	done

.PHONY: setup
setup: install install-contracts ## Install every dependency (npm workspaces + contract toolchains)

.PHONY: install
install: ## Install npm workspace dependencies from the lockfile
	$(call require,$(NPM),install Node.js $(NODE_MIN_MAJOR)+)
	$(call step,Installing npm workspaces)
	$(call timed,install,$(NPM) ci)

.PHONY: install-contracts
install-contracts: ## Fetch Rust crates and EVM contract dependencies
	$(call require,$(CARGO),install Rust via https://rustup.rs)
	$(call step,Fetching contract dependencies)
	$(call timed,install-contracts,(cd $(CONTRACTS) && $(CARGO) fetch) && $(NPM) --prefix $(EVM) ci)

##@ Develop

.PHONY: dev
dev: ## Run backend and frontend in watch mode (turbo)
	$(call step,Starting dev servers)
	$(NPM) run dev

.PHONY: dev-backend
dev-backend: ## Run the API server in watch mode (http://localhost:3001)
	$(NPM) --prefix $(BACKEND) run dev

.PHONY: dev-frontend
dev-frontend: ## Run the Next.js app in watch mode (http://localhost:3000)
	$(NPM) --prefix $(FRONTEND) run dev

.PHONY: dev-contracts
dev-contracts: ## Watch, recompile and redeploy contracts (SCOPE=evm|soroban to narrow)
	$(NPM) run dev:contracts$(if $(SCOPE),:$(SCOPE))

.PHONY: log-viewer
log-viewer: ## Tail and filter structured backend logs
	$(NPM) run log-viewer

##@ Build

.PHONY: build
build: ## Build every workspace (turbo, cached)
	$(call step,Building workspaces)
	$(call timed,build,$(NPM) run build)

.PHONY: build-backend
build-backend: ## Compile the backend
	$(call timed,build-backend,$(NPM) --prefix $(BACKEND) run build)

.PHONY: build-frontend
build-frontend: ## Production build of the frontend
	$(call timed,build-frontend,$(NPM) --prefix $(FRONTEND) run build)

.PHONY: build-contracts
build-contracts: ## Build Soroban contracts to wasm and compile EVM contracts
	$(call require,$(CARGO),install Rust via https://rustup.rs)
	$(call step,Building contracts)
	$(call timed,build-contracts,(cd $(CONTRACTS) && $(CARGO) build --target wasm32-unknown-unknown --release) && $(NPM) --prefix $(EVM) run compile)

.PHONY: generate-api-hooks
generate-api-hooks: ## Regenerate typed API hooks from the OpenAPI spec (WATCH=1 to watch)
	$(NPM) run generate:api-hooks$(if $(filter 1,$(WATCH)),:watch)

.PHONY: openapi
openapi: ## Regenerate the backend OpenAPI document
	$(NPM) --prefix $(BACKEND) run openapi:generate

##@ Quality

.PHONY: lint
lint: ## Lint every workspace (turbo)
	$(call timed,lint,$(NPM) run lint)

.PHONY: lint-backend
lint-backend: ## Lint the backend
	$(NPM) --prefix $(BACKEND) run lint

.PHONY: lint-frontend
lint-frontend: ## Lint the frontend
	$(NPM) --prefix $(FRONTEND) run lint

.PHONY: lint-contracts
lint-contracts: ## Type-check EVM contract scripts and tests
	$(NPM) --prefix $(EVM) run lint

.PHONY: analyze-bundle
analyze-bundle: ## Report frontend bundle composition
	$(NPM) run analyze:bundle

.PHONY: lighthouse
lighthouse: ## Run Lighthouse CI against the frontend
	$(NPM) run lighthouse:ci

##@ Test

.PHONY: test
test: ## Run every workspace test suite (turbo) and the docs index check
	$(call step,Running tests)
	$(call timed,test,$(NPM) test)

.PHONY: test-backend
test-backend: ## Run backend unit tests (FILE=path to run one file)
	$(NPM) --prefix $(BACKEND) run test$(if $(FILE), -- $(FILE))

.PHONY: test-frontend
test-frontend: ## Run frontend unit tests (FILE=path to run one file)
	$(NPM) --prefix $(FRONTEND) run test$(if $(FILE), -- $(FILE))

.PHONY: test-e2e
test-e2e: ## Run frontend Playwright end-to-end tests
	$(NPM) --prefix $(FRONTEND) run test:e2e

.PHONY: test-contracts
test-contracts: test-contracts-soroban test-contracts-evm test-contracts-relayer ## Run every contract test suite

.PHONY: test-contracts-soroban
test-contracts-soroban: ## Run Soroban contract tests (cargo)
	$(call require,$(CARGO),install Rust via https://rustup.rs)
	$(call timed,test-contracts-soroban,cd $(CONTRACTS) && $(CARGO) test)

.PHONY: test-contracts-evm
test-contracts-evm: ## Run Hardhat EVM contract tests
	$(call timed,test-contracts-evm,$(NPM) --prefix $(EVM) test)

.PHONY: test-contracts-relayer
test-contracts-relayer: ## Run settlement proof relay Foundry tests
	$(call require,$(FORGE),install Foundry via https://getfoundry.sh)
	$(call timed,test-contracts-relayer,$(FORGE) test --root $(RELAYER))

.PHONY: test-tooling
test-tooling: ## Test repo tooling: Makefile, turbo config, docs index
	$(NODE) --test scripts/*.test.mjs scripts/*/*.test.mjs

.PHONY: test-integration
test-integration: ## Run integration tests in docker, then tear the stack down
	$(call require,$(DOCKER),install Docker Desktop or Docker Engine)
	$(call timed,test-integration,$(NPM) run test:integration; rc=$$?; $(NPM) run test:integration:down; exit $$rc)

.PHONY: test-mutation
test-mutation: ## Run backend mutation tests (Stryker)
	$(NPM) run test:mutation

.PHONY: test-smoke
test-smoke: ## Smoke-test a deployed environment
	$(NPM) run test:smoke

.PHONY: load-test
load-test: ## Run k6 load tests (SMOKE=1 for the short smoke profile)
	$(NPM) run load:k6$(if $(filter 1,$(SMOKE)),:smoke)

##@ Database

.PHONY: db-generate
db-generate: ## Generate the Prisma client
	$(NPM) --prefix $(BACKEND) run db:generate

.PHONY: db-migrate
db-migrate: ## Apply pending migrations
	$(NPM) --prefix $(BACKEND) run db:migrate

.PHONY: db-status
db-status: ## Show migration status
	$(NPM) --prefix $(BACKEND) run db:migrate:status

.PHONY: db-rollback
db-rollback: ## Roll back the most recent migration
	$(NPM) --prefix $(BACKEND) run db:rollback:one

.PHONY: db-seed
db-seed: ## Seed the database
	$(NPM) --prefix $(BACKEND) run db:seed

.PHONY: db-studio
db-studio: ## Open Prisma Studio
	$(NPM) --prefix $(BACKEND) run db:studio

.PHONY: db-reset
db-reset: ## Drop and re-create the database (CONFIRM=1 required)
	if [ "$(CONFIRM)" != "1" ]; then \
		printf '\033[1;31m✗ db-reset destroys all local data — re-run with CONFIRM=1\033[0m\n' >&2; exit 1; \
	fi
	$(NPM) --prefix $(BACKEND) run db:reset

##@ Local stack

.PHONY: up
up: ## Start the docker-compose stack in the background
	$(call require,$(DOCKER),install Docker Desktop or Docker Engine)
	$(COMPOSE) up -d

.PHONY: down
down: ## Stop the docker-compose stack
	$(COMPOSE) down

.PHONY: logs
logs: ## Follow docker-compose logs
	$(COMPOSE) logs -f

.PHONY: sandbox-up
sandbox-up: ## Start the sandbox stack and seed it
	$(call require,$(DOCKER),install Docker Desktop or Docker Engine)
	$(NPM) run sandbox:up

.PHONY: sandbox-down
sandbox-down: ## Stop the sandbox stack
	$(NPM) run sandbox:down

.PHONY: sandbox-reset
sandbox-reset: ## Recreate the sandbox stack from scratch
	$(NPM) run sandbox:reset

.PHONY: sandbox-logs
sandbox-logs: ## Follow sandbox logs
	$(NPM) run sandbox:logs

.PHONY: sandbox-seed
sandbox-seed: ## Re-seed sandbox data
	$(NPM) run sandbox:seed

.PHONY: sandbox-faucet
sandbox-faucet: ## Fund sandbox accounts from the testnet faucet
	$(NPM) run sandbox:faucet

##@ Housekeeping

.PHONY: clean
clean: ## Remove build outputs, coverage and turbo caches (keeps node_modules)
	$(call step,Removing build artifacts)
	rm -rf $(BACKEND)/dist $(BACKEND)/coverage $(FRONTEND)/.next $(FRONTEND)/coverage \
		packages/*/dist .turbo node_modules/.cache/turbo $(RELAYER)/out $(RELAYER)/cache

.PHONY: clean-all
clean-all: clean ## Also remove every node_modules and the cargo target dir
	rm -rf node_modules */node_modules packages/*/node_modules $(EVM)/node_modules
	if command -v $(CARGO) >/dev/null 2>&1; then (cd $(CONTRACTS) && $(CARGO) clean); fi
