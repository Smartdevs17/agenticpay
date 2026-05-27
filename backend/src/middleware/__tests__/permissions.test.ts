import { describe, expect, it } from 'vitest';
import { PermissionEngine, roleAtLeast, type Role, type Action } from '../permissions.js';

describe('roleAtLeast', () => {
  it('super_admin is at least admin', () => expect(roleAtLeast('super_admin', 'admin')).toBe(true));
  it('viewer is not at least operator', () => expect(roleAtLeast('viewer', 'operator')).toBe(false));
  it('operator is at least viewer', () => expect(roleAtLeast('operator', 'viewer')).toBe(true));
  it('same role satisfies itself', () => expect(roleAtLeast('admin', 'admin')).toBe(true));
});

describe('PermissionEngine.can', () => {
  const engine = new PermissionEngine([]);

  const cases: [Role, string, Action, boolean][] = [
    ['viewer',      'payments', 'read',   true],
    ['viewer',      'payments', 'write',  false],
    ['operator',    'payments', 'write',  true],
    ['operator',    'payments', 'delete', false],
    ['admin',       'payments', 'delete', true],
    ['admin',       'settings', 'read',   true],
    ['admin',       'settings', 'write',  false],
    ['super_admin', 'settings', 'write',  true],
    ['guest',       'payments', 'read',   false],
  ];

  for (const [role, resource, action, expected] of cases) {
    it(`${role} can${expected ? '' : 'not'} ${action} ${resource}`, () => {
      expect(engine.can(role, resource, action)).toBe(expected);
    });
  }
});

describe('PermissionEngine.evaluate — ABAC', () => {
  it('denies tenant-isolated resource when tenant IDs differ', () => {
    const engine = new PermissionEngine(); // uses default policies
    const result = engine.evaluate(
      {
        userId: 'u1',
        tenantId: 'tenant-A',
        role: 'admin',
        resourceTenantId: 'tenant-B', // different!
      },
      'users',
      'read'
    );
    expect(result).toBe('deny');
  });

  it('allows when tenant IDs match', () => {
    const engine = new PermissionEngine();
    const result = engine.evaluate(
      { userId: 'u1', tenantId: 'tenant-A', role: 'admin', resourceTenantId: 'tenant-A' },
      'users',
      'read'
    );
    expect(result).toBe('allow');
  });

  it('super_admin bypasses tenant isolation', () => {
    const engine = new PermissionEngine();
    const result = engine.evaluate(
      { userId: 'u1', tenantId: 'tenant-A', role: 'super_admin', resourceTenantId: 'tenant-B' },
      'users',
      'admin'
    );
    expect(result).toBe('allow');
  });

  it('denies when RBAC fails regardless of ABAC', () => {
    const engine = new PermissionEngine([]);
    const result = engine.evaluate(
      { userId: 'u1', tenantId: 'x', role: 'viewer' },
      'payments',
      'delete'
    );
    expect(result).toBe('deny');
  });

  it('supports custom policy addition', () => {
    const engine = new PermissionEngine([]);
    engine.addPolicy({
      name: 'always-deny-from-test',
      evaluate: () => 'deny',
    });
    const result = engine.evaluate(
      { userId: 'u1', tenantId: 'x', role: 'super_admin' },
      'payments',
      'admin'
    );
    expect(result).toBe('deny');
  });
});
