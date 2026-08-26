# Result pattern migration guide

Issue #374 introduces explicit `Result<T, E>` handling for expected service failures.

## Service contract

Services should return `Promise<Result<T>>` for expected business outcomes:

```ts
const result = await projectService.getProject(id, tenantId);
if (!result.ok) return result;
return ok(result.value);
```

Use Result errors for validation, not-found, forbidden, and conflict cases. Reserve thrown exceptions for unexpected runtime failures such as programming errors, dependency crashes, or unavailable infrastructure.

## Controller contract

Controllers should map Result values to HTTP responses at the edge:

```ts
const result = await service.updateProject(id, body, tenantId);
this.sendResult(res, result, (project) => {
  res.apiSuccess(project);
});
```

This keeps business logic deterministic and avoids relying on exception control flow for normal client errors.

## Error hierarchy

Shared primitives live in `packages/types/src/exports.ts` for SDK/API consumers and `backend/src/lib/result.ts` for backend runtime code. Use the following status conventions:

- `VALIDATION_ERROR`: 400
- `NOT_FOUND`: 404
- `FORBIDDEN`: 403
- `CONFLICT`: 409
- `INTERNAL_ERROR`: 500 for unexpected failures only

## Incremental migration checklist

1. Change one service method at a time to return `Promise<Result<T>>`.
2. Replace expected `throw` calls with typed `validationFailure`, `notFoundFailure`, `forbiddenFailure`, or `conflictFailure` helpers.
3. Update controller call sites to use `sendResult`.
4. Update tests to assert Result envelopes for service tests and HTTP envelopes for controller tests.
5. Keep third-party library calls wrapped at service boundaries so library exceptions become `INTERNAL_ERROR` only when they are genuinely unexpected.
