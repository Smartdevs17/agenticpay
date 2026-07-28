import { describe, it, expect } from 'vitest';
import { withTenantContext, getActiveTenantId, CrossTenantAccessError, withTenantIsolationGuard } from '../guard.js';

/**
 * Minimal fake of the subset of the Prisma client surface that
 * `$extends({ query: { $allModels: { $allOperations } } })` relies on, so we
 * can exercise the guard's interception logic without a real database.
 */
function createFakeClient(records: Record<string, unknown>[]) {
  const calls: { model: string; operation: string; args: unknown }[] = [];

  const fakeClient = {
    $extends(config: {
      query: { $allModels: { $allOperations: (ctx: { model: string; operation: string; args: unknown; query: (args: unknown) => Promise<unknown> }) => Promise<unknown> } };
    }) {
      const allOperations = config.query.$allModels.$allOperations;
      return {
        sandboxAccount: {
          findUnique: (args: unknown) =>
            allOperations({
              model: 'SandboxAccount',
              operation: 'findUnique',
              args,
              query: async (a: any) => {
                calls.push({ model: 'sandboxAccount', operation: 'findUnique', args: a });
                return records.find((r) => r.id === a?.where?.id) ?? null;
              },
            }),
          findMany: (args: unknown) =>
            allOperations({
              model: 'SandboxAccount',
              operation: 'findMany',
              args,
              query: async (a: any) => {
                calls.push({ model: 'sandboxAccount', operation: 'findMany', args: a });
                return records.filter((r) => !a?.where?.tenantId || r.tenantId === a.where.tenantId);
              },
            }),
        },
      };
    },
  };

  return { fakeClient, calls };
}

describe('cross-tenant runtime guard', () => {
  const tenantARecord = { id: 'acct-a', tenantId: 'tenant-a' };
  const tenantBRecord = { id: 'acct-b', tenantId: 'tenant-b' };

  it('allows a query scoped to the active tenant', async () => {
    const { fakeClient } = createFakeClient([tenantARecord, tenantBRecord]);
    const guarded = withTenantIsolationGuard(fakeClient as any);

    const result = await withTenantContext('tenant-a', () =>
      guarded.sandboxAccount.findMany({ where: { tenantId: 'tenant-a' } })
    );

    expect(result).toEqual([tenantARecord]);
  });

  it('blocks a query that explicitly targets a different tenant', async () => {
    const { fakeClient } = createFakeClient([tenantARecord, tenantBRecord]);
    const guarded = withTenantIsolationGuard(fakeClient as any);

    await expect(
      withTenantContext('tenant-a', () => guarded.sandboxAccount.findMany({ where: { tenantId: 'tenant-b' } }))
    ).rejects.toThrow(CrossTenantAccessError);
  });

  it('blocks an unscoped findMany while a tenant context is active', async () => {
    const { fakeClient } = createFakeClient([tenantARecord, tenantBRecord]);
    const guarded = withTenantIsolationGuard(fakeClient as any);

    await expect(withTenantContext('tenant-a', () => guarded.sandboxAccount.findMany({}))).rejects.toThrow(
      CrossTenantAccessError
    );
  });

  it('does not block queries when no tenant context is active (e.g. system jobs)', async () => {
    const { fakeClient } = createFakeClient([tenantARecord, tenantBRecord]);
    const guarded = withTenantIsolationGuard(fakeClient as any);

    const result = await guarded.sandboxAccount.findMany({});
    expect(result).toHaveLength(2);
  });

  it('isolates tenant context across concurrent async calls', async () => {
    const results = await Promise.all([
      withTenantContext('tenant-a', async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getActiveTenantId();
      }),
      withTenantContext('tenant-b', async () => {
        return getActiveTenantId();
      }),
    ]);

    expect(results).toEqual(['tenant-a', 'tenant-b']);
  });
});
