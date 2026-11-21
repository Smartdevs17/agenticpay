# Horizontal Scaling for Payment Workers (Issue #945)

A distributed, horizontally scalable payment worker pool backed by BullMQ +
Redis. Multiple worker instances connect to the same Redis queue and compete
for payment jobs, giving automatic load distribution across processes and hosts
with at-least-once delivery, exponential back-off retries, and dead-lettering.

## Problem

Payment processing was handled synchronously in the request path
(`ProviderPaymentRouter.route()`), which blocks the caller and limits
throughput to a single instance. Under load, slow downstream providers (Stripe,
Stellar Horizon, EVM RPCs) exhaust the event loop and there is no way to
scale payment processing independently of the API.

## Solution

`PaymentWorkerPool` (`src/services/payments/payment-worker-pool.ts`) enqueues
payments as BullMQ jobs and a pool of workers processes them concurrently:

```
client ──► enqueue() ──► BullMQ queue (Redis) ◀──► Worker instance A
                                          ▲           │
                                          └──► Worker instance B ◀──┘
                                          (competes for same jobs)
```

Each worker pulls jobs from the shared queue, so adding worker instances
automatically increases throughput without rebalancing. Jobs survive process
restarts and are retried with exponential back-off before being dead-lettered.

## Architecture

| Component | Responsibility |
|-----------|----------------|
| `PaymentWorkerPool` | Creates/manages BullMQ queue + workers, enqueues payments |
| `Queue` (BullMQ) | Persisted job store; shared across all instances |
| `Worker` (BullMQ) | Pulls jobs, processes via `providerRegistry`, reports completion/failure |
| `providerRegistry` | Routes payments to soroban/evm/fiat/credit providers |
| In-process fallback | When Redis is unavailable, jobs run locally on a 1s interval |

## Usage

### Enqueue a payment (fire-and-forget)

```ts
import { getPaymentWorkerPool } from '../services/payments/payment-worker-pool.js';

const pool = getPaymentWorkerPool();
await pool.start();

const paymentId = await pool.enqueue({
  amount: 100,
  currency: 'USDC',
  toAddress: 'GABC...',
  network: 'stellar',
  tenantId: 'tenant-1',
}, 'soroban'); // optional preferred provider
```

### Get metrics (for autoscaling / observability)

```ts
const metrics = await pool.getMetrics();
// { queued, active, completed, failed, delayed, concurrency, workerCount }
```

Use `queued` and `active` to drive horizontal autoscaling: add worker
instances when queue depth grows, remove when idle.

### Graceful shutdown

```ts
await pool.shutdown(); // closes workers and queue connection
```

## Configuration

| Option | Env | Default | Meaning |
|--------|-----|---------|---------|
| `redisUrl` | `REDIS_URL` | undefined | Redis connection string |
| `concurrency` | — | 4 | Parallel workers per instance |
| `maxAttempts` | — | 5 | Max attempts per payment job |
| `initialDelayMs` | — | 1000 | First retry delay (ms) |
| `maxDelayMs` | — | 30000 | Max retry delay (ms) |
| `queueName` | — | `agenticpay:payments` | BullMQ queue name |
| `prefix` | — | `agenticpay` | BullMQ key prefix |

Redis is required for true horizontal scaling. When `REDIS_ENABLED=true` and
`REDIS_URL` are set, all instances share the same queue. Without Redis the pool
falls back to an in-process queue (single instance only).

## Testing

```bash
# Backend tests
cd backend
npx vitest run src/services/payments/__tests__/payment-worker-pool.test.ts
```

## Horizontal scaling guide

1. Deploy `N` worker instances (containers/pods) all running the same code.
2. Set `REDIS_ENABLED=true` and `REDIS_URL` to a shared Redis.
3. Each instance calls `pool.start()` — BullMQ workers automatically compete
   for jobs from the shared queue.
4. Monitor `pool.getMetrics().queued` — scale `N` up/down based on depth.
5. On deploy, call `pool.shutdown()` to drain in-flight jobs before exit.

## Security

- Payment payloads are job data in Redis — ensure Redis is network-isolated
  and requires authentication (`REDIS_URL` with password).
- No secrets are stored in job metadata.
- Each provider is an isolated circuit; a failing provider does not block
  others (see circuit breaker integration, issue #948).
