# SDK Error Handling Guide

## Error Hierarchy

All SDKs implement a consistent error hierarchy that maps HTTP status codes to typed exceptions:

```
AgenticPayError (base)
├── AuthenticationError (401)
├── AuthorizationError (403)
├── ValidationError (400)
├── NotFoundError (404)
├── RateLimitError (429)
├── NetworkError (connection failures)
└── AgenticPayApiError (registry-based errors)
    ├── AuthUnauthenticatedError
    ├── AuthForbiddenError
    ├── RequestValidationError
    ├── ResourceNotFoundError
    ├── PaymentInsufficientFundsError
    ├── BlockchainTransactionFailedError
    ├── ApiRateLimitError
    └── InternalApiError
```

## Error Properties

All errors provide:

| Property | Type | Description |
|----------|------|-------------|
| `message` | string | Human-readable error description |
| `status` | number? | HTTP status code (if applicable) |
| `code` | string? | Machine-readable error code (e.g., `ERR_VALIDATION_FAILED`) |
| `details` | any? | Additional error context (validation errors, field details, etc.) |

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `ERR_AUTH_UNAUTHENTICATED` | 401 | Missing or invalid authentication |
| `ERR_AUTH_FORBIDDEN` | 403 | Insufficient permissions |
| `ERR_VALIDATION_FAILED` | 400 | Request validation failure |
| `ERR_RESOURCE_NOT_FOUND` | 404 | Resource does not exist |
| `ERR_CONFIG_INVALID_VALUE` | 400 | Configuration value invalid |
| `ERR_CONFIG_CONFLICT` | 409 | Resource conflict |
| `ERR_PAYMENT_INSUFFICIENT_FUNDS` | 402 | Insufficient funds for payment |
| `ERR_BLOCKCHAIN_TRANSACTION_FAILED` | 502 | On-chain transaction failure |
| `ERR_RATE_LIMIT_EXCEEDED` | 429 | Rate limit exceeded |
| `ERR_INTERNAL` | 500 | Internal server error |

## Best Practices

### 1. Always handle errors at the call site

```typescript
try {
  const escrow = await sdk.escrow.create({...});
} catch (err) {
  if (err instanceof ValidationError) {
    showFieldErrors(err.details);
  } else if (err instanceof AuthenticationError) {
    redirectToLogin();
  } else {
    showGenericError();
  }
}
```

### 2. Implement retry with backoff for transient errors

```python
import time
from agenticpay import RateLimitError, NetworkError

def call_with_retry(fn, max_retries=3):
    for attempt in range(max_retries):
        try:
            return fn()
        except (RateLimitError, NetworkError):
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise
```

### 3. Log error codes for debugging

```go
result, err := client.Escrow.Create(ctx, params)
if err != nil {
    if apiErr, ok := err.(*agenticpay.APIError); ok {
        log.Printf("API error code=%s status=%d message=%s",
            apiErr.Code, apiErr.StatusCode, apiErr.Message)
    }
    return err
}
```

### 4. Handle blockchain-specific errors

```typescript
try {
  await sdk.escrow.fund(escrowId, { amount: 1000 });
} catch (err) {
  if (err instanceof BlockchainTransactionFailedError) {
    // Stellar transaction failed - check network status
    const status = await sdk.stellar.getNetworkStatus();
    if (!status.healthy) {
      console.log('Stellar network is currently unhealthy');
    }
  }
}
```
