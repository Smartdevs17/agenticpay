# SDK Testing Guide

## Overview

The AgenticPay SDK provides comprehensive testing utilities to help you test applications that integrate with the payment platform without making real API calls.

## Mock Server

### TypeScript

```typescript
import { MockAgenticPayServer } from '@agenticpay/sdk-testing';

// Create a mock server
const server = await MockAgenticPayServer.create({
  routes: [
    {
      method: 'POST',
      path: '/verification/verify',
      body: { id: 'v_1', status: 'verified', score: 95 },
    },
    {
      method: 'GET',
      path: '/sandbox/status',
      body: { healthy: true, stellarTestnet: true, mockPayments: true },
    },
  ],
});

// Use the server URL to configure the SDK
const sdk = createTestSDK({ baseUrl: server.url });

// Make calls and assert
const result = await sdk.sandbox.getStatus();
expect(result.healthy).toBe(true);

// Inspect recorded requests
const requests = server.getRequests();
expect(requests).toHaveLength(1);
expect(requests[0].method).toBe('GET');

// Clean up
await server.close();
```

### Python

```python
from agenticpay.testing import MockAgenticPayServer, MockRoute, create_test_sdk

server = MockAgenticPayServer()
server.add_route(MockRoute(
    "POST",
    "/verification/verify",
    body={"id": "v_1", "status": "verified", "score": 95},
))
server.start()

sdk = create_test_sdk(base_url=server.url)
result = sdk.sandbox.get_status()
assert result["healthy"] is True

# Inspect requests
requests = server.get_requests()
assert len(requests) == 1

server.stop()
```

## Test Data Factories

Generate realistic mock data for your tests:

### TypeScript

```typescript
import { factories } from '@agenticpay/sdk-testing';

const plan = factories.plan({ name: 'Enterprise', amount: 99.99 });
const subscription = factories.subscription({ status: 'active' });
const escrow = factories.escrow({ totalAmount: 5000 });
const invoice = factories.invoice({ status: 'paid' });
const dispute = factories.dispute({ status: 'resolved' });
const event = factories.webhookEvent({ type: 'escrow.funded' });
```

### Python

```python
from agenticpay.testing import factories

plan = factories.plan(name="Enterprise", amount=99.99)
subscription = factories.subscription(status="active")
escrow = factories.escrow(total_amount=5000)
invoice = factories.invoice(status="paid")
```

## Dynamic Mock Responses

Handle complex test scenarios with handler functions:

### TypeScript

```typescript
server.addRoute({
  method: 'POST',
  path: '/refunds/evaluate',
  handler: (req) => {
    const body = req.body as any;
    if (body.requestedAmount > 1000) {
      return { status: 200, body: { decision: 'manual_review' } };
    }
    return { status: 200, body: { decision: 'approved', percentage: 100 } };
  },
});
```

## Webhook Testing

Generate valid webhook signatures for testing your webhook handlers:

### TypeScript

```typescript
import { createTestWebhookSignature } from '@agenticpay/sdk-testing';

const payload = JSON.stringify({ id: 'evt_1', type: 'payment.completed' });
const { signature, timestamp } = createTestWebhookSignature(payload, 'your-secret');

// Use in your webhook handler test
const isValid = verifyWebhookSignature({
  payload,
  signature,
  secret: 'your-secret',
  timestamp,
});
expect(isValid).toBe(true);
```

## Error Testing

Test error handling paths:

### TypeScript

```typescript
import { expectApiError } from '@agenticpay/sdk-testing';

server.addRoute({
  method: 'GET',
  path: '/escrow/nonexistent',
  status: 404,
  body: { error: { code: 'ERR_RESOURCE_NOT_FOUND', message: 'Escrow not found' } },
});

try {
  await sdk.escrow.get('nonexistent');
} catch (err) {
  const apiError = expectApiError(err, 404);
  expect(apiError.code).toBe('ERR_RESOURCE_NOT_FOUND');
}
```

## Request Assertions

Verify the SDK sent the correct requests:

### TypeScript

```typescript
import { expectRequest } from '@agenticpay/sdk-testing';

await sdk.escrow.create({
  projectId: 'proj_1',
  payerId: 'payer_1',
  payeeId: 'payee_1',
  currency: 'XLM',
  totalAmount: 1000,
  milestones: [...],
});

const req = expectRequest(server, {
  method: 'POST',
  path: '/escrow',
});
expect(req.body).toMatchObject({
  projectId: 'proj_1',
  currency: 'XLM',
});
```
