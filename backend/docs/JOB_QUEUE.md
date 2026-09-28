# Background Job Queue (Issue #952)

A reliable background job queue with automatic retries, exponential back-off,
configurable limits and dead-letter handling.

## Concepts

| Concept | Description |
|---------|-------------|
| **Job** | A named unit of work plus a payload, tracked by a `JobRecord`. |
| **Handler** | The async function that performs a job's work. Rejecting signals failure. |
| **Attempt** | One execution of a handler. `attempts` is the number started so far. |
| **Retry policy** | `maxAttempts`, `initialDelayMs`, `maxDelayMs`, `multiplier`, `jitter`. |
| **DLQ** | Dead-letter queue — terminal failures kept for inspection and replay. |

Job states: `pending → processing → completed`, or on failure `pending`
(retry scheduled) and finally `dead` when attempts are exhausted.

## Reliability guarantees

- **At-least-once** — a job is marked `completed` only after its handler resolves.
- **Bounded retries** — a failure is rescheduled with exponential back-off until
  `maxAttempts` (counts the first attempt) is exhausted.
- **No silent loss** — every terminal failure is written to the DLQ with the
  last error message, surfaced through `metrics()` and lifecycle events.
- **Deterministic scheduling** — the queue is driven by the caller (`drain()`),
  so retry timing is testable and no hidden timers run in unit tests.

## Usage

```ts
import { jobQueue } from './services/job-queue/index.js';

// 1. Register a handler once at startup.
jobQueue.registerHandler('send-receipt', async (payload: { paymentId: string }) => {
  await receipts.send(payload.paymentId);
});

// 2. Enqueue work.
jobQueue.enqueue('send-receipt', { paymentId: 'pay_123' });

// 3. Drive the queue — from a worker loop, a request, or a scheduler.
const summary = await jobQueue.drain();
// { processed: 1, completed: 0, retried: 1, deadLettered: 0 }

// Or start an interval-based polling loop (unref'd, safe in tests).
jobQueue.start(1_000);
```

### Custom retry policy

```ts
import { JobQueue } from './services/job-queue/index.js';

const queue = new JobQueue({
  retry: { maxAttempts: 5, initialDelayMs: 500, maxDelayMs: 30_000, multiplier: 2, jitter: true },
});
```

Back-off delay for a failed attempt is
`min(initialDelayMs * multiplier ** (attempt - 1), maxDelayMs)`, optionally
multiplied by a full-jitter random factor in `[0, 1)`.

### Dead-letter handling

```ts
const dlq = jobQueue.getDeadLetters();          // [{ job, failedAt, reason }]
jobQueue.requeueDeadLetter(dlq[0].job.id);      // reset attempts → pending
```

## Events

Pass an `onEvent` sink to observe lifecycle transitions:
`job.enqueued`, `job.started`, `job.completed`, `job.failed`, `job.retrying`,
`job.dead_lettered`.

## REST admin surface

Mounted at `/api/v1/job-queue`.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/enqueue` | Enqueue a registered job (`{ name, payload }`). |
| `GET` | `/metrics` | Queue depth counters. |
| `GET` | `/jobs?state=&name=` | List jobs, filterable by state/name. |
| `GET` | `/dead-letters` | Inspect the DLQ. |
| `POST` | `/dead-letters/:id/requeue` | Requeue a dead-lettered job. |

```bash
curl -X POST http://localhost:3000/api/v1/job-queue/enqueue \
  -H 'Content-Type: application/json' \
  -d '{ "name": "send-receipt", "payload": { "paymentId": "pay_123" } }'

curl http://localhost:3000/api/v1/job-queue/metrics
```

## Persistence

`JobQueue` holds jobs in memory; the retry/DLQ semantics are transport
agnostic. For production durability, back the same contract with Redis
(this repo already depends on BullMQ) or the `JobRecord` Prisma model, keeping
`drain()` as the worker entry point.
