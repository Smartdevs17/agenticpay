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
3. Install dependencies in the area you plan to change:

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

Use a short, imperative commit message in this format:

```text
type: brief summary
```

Recommended commit types:

- `feat`: new functionality
- `fix`: bug fixes
- `docs`: documentation updates
- `refactor`: code changes that do not change behavior
- `test`: adding or updating tests
- `chore`: maintenance work

Examples:

```text
docs: add contributing guide
fix: handle missing invoice validation
feat: add project payment status badge
```

Try to keep the summary under 72 characters and make each commit represent one logical change.

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
