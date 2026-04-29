// Prisma client singleton — Issue #207
// Single shared instance with query logging and slow-query detection.

import { PrismaClient } from '@prisma/client';
import { SLOW_QUERY_THRESHOLD_MS, VERY_SLOW_QUERY_THRESHOLD_MS } from '../config/database.js';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'stdout', level: 'warn' },
      { emit: 'stdout', level: 'error' },
    ],
  });

// Attach slow-query detection to Prisma query events
(prisma.$on as Function)('query', (e: { query: string; duration: number }) => {
  if (e.duration >= VERY_SLOW_QUERY_THRESHOLD_MS) {
    console.warn(`[db] 🔴 CRITICAL query ${e.duration}ms: ${e.query.slice(0, 120)}…`);
  } else if (e.duration >= SLOW_QUERY_THRESHOLD_MS) {
    console.warn(`[db] 🟡 SLOW query ${e.duration}ms: ${e.query.slice(0, 120)}…`);
  }
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Graceful disconnect helper — call in server shutdown handler
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

export { PrismaClient };
