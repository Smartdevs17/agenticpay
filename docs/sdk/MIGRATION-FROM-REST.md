# Migrating from REST API to SDK

This guide helps you transition from direct REST API calls to using the official AgenticPay SDK.

## Before (REST API)

```typescript
// Direct fetch calls
const response = await fetch('https://api.agenticpay.com/api/v1/verification/verify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.AGENTICPAY_API_KEY!,
  },
  body: JSON.stringify({
    repositoryUrl: 'https://github.com/user/repo',
    milestoneDescription: 'Build login',
    projectId: 'proj_123',
  }),
});

if (!response.ok) {
  const error = await response.json();
  throw new Error(error.message);
}

const result = await response.json();
```

## After (SDK)

```typescript
import { createAgenticPaySDK } from '@agenticpay/sdk';

const sdk = createAgenticPaySDK({
  baseUrl: 'https://api.agenticpay.com/api/v1',
  apiKey: process.env.AGENTICPAY_API_KEY!,
});

const result = await sdk.verification.verifyWork({
  repositoryUrl: 'https://github.com/user/repo',
  milestoneDescription: 'Build login',
  projectId: 'proj_123',
});
```

## Key Differences

| Aspect | REST API | SDK |
|--------|----------|-----|
| **Authentication** | Manual header management | Automatic with config |
| **Error handling** | Manual status code checking | Typed error classes |
| **Retries** | Must implement yourself | Built-in exponential backoff |
| **Types** | Must define yourself | Full TypeScript/Python/Go types |
| **URL construction** | Manual string building | Type-safe method calls |
| **Pagination** | Manual query params | Built-in pagination helpers |

## Error Handling Migration

### Before

```typescript
const response = await fetch(url, options);
if (response.status === 401) {
  // Handle auth error
} else if (response.status === 429) {
  // Handle rate limit
} else if (response.status >= 500) {
  // Handle server error
} else if (!response.ok) {
  // Handle other errors
}
```

### After

```typescript
try {
  const result = await sdk.verification.verifyWork({...});
} catch (err) {
  if (err instanceof AuthenticationError) { /* ... */ }
  else if (err instanceof RateLimitError) { /* ... */ }
  else if (err instanceof AgenticPayError && err.status >= 500) { /* ... */ }
  else if (err instanceof ValidationError) { /* ... */ }
}
```

## Testing Migration

### Before

```typescript
// Had to mock fetch globally
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ id: 'v_1' }),
});
```

### After

```typescript
import { MockAgenticPayServer, createTestSDK } from '@agenticpay/sdk-testing';

const server = await MockAgenticPayServer.create({
  routes: [
    { method: 'POST', path: '/verification/verify', body: { id: 'v_1' } },
  ],
});
const sdk = createTestSDK({ baseUrl: server.url });
```

## Endpoint Mapping

| REST Endpoint | SDK Method |
|--------------|------------|
| `POST /verification/verify` | `sdk.verification.verifyWork(input)` |
| `POST /verification/verify/batch` | `sdk.verification.verifyWorkBatch(items)` |
| `POST /invoice/generate` | `sdk.invoices.generate(input)` |
| `POST /splits` | `sdk.payments.createSplitConfig(input)` |
| `POST /splits/:id/execute` | `sdk.payments.executeSplit(input)` |
| `POST /refunds/policies` | `sdk.refunds.setPolicy(input)` |
| `POST /refunds/evaluate` | `sdk.refunds.evaluate(input)` |
| `POST /plans` | `sdk.subscriptions.createPlan(input)` |
| `POST /subscriptions/enroll` | `sdk.subscriptions.enroll(input)` |
| `DELETE /subscriptions/:id` | `sdk.subscriptions.cancel(id, input)` |
| `POST /escrow` | `sdk.escrow.create(input)` |
| `POST /escrow/:id/fund` | `sdk.escrow.fund(id, input)` |
| `POST /disputes` | `sdk.disputes.create(input)` |
| `GET /stellar/payment/:hash` | `sdk.stellar.getPayment(hash)` |
| `GET /sandbox/status` | `sdk.sandbox.getStatus()` |
