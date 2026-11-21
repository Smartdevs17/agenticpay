# Event Sourcing Architecture for Transactions (Issue #946)

A complete event sourcing implementation for payment transactions. State
changes are captured as immutable domain events in an append-only store.
Aggregates are rehydrated by replaying their event stream, and projections
build denormalized read models from the event log.

## Core concepts

| Concept | Description |
|---------|-------------|
| **Event** | An immutable fact: `TransactionCreated`, `PaymentAuthorized`, `PaymentCaptured`, `PaymentFailed`, `TransactionRefunded`, `TransactionCancelled`. |
| **Aggregate root** | Encapsulates state and invariants; mutated only by applying events (`TransactionAggregate`). |
| **Event store** | Append-only log of all events, keyed by aggregate id with optimistic concurrency (`EventStore`). |
| **Projection** | Denormalized read model built from events (`TransactionProjector`). |
| **Replay** | Reconstruct aggregate state or rebuild projections by replaying the event log. |

## File layout

```
backend/src/eventsourcing/
├── types.ts              # StoredEvent, AggregateSnapshot, CommandResult, etc.
├── event-store.ts        # Append-only event store (Prisma or in-memory)
├── aggregate.ts          # AggregateRoot base class
├── transaction-aggregate.ts  # Transaction aggregate with commands
├── projection.ts         # Projection base + ProjectionManager
└── transaction-projector.ts  # Transaction read-model projection
└── __tests__/
    └── event-sourcing.test.ts
```

## Usage

### Create a transaction (event-sourced)

```ts
import { TransactionAggregate } from '../eventsourcing/transaction-aggregate.js';

const txn = new TransactionAggregate('txn-123');
const result = await txn.createTransaction({
  amount: 100,
  currency: 'USDC',
  toAddress: 'GABC...',
  network: 'stellar',
  userId: 'user-abc',
});

if (result.ok) {
  console.log(result.value.status); // 'pending'
  console.log(txn.getVersion());    // 1
}
```

### Authorize and capture a payment

```ts
const auth = await txn.authorizePayment({
  providerId: 'stripe',
  txHash: 'hash_456',
  userId: 'user-abc',
});
if (auth.ok) console.log(auth.value.status); // 'authorized'

const cap = await txn.capturePayment('user-abc');
if (cap.ok) console.log(cap.value.status);   // 'captured'
```

### Refund

```ts
const refund = await txn.refund({ amount: 40, userId: 'user-abc' });
if (refund.ok) {
  console.log(refund.value.refundedAmount); // 40
  console.log(refund.value.status);         // 'partially_refunded'
}
```

### Rehydrate an aggregate from its event stream

```ts
const txn2 = new TransactionAggregate('txn-123');
await txn2.load(); // replays all events, rebuilds state
console.log(txn2.getState().status); // current state
```

### Project events into a read model

```ts
import { getTransactionProjector } from '../eventsourcing/transaction-projector.js';

const projector = getTransactionProjector();
await projector.project(event); // event from aggregate commit
const readModel = projector.getReadModel('txn-123');
```

### Replay all events into all projections

```ts
import { getProjectionManager } from '../eventsourcing/projection.js';

const manager = getProjectionManager();
manager.register(someProjection);
await manager.replay(); // rebuilds all read models from the event log
```

## Concurrency control

Writes use optimistic concurrency: `commit()` passes `expectedVersion` to the
event store. If another process has advanced the stream, the write is rejected
with `CONCURRENCY_CONFLICT` (HTTP 409). Retry by reloading the aggregate and
reissuing the command.

## Event store backends

- **Prisma-backed**: when a `transactionEvent` Prisma model exists, events are
  persisted durably to PostgreSQL.
- **In-memory fallback**: when no database table is available (tests, local
  dev without migrations), events are stored in memory. Suitable for
  development and unit testing.

## Testing

```bash
cd backend
npx vitest run src/eventsourcing/__tests__/event-sourcing.test.ts
```

## Example event flow

```
createTransaction()
  └─► TransactionCreated event → version 1

authorizePayment()
  └─► PaymentAuthorized event → version 2

capturePayment()
  └─► PaymentCaptured event → version 3

refund({ amount: 40 })
  └─► TransactionRefunded event → version 4

cancel()          // rejected: not in 'pending' state
  └─► INVALID_TRANSITION error
```
