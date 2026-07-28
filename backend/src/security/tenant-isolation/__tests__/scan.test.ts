import { describe, it, expect } from 'vitest';
import { scanFile } from '../scan.js';

describe('tenant isolation static scanner', () => {
  it('flags a findUnique by raw id on a directly tenant-scoped model', () => {
    const src = `
      async function getAccountById(id: string) {
        return await prisma.sandboxAccount.findUnique({ where: { id } });
      }
    `;
    const violations = scanFile('fake.ts', src);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ model: 'sandboxAccount', operation: 'findUnique', severity: 'high' });
  });

  it('does not flag a query whose where-clause includes tenantId', () => {
    const src = `
      async function getAccount(id: string, tenantId: string) {
        return await prisma.sandboxAccount.findUnique({ where: { tenantId_email: { tenantId, email: 'x' } } });
      }
    `;
    expect(scanFile('fake.ts', src)).toHaveLength(0);
  });

  it('does not flag a query that filters directly by tenantId', () => {
    const src = `
      async function listForTenant(tenantId: string) {
        return await prisma.payment.findMany({ where: { tenantId } });
      }
    `;
    expect(scanFile('fake.ts', src)).toHaveLength(0);
  });

  it('flags findMany on a tenant-scoped model with no where clause at all', () => {
    const src = `
      async function listAll() {
        return await prisma.invoice.findMany();
      }
    `;
    const violations = scanFile('fake.ts', src);
    expect(violations).toHaveLength(1);
    expect(violations[0].model).toBe('invoice');
  });

  it('marks transitively-scoped models as medium severity', () => {
    const src = `
      async function getMilestone(id: string) {
        return await prisma.milestone.findUnique({ where: { id } });
      }
    `;
    const violations = scanFile('fake.ts', src);
    expect(violations[0].severity).toBe('medium');
  });

  it('ignores calls on non-tenant-scoped models', () => {
    const src = `
      async function getGasEstimate(network: string) {
        return await prisma.gasEstimate.findUnique({ where: { network } });
      }
    `;
    expect(scanFile('fake.ts', src)).toHaveLength(0);
  });

  it('ignores property accesses that are not rooted at a prisma client', () => {
    const src = `
      async function getAccount(id: string) {
        return await someOtherClient.sandboxAccount.findUnique({ where: { id } });
      }
    `;
    expect(scanFile('fake.ts', src)).toHaveLength(0);
  });
});
