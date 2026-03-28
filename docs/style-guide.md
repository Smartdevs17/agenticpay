# Code Style Guide

This document defines the coding standards and best practices for contributors to ensure consistency, readability, and maintainability across the AgenticPay codebase.

---

## TypeScript Style

### General Rules
- Enable strict typing (`strict: true`)
- Avoid using `any`; prefer explicit types or `unknown`
- Use `interface` for object shapes and `type` for unions

### Naming Conventions
- Variables & functions: `camelCase`
- Types & interfaces: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`

### File Naming
- Use `kebab-case` for files
  - `user-service.ts`
  - `transfer-utils.ts`

### Functions
- Keep functions small and single-purpose
- Always type function parameters and return values

```ts
function calculateFee(amount: number): number {
  return amount * 0.01;
}
```

## React Patterns

### Components
- Use functional components only
- Prefer arrow functions

```ts
const SendButton = () => {
  return <button>Send</button>;
};
```

### Hooks
- Use React hooks (`useState`, `useEffect`) properly
- Extract reusable logic into custom hooks

### State Management
- Keep state as minimal as possible
- Avoid deeply nested state
- Use derived state where possible

### Styling
- Use TailwindCSS utility classes
- Avoid hardcoded colors, prefer theme-aware classes (`dark`: variants)

## Rust / Soroban Style

### General
- Follow Rust standard formatting (`cargo fmt`)
- Lint with `cargo clippy`

### Naming
- Functions: `snake_case`
- Structs/Enums: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`

### Modules
- Keep modules focused and small
- Group related logic together

### Error Handling
- Use `Result<T, E>` for fallible operations
- Avoid panics in production code


```rust
pub fn deposit(amount: i128) -> Result<(), Error> {
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    Ok(())
}
```

## Git Workflow

### Branch Naming
Use the following conventions:

- `feat/short-description`
- `fix/short-description`
- `docs/short-description`
- `chore/short-description`
- `refactor/short-description`

Example:
```
feat/add-transfer-endpoint
fix/incorrect-balance-calculation
```

## Commit Messages (Conventional Commits)
Follow this format:
```
type: short description
```
Examples:

- `feat: add transfer API endpoint`
- `fix: resolve balance overflow issue`
- `docs: add style guide`

## Pull Requests
Before submitting a PR:

- Ensure code builds successfully
- Run all tests
- Follow the style guide
- Keep PRs small and focused
- Reference related issues (e.g. `Closes #12`)

## Best Practices
- Write readable and self-documenting code
- Avoid duplication, reuse existing logic
- Add comments only when necessary
- Keep functions and components small
- Prioritize clarity over cleverness

## Summary
Consistency is key. Following this guide ensures:

- Easier code reviews
- Better collaboration
- Higher code quality




