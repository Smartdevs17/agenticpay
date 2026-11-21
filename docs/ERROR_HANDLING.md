# Unified Error Response Contract

Documented under Issue #1402: Unification of error response middleware across backend and edge workers.

## Error Response Shape

All HTTP 4xx and 5xx responses from both the Express backend and the Cloudflare Workers edge conform to a single standardized JSON schema:

```json
{
  "error": {
    "code": "ERR_VALIDATION_FAILED",
    "message": "Request validation failed",
    "status": 400,
    "details": {
      "field": "amount",
      "reason": "Must be greater than 0"
    },
    "requestId": "req_01h8abc123xyz",
    "retryAfter": 30
  }
}
```

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `code` | string | **Yes** | Stable, machine-readable uppercase error identifier prefixed with `ERR_` |
| `message` | string | **Yes** | Human-readable explanation. Safe for public consumption in production |
| `status` | number | **Yes** | Canonical HTTP status code matching the response status |
| `details` | unknown | No | Optional structured context (e.g. schema violation list, resource ID) |
| `requestId` | string | No | Correlation identifier extracted from `X-Request-Id` or request context |
| `retryAfter` | number | No | Number of seconds to wait before retrying (used on `429 Rate Limit`) |
| `stack` | string | No | Developer stack trace (strictly non-production, unknown errors only) |

## Standard Error Codes

Defined in `@agenticpay/error-codes`:

| Code | HTTP Status | Category | Description |
|---|---|---|---|
| `ERR_AUTH_UNAUTHENTICATED` | 401 | auth | Request lacks valid authentication credentials |
| `ERR_AUTH_FORBIDDEN` | 403 | auth | Principal is not authorized to perform this operation |
| `ERR_VALIDATION_FAILED` | 400 | validation | Request body, query, or parameters failed schema validation |
| `ERR_RESOURCE_NOT_FOUND` | 404 | validation | Requested URL or resource does not exist |
| `ERR_CONFIG_INVALID_VALUE`| 400 | configuration | Provided configuration did not match registered schema |
| `ERR_CONFIG_CONFLICT` | 409 | configuration | Unique constraint or concurrent modification conflict |
| `ERR_PAYMENT_INSUFFICIENT_FUNDS` | 402 | payment | Payer does not have sufficient balance for payment |
| `ERR_BLOCKCHAIN_TRANSACTION_FAILED` | 502 | blockchain | Upstream blockchain node/Horizon rejected transaction |
| `ERR_RATE_LIMIT_EXCEEDED` | 429 | rate_limit | Client exceeded configured request allowance |
| `ERR_INTERNAL` | 500 | internal | Unexpected server or edge isolate error |

## Backend Error Hierarchy

In `backend/src/middleware/errorHandler.ts`:
- `AppError`: Base operational error with `statusCode`, `code`, `details`, and `retryAfter`.
- `ValidationError`: Pre-configured with status 400 and code `ERR_VALIDATION_FAILED`.
- `AuthError`: Status 401, `ERR_AUTH_UNAUTHENTICATED`.
- `ForbiddenError`: Status 403, `ERR_AUTH_FORBIDDEN`.
- `NotFoundError`: Status 404, `ERR_RESOURCE_NOT_FOUND`.
- `ConflictError`: Status 409, `ERR_CONFIG_CONFLICT`.
- `RateLimitError`: Status 429, `ERR_RATE_LIMIT_EXCEEDED`.
- `BlockchainError`: Status 502, `ERR_BLOCKCHAIN_TRANSACTION_FAILED`.

Prisma database exceptions (such as `P2002` duplicate key and `P2025` record not found) are automatically caught and normalized into `ConflictError` or `NotFoundError` without exposing table names or SQL queries.

## Edge Workers Integration

Cloudflare Workers in `workers/src/` use the adapter in `workers/src/errors.ts`:
- Replaces raw plain-text responses (`new Response('Forbidden', { status: 403 })`) with JSON adhering to the unified error response format.
- Translates bot blocks, edge rate limiting, and missing sessions to standard `ERR_*` structures.

## How to Add a New Error Code

1. Add the definition to `packages/error-codes/src/index.ts` in `ERROR_CODE_REGISTRY`.
2. Map any legacy alias in `LEGACY_CODE_MAP`.
3. If needed, subclass `AppError` in `backend/src/middleware/errorHandler.ts`.
