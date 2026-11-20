# Code owners and review rules

[`.github/CODEOWNERS`](../.github/CODEOWNERS) maps every path in the repo to
the people who must review changes to it. GitHub reads it to auto-request
reviewers on each PR and, with branch protection, to block merging until those
owners approve.

## Review rules

| Area | Paths | Rule |
| --- | --- | --- |
| Default | everything not listed below | 1 code-owner approval |
| Applications | `frontend/`, `backend/`, `workers/` | 1 code-owner approval |
| Shared packages & SDKs | `packages/`, `sdks/` | 1 code-owner approval |
| Docs, tests, dev env | `docs/`, `tests/`, `lighthouse/`, `scripts/`, `.devcontainer/`, `.kiro/` | 1 code-owner approval |
| Build & release tooling | root manifests and lockfile, `turbo.json`, `Makefile`, Dockerfiles, compose files, `commitlint.config.js`, `.husky/`, `.releaserc.json`, `CHANGELOG.md` | 1 code-owner approval |
| **High risk:** money movement, auth, data | `backend/src/{payments,auth,security,encryption,compliance}/`, `backend/payments/`, `backend/prisma/`, `backend/migrations/` | code-owner approval; reviewer checks idempotency, authz and migration reversibility |
| **High risk:** smart contracts | `contracts/`, `packages/contracts/` | code-owner approval; reviewer checks the audit / gas / fuzz jobs |
| **High risk:** infrastructure | `infra/` | code-owner approval |
| **High risk:** CI/CD & governance | `.github/`, `.github/workflows/`, `.github/CODEOWNERS` | code-owner approval; changes to `CODEOWNERS` need an owner of `CODEOWNERS` itself |

A PR that touches several areas needs an approval from an owner of **each**
area. The repo currently has a single maintainer, so every rule resolves to
`@Smartdevs17`; the per-area rules are in place so ownership can be delegated
by editing one line.

## Branch protection (repo admins)

CODEOWNERS only *requests* reviews until branch protection enforces them. On
**Settings → Branches → `main`** enable:

- **Require a pull request before merging**
  - **Require approvals** (1)
  - **Require review from Code Owners**
  - **Dismiss stale pull request approvals when new commits are pushed**
- **Require status checks to pass** — include `Repo tooling` and
  `PR title follows Conventional Commits`.

## Changing ownership

1. Edit `.github/CODEOWNERS`. The **last** matching pattern wins, so keep the
   `*` catch-all first and put more specific paths below broader ones.
2. Owners must be GitHub users or teams with **write** access. An owner without
   access makes the rule silently inert.
3. Run `node --test scripts/codeowners.test.mjs` (or `make test-tooling`).

What is checked:

- **Locally and in CI** (`scripts/codeowners.test.mjs`): syntax GitHub supports
  (no `!` negation or `[]` ranges), well-formed owners, a leading catch-all, no
  duplicate patterns, no pattern that matches zero tracked files, an explicit
  rule for every top-level directory, and that high-risk paths resolve to their
  intended rule.
- **In CI only** (the `Validate CODEOWNERS against GitHub` step of the
  `Repo tooling` job): the GitHub CODEOWNERS errors API, which reports unknown
  owners or owners without write access as annotations on the file.

Adding a new top-level directory fails the test until it gets a rule.
