# Webhook Retry Strategy

## Overview

This document describes the webhook delivery and retry strategy for AgenticPay. It ensures reliable event notification delivery to merchant endpoints with exponential backoff and circuit breaker patterns.

## Issue

**#1158 - Improve documentation (iteration 5)**

This documentation increment covers the webhook retry mechanism, failure handling, and best practices for webhook consumers.

## Webhook Delivery Flow

```
Event Triggered → Webhook Queued → Delivery Attempt
                                         ↓
                                    Success? → Mark Delivered
                                         ↓
                                       Failed
                                         ↓
                                  Retry with Backoff
                                         ↓
                                  Max Retries? → Mark Failed & Alert
```

## Retry Configuration

### Default Settings

```typescript
const DEFAULT_WEBHOOK_CONFIG = {
  maxRetries: 5,
  initialBackoffMs: 1000,      // 1 second
  maxBackoffMs: 300000,         // 5 minutes
  backoffMultiplier: 2,         // Exponential backoff
  timeoutMs: 10000,             // 10 second request timeout
  circuitBreakerThreshold: 10,  // Failed attempts before opening circuit
  circuitBreakerResetMs: 60000, // 1 minute cooldown
};
```

### Retry Schedule

| Attempt | Delay | Cumulative Time |
|---------|-------|-----------------|
| 1 | Immediate | 0s |
| 2 | 1s | 1s |
| 3 | 2s | 3s |
| 4 | 4s | 7s |
| 5 | 8s | 15s |
| 6 | 16s | 31s |

After 6 attempts over ~30 seconds, the webhook is marked as failed and requires manual intervention.

## HTTP Response Handling

### Success Conditions

Webhook delivery is considered successful when:
- HTTP status code is 2xx (200-299)
- Response received within timeout window
- No network errors

### Retry Conditions

Webhooks are retried on:
- HTTP 5xx errors (server errors)
- HTTP 429 (rate limit - respects Retry-After header)
- Network timeouts
- Connection refused/reset
- DNS resolution failures

### No Retry Conditions

Webhooks are NOT retried on:
- HTTP 4xx errors (except 429) - indicates client error
- Invalid SSL certificates (security policy)
- Endpoint returns malformed response

## Circuit Breaker

The circuit breaker protects both systems from cascading failures:

### States

1. **Closed (Normal)**: All webhooks delivered normally
2. **Open (Failing)**: No delivery attempts, webhooks queued
3. **Half-Open (Testing)**: Single probe request to test recovery

### Behavior

- Circuit opens after 10 consecutive failures to same endpoint
- While open, webhooks are queued but not delivered
- After 1 minute cooldown, circuit moves to half-open
- Single successful delivery closes circuit
- Single failed delivery reopens circuit

## Event Types and Priority

### High Priority (Immediate delivery, aggressive retry)

- `payment.completed`
- `payment.failed`
- `escrow.released`
- `subscription.canceled`

### Standard Priority (Normal retry schedule)

- `invoice.created`
- `customer.updated`
- `dispute.opened`

### Low Priority (Delayed delivery, reduced retries)

- `analytics.generated`
- `report.ready`

## Webhook Security

### Signature Verification

All webhooks include a signature header for verification:

```
X-AgenticPay-Signature: t=1234567890,v1=abc123def456...
```

Verification algorithm:
```typescript
const payload = `${timestamp}.${JSON.stringify(body)}`;
const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(payload)
  .digest('hex');
```

### Replay Protection

- Timestamps older than 5 minutes are rejected
- Duplicate event IDs within 24 hours are rejected

## Monitoring and Debugging

### Webhook Logs

Each webhook attempt is logged with:
- Event ID
- Attempt number
- HTTP status code
- Response time
- Error details (if failed)

### Dashboard Metrics

Available in merchant dashboard:
- Delivery success rate (last 24h, 7d, 30d)
- Average delivery time
- Failed webhooks requiring attention
- Circuit breaker status per endpoint

### Testing Webhooks

Use the webhook testing endpoint:

```bash
POST /api/v1/webhooks/test
{
  "url": "https://your-endpoint.com/webhooks",
  "eventType": "payment.completed"
}
```

## Best Practices for Consumers

### 1. Idempotency

Always handle webhooks idempotently:

```typescript
app.post('/webhooks', async (req, res) => {
  const eventId = req.body.id;
  
  // Check if already processed
  if (await isEventProcessed(eventId)) {
    return res.status(200).send('Already processed');
  }
  
  // Process event
  await processEvent(req.body);
  
  // Mark as processed
  await markEventProcessed(eventId);
  
  res.status(200).send('OK');
});
```

### 2. Quick Response

Respond quickly (< 5 seconds) to avoid timeouts:

```typescript
app.post('/webhooks', async (req, res) => {
  // Acknowledge receipt immediately
  res.status(200).send('OK');
  
  // Process asynchronously
  processEventAsync(req.body).catch(handleError);
});
```

### 3. Verify Signatures

Always verify webhook signatures:

```typescript
import { verifyWebhookSignature } from '@agenticpay/sdk';

app.post('/webhooks', (req, res) => {
  const signature = req.headers['x-agenticpay-signature'];
  
  if (!verifyWebhookSignature(req.body, signature, webhookSecret)) {
    return res.status(401).send('Invalid signature');
  }
  
  // Process webhook...
});
```

### 4. Error Handling

Return appropriate status codes:

```typescript
app.post('/webhooks', async (req, res) => {
  try {
    await processEvent(req.body);
    res.status(200).send('OK');
  } catch (error) {
    if (error.isRetryable) {
      // Temporary error - AgenticPay should retry
      res.status(500).send('Temporary error');
    } else {
      // Permanent error - don't retry
      res.status(400).send('Invalid event');
    }
  }
});
```

## Troubleshooting

### Webhooks Not Received

1. Check endpoint is publicly accessible
2. Verify SSL certificate is valid
3. Check firewall rules allow AgenticPay IPs
4. Review webhook logs in dashboard

### High Failure Rate

1. Check endpoint response time (should be < 5s)
2. Verify signature verification is correct
3. Review error logs for specific failure reasons
4. Check if circuit breaker is open

### Duplicate Events

1. Implement idempotency checks using event ID
2. Store processed event IDs for 24 hours minimum
3. Return 200 OK for already-processed events

## Configuration

Webhook settings can be configured per merchant:

```typescript
await sdk.webhooks.updateConfig({
  maxRetries: 3,              // Reduce retry attempts
  timeoutMs: 5000,            // Shorter timeout
  enableCircuitBreaker: true,  // Enable protection
});
```

## Changelog

- **2024-10-17**: Initial webhook retry strategy documentation (Issue #1158)

## Related Documentation

- [Webhook Verification](./WEBHOOK_VERIFICATION.md)
- [API Documentation](./api.md)
- [Troubleshooting Guide](./troubleshooting.md)
