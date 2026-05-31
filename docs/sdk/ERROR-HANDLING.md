# SDK error handling (#408)

The SDK maps HTTP failures to typed errors in `packages/sdk/src/errors.ts`.

## Error types

| Class | HTTP | When |
|-------|------|------|
| `AuthenticationError` | 401 | Invalid or missing API key |
| `AuthorizationError` | 403 | Insufficient scope |
| `ValidationError` | 400 | Invalid request body |
| `RateLimitError` | 429 | Rate limit exceeded |
| `NetworkError` | — | Transport / DNS failures |
| `AgenticPayError` | any | Base class with `status`, `code`, `details` |

## Example

```ts
import {
  createAgenticPaySDK,
  RateLimitError,
  ValidationError,
} from '@agenticpay/sdk';

const sdk = createAgenticPaySDK({ baseUrl, apiKey });

try {
  await sdk.payments.createSplitConfig({ /* ... */ });
} catch (err) {
  if (err instanceof RateLimitError) {
    const retryAfter = (err.details as { retryAfter?: number })?.retryAfter ?? 60;
    console.warn(`Rate limited — retry in ${retryAfter}s`);
  } else if (err instanceof ValidationError) {
    console.error('Invalid payload', err.details);
  } else {
    throw err;
  }
}
```

## Retries

The HTTP client retries idempotent requests on 5xx and network errors with exponential backoff. Non-idempotent `POST` calls are not retried automatically.
