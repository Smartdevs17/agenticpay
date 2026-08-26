// Prisma extension for transparent column-level encryption — Issue #511
//
// Consistent with the codebase's use of Prisma $extends (see withTenantIsolationGuard).
// Apply by wrapping the Prisma client:
//
//   export const prisma = withEncryptionMiddleware(withTenantIsolationGuard(basePrisma));
//
// PII field registry determines which fields are encrypted per model.

import type { PrismaClient } from '@prisma/client';
import { encrypt, encryptDeterministic, decrypt, isEncrypted } from './column-encryptor.js';

export { encrypt, encryptDeterministic, decrypt, isEncrypted, evictTenantKeyCache, reEncrypt } from './column-encryptor.js';

// ---------------------------------------------------------------------------
// PII field registry
// ---------------------------------------------------------------------------

type FieldConfig = { deterministic?: boolean };

const PII_FIELDS: Record<string, Record<string, FieldConfig>> = {
  User: {
    email: { deterministic: true }, // searchable by email
    walletAddress: {},
  },
  Payment: {
    fromAddress: {},
    toAddress: {},
  },
  SandboxAccount: {
    email: { deterministic: true },
    walletAddress: {},
  },
  AuditLog: {
    ipAddress: {},
  },
};

// ---------------------------------------------------------------------------
// Transform helpers
// ---------------------------------------------------------------------------

function getTenantId(data: Record<string, unknown>): string {
  return (data.tenantId as string) ?? (data.tenant_id as string) ?? 'default';
}

function encryptRecord(model: string, data: Record<string, unknown>): Record<string, unknown> {
  const fields = PII_FIELDS[model];
  if (!fields) return data;
  const tenantId = getTenantId(data);
  const result = { ...data };
  for (const [field, cfg] of Object.entries(fields)) {
    const val = result[field];
    if (typeof val !== 'string' || isEncrypted(val)) continue;
    result[field] = cfg.deterministic
      ? encryptDeterministic(val, tenantId, field)
      : encrypt(val, tenantId);
  }
  return result;
}

function decryptRecord(model: string, data: Record<string, unknown>): Record<string, unknown> {
  const fields = PII_FIELDS[model];
  if (!fields) return data;
  const tenantId = getTenantId(data);
  const result = { ...data };
  for (const field of Object.keys(fields)) {
    const val = result[field];
    if (typeof val === 'string' && isEncrypted(val)) {
      result[field] = decrypt(val, tenantId, field, { resource: model });
    }
  }
  return result;
}

function decryptResult(model: string, result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  if (Array.isArray(result)) return result.map(r => decryptResult(model, r));
  return decryptRecord(model, result as Record<string, unknown>);
}

function encryptWhereConditions(model: string, where: Record<string, unknown>): Record<string, unknown> {
  const fields = PII_FIELDS[model];
  if (!fields) return where;
  const tenantId = (where.tenantId as string) ?? 'default';
  const result = { ...where };
  for (const [field, cfg] of Object.entries(fields)) {
    const val = result[field];
    if (typeof val === 'string' && cfg.deterministic && !isEncrypted(val)) {
      result[field] = encryptDeterministic(val, tenantId, field);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Prisma extension
// ---------------------------------------------------------------------------

const WRITE_OPS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert']);
const READ_OPS = new Set([
  'findUnique', 'findUniqueOrThrow',
  'findFirst', 'findFirstOrThrow',
  'findMany',
  'create', 'update', 'upsert',
]);

export function withEncryptionMiddleware<T extends PrismaClient>(client: T) {
  return client.$extends({
    name: 'column-encryption',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: {
          model: string;
          operation: string;
          args: any;
          query: (args: any) => Promise<any>;
        }) {
          // Encrypt on write
          if (WRITE_OPS.has(operation)) {
            if (args.data) {
              if (Array.isArray(args.data)) {
                args = { ...args, data: args.data.map((d: any) => encryptRecord(model, d)) };
              } else {
                args = { ...args, data: encryptRecord(model, args.data) };
              }
            }
          }

          // Encrypt deterministic WHERE conditions (for searchable fields)
          if (args.where) {
            args = { ...args, where: encryptWhereConditions(model, args.where) };
          }

          const result = await query(args);

          // Decrypt on read
          if (READ_OPS.has(operation)) {
            return decryptResult(model, result);
          }

          return result;
        },
      },
    },
  });
}
