// Prisma client singleton — Issue #207
// Single shared instance with query logging and slow-query detection.

import { PrismaClient } from '@prisma/client';
import { SLOW_QUERY_THRESHOLD_MS, VERY_SLOW_QUERY_THRESHOLD_MS } from '../config/database.js';
import { withTenantIsolationGuard } from '../security/tenant-isolation/guard.js';
import { withEncryptionMiddleware } from '../encryption/index.js';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const basePrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'stdout', level: 'warn' },
      { emit: 'stdout', level: 'error' },
    ],
  });

// Cross-tenant isolation enforcement (Issue #522) — throws instead of
// silently leaking data when a query targets a tenant other than the
// caller's active tenant context.
// Column-level AES-256-GCM encryption for PII fields (Issue #511).
export const prisma = withEncryptionMiddleware(withTenantIsolationGuard(basePrismaClient));

// Attach slow-query detection to Prisma query events (must be registered on
// the base client — extended clients don't re-expose $on).
(basePrismaClient.$on as Function)('query', (e: { query: string; duration: number }) => {
  if (e.duration >= VERY_SLOW_QUERY_THRESHOLD_MS) {
    console.warn(`[db] 🔴 CRITICAL query ${e.duration}ms: ${e.query.slice(0, 120)}…`);
  } else if (e.duration >= SLOW_QUERY_THRESHOLD_MS) {
    console.warn(`[db] 🟡 SLOW query ${e.duration}ms: ${e.query.slice(0, 120)}…`);
  }
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = basePrismaClient;
}

// Graceful disconnect helper — call in server shutdown handler
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

export { PrismaClient };
