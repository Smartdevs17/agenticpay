/**
 * Runtime cross-tenant isolation guard — Issue #522
 *
 * Wraps the shared Prisma client with an extension that:
 *   1. Reads the "current tenant" from request-scoped AsyncLocalStorage.
 *   2. For every read/write on a directly tenant-scoped model, requires the
 *      query's `where` clause to pin `tenantId` to the current tenant. If a
 *      query targets a different tenant (or omits tenantId while a tenant
 *      context is active), it throws instead of silently returning data.
 *
 * This is defense-in-depth: it does not replace correct service-layer
 * checks, but it turns a missed tenant filter into a hard failure instead
 * of a silent cross-tenant leak.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { PrismaClient } from '@prisma/client';
import { isDirectlyTenantScopedModel } from './models.js';

export class CrossTenantAccessError extends Error {
  constructor(model: string, attemptedTenantId: string | undefined, activeTenantId: string) {
    super(
      `Cross-tenant access blocked: query on '${model}' targeted tenant ` +
        `'${attemptedTenantId ?? '(none)'}' while active tenant context is '${activeTenantId}'.`
    );
    this.name = 'CrossTenantAccessError';
  }
}

interface TenantContext {
  tenantId: string;
}

const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

/** Run `fn` with `tenantId` bound as the active tenant for the duration of the call. */
export function withTenantContext<T>(tenantId: string, fn: () => T): T {
  return tenantContextStorage.run({ tenantId }, fn);
}

export function getActiveTenantId(): string | undefined {
  return tenantContextStorage.getStore()?.tenantId;
}

/** Express middleware: binds req.tenantId (set by auth) as the AsyncLocalStorage tenant for the request lifecycle. */
export function tenantContextMiddleware(
  req: { tenantId?: string },
  _res: unknown,
  next: () => void
): void {
  if (req.tenantId) {
    tenantContextStorage.run({ tenantId: req.tenantId }, next);
  } else {
    next();
  }
}

function extractTenantIdFromWhere(where: unknown): string | undefined {
  if (!where || typeof where !== 'object') return undefined;
  const w = where as Record<string, unknown>;
  if (typeof w.tenantId === 'string') return w.tenantId;
  // Compound unique inputs like { tenantId_email: { tenantId, email } }
  for (const value of Object.values(w)) {
    if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).tenantId === 'string') {
      return (value as Record<string, unknown>).tenantId as string;
    }
  }
  return undefined;
}

const GUARDED_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
]);

/**
 * Apply the tenant-isolation extension to a Prisma client. Call once on the
 * shared singleton (see lib/prisma.ts).
 */
export function withTenantIsolationGuard<T extends PrismaClient>(client: T) {
  return client.$extends({
    name: 'tenant-isolation-guard',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const activeTenantId = getActiveTenantId();

          if (
            activeTenantId &&
            model &&
            isDirectlyTenantScopedModel(model.charAt(0).toLowerCase() + model.slice(1)) &&
            GUARDED_OPERATIONS.has(operation)
          ) {
            const queryArgs = args as { where?: unknown };
            const attemptedTenantId = extractTenantIdFromWhere(queryArgs.where);

            if (attemptedTenantId && attemptedTenantId !== activeTenantId) {
              throw new CrossTenantAccessError(model, attemptedTenantId, activeTenantId);
            }

            if (!attemptedTenantId && (operation === 'findMany' || operation === 'updateMany' || operation === 'deleteMany' || operation === 'count' || operation === 'aggregate')) {
              throw new CrossTenantAccessError(model, undefined, activeTenantId);
            }
          }

          return query(args);
        },
      },
    },
  });
}
