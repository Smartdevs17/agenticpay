# Contributing to AgenticPay

Thanks for your interest in contributing to AgenticPay. This guide covers the expectations for code style, commits, pull requests, and testing so contributions are easy to review and merge.

## Project Structure

- `frontend/`: Next.js web application
- `backend/`: Express.js API server
- `contracts/`: Soroban smart contracts written in Rust

When possible, keep changes focused to a single area of the codebase. If a change spans multiple areas, call that out clearly in your pull request.

## Getting Started

1. Fork the repository and clone your fork.
2. Create a branch from `main`.
3. Install dependencies. `make doctor && make setup` checks your toolchain and installs everything, and `make` lists every dev task. To install only one area instead:

```bash
cd backend && npm install
cd frontend && npm install
cd contracts && cargo build
```

4. Configure any required environment variables described in [README.md](./README.md).

## Code Style Guidelines

### General

- Match the existing structure and naming patterns in the files you touch.
- Prefer small, focused pull requests over large mixed changes.
- Do not commit secrets, API keys, or `.env` files.
- Add or update tests when behavior changes.

### Frontend and Backend

- Use TypeScript for application code and keep types accurate.
- Run ESLint before opening a pull request.
- Avoid introducing `any` unless there is a clear reason and it is documented in the code.
- Remove unused imports, variables, and dead code before submitting.
- Keep components, routes, and services narrowly scoped to one responsibility.

Useful commands:

```bash
cd frontend && npm run lint
cd frontend && npm test

cd backend && npm run lint
cd backend && npm test
```

### Smart Contracts

- Follow existing Rust and Soroban patterns in `contracts/src/lib.rs`.
- Keep contract interfaces explicit and deterministic.
- Build and test contract changes before submitting.

Useful commands:

```bash
cd contracts && cargo test
cd contracts && cargo build --target wasm32-unknown-unknown --release
```

## Commit Message Format

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and
are checked automatically:

- **Locally** — `npm install` at the repo root installs a husky `commit-msg`
  hook that runs commitlint against [`commitlint.config.js`](./commitlint.config.js).
- **In CI** — the `Commitlint` workflow lints your **PR title**. PRs are
  squash-merged, so the title is the commit that lands on `main`.

```text
type(optional-scope)!: imperative summary, lower case, ≤ 100 chars
```

| Type | Use for | Release |
| --- | --- | --- |
| `feat` | new functionality | minor |
| `fix` | bug fixes | patch |
| `perf` | performance improvements | patch |
| `revert` | reverting a previous commit | patch |
| `docs`, `style`, `refactor`, `test`, `build`, `ci`, `chore` | everything else | none |

A `!` after the type/scope, or a `BREAKING CHANGE:` footer, triggers a major
release.

Examples:

```text
feat(payments): add razorpay gateway
fix: handle missing invoice validation
feat(api)!: drop v1 invoice routes
docs: add contributing guide
```

Make each commit one logical change. To bypass the hook for a work-in-progress
commit use `git commit --no-verify`; the PR title check still applies.

### Changelog and releases

Every push to `main` runs [semantic-release](https://semantic-release.gitbook.io/)
(`.github/workflows/release.yml`, configured in [`.releaserc.json`](./.releaserc.json)).
It reads the commits since the last tag, picks the next version from the table
above, prepends the release notes to [`CHANGELOG.md`](./CHANGELOG.md), tags the
release and publishes a GitHub Release. Never edit `CHANGELOG.md` by hand.

Preview what the next release would contain with
`npx semantic-release --dry-run --no-ci` (needs a `GITHUB_TOKEN`).

## Pull Request Process

1. Create a descriptive branch name such as `feat/payment-status` or `docs/contributing-guide`.
2. Make your changes in the smallest reasonable scope.
3. Run the relevant lint, test, and build commands for the areas you changed.
4. Push your branch and open a pull request against `main`.
5. In the pull request description, include:
   - a short summary of the change
   - linked issue or task reference, if available
   - testing notes describing what you ran
   - screenshots or recordings for UI changes, if applicable
6. Respond to review feedback with follow-up commits unless a maintainer asks for a squash or rebase.

## Testing Requirements

Every contribution should be verified before review.

- Frontend changes: run `npm run lint` and `npm test` in `frontend/`.
- Backend changes: run `npm run lint` and `npm test` in `backend/`.
- Contract changes: run `cargo test` and `cargo build --target wasm32-unknown-unknown --release` in `contracts/`.
- Cross-cutting changes: run checks for every affected area.
- If automated coverage is not practical, include clear manual verification steps in the pull request.

Pull requests may be sent back for updates if they do not include appropriate validation for the code they change.

## Questions and Support

If you are unsure about an implementation detail, open an issue or start a discussion before investing heavily in a large change. Early alignment helps us review and merge contributions faster.
