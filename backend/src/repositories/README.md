# Repository Layer Architecture

Implemented under Issue #1404: Encapsulation of Prisma database queries into a typed repository layer.

## Purpose

The repository layer isolates data access logic from service orchestration and HTTP handling. By replacing raw `prisma.<entity>.<query>()` calls with intention-named repository methods:
- Queries are maintained in single, dedicated locations per entity.
- Services can be tested deterministically with mock or in-memory repositories without spinning up Postgres.
- Atomic database transactions are preserved via dependency injection and unit-of-work helpers.

## Structure

```
backend/src/repositories/
├── index.ts                      # Central exports & runInTransaction helper
├── BaseRepository.ts             # Abstract base interface
├── InMemoryRepository.ts         # In-memory implementation for test fakes
├── PaymentRepository.ts          # Payment entity queries
├── UserRepository.ts             # User entity queries
├── InvoiceRepository.ts          # Invoice entity queries
├── WebhookRepository.ts          # Webhook entity queries
├── NotificationRepository.ts     # PushSubscription, PushPreference, NotificationLog queries
├── AuditLogRepository.ts         # AuditLog entity queries
├── GasEstimateRepository.ts      # GasEstimate entity queries
├── EmailRepository.ts            # Email template and delivery queries
├── ReportRepository.ts           # Financial report job and archive queries
├── InstallmentRepository.ts      # InstallmentPlan and Installment queries
├── SandboxRepository.ts          # SandboxAccount and SandboxTransaction queries
├── DisputeEvidenceRepository.ts  # DisputeEvidence queries with O(1) batched fanout (Issue #1460)
└── __tests__/                    # Verbatim query argument tests with mock client
```

## Atomic Transactions

Where services need to execute multiple operations across multiple tables atomically, `runInTransaction` injects repository instances bound to the same Prisma transaction client:

```typescript
import { runInTransaction } from '../repositories/index.js';

await runInTransaction(async (repos) => {
  const payment = await repos.payment.create({ ... });
  await repos.invoice.updateStatus(invoiceId, 'paid');
  await repos.auditLog.create({ action: 'PAYMENT_COMPLETED', entityId: payment.id });
});
```

Alternatively, individual repositories support `.withTransaction(tx)`:

```typescript
const txPaymentRepo = paymentRepo.withTransaction(tx);
await txPaymentRepo.updateStatus(id, 'completed');
```

## How to Add a Repository

1. Create `backend/src/repositories/<Entity>Repository.ts`.
2. Accept `db: PrismaClient | Prisma.TransactionClient = prisma` in the constructor.
3. Expose `.withTransaction(tx: DbClient): <Entity>Repository`.
4. Move queries verbatim with matching `where`, `select`, `include`, and `orderBy` clauses.
5. Export class and singleton from `backend/src/repositories/index.ts`.
6. Add unit tests in `backend/src/repositories/__tests__/` asserting exact query arguments.
