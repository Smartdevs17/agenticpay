import { describe, it, expect, beforeEach } from 'vitest';
import { rbacSandbox } from '../rbacSandbox.js';
import {
  createWorkspace,
  addMember,
  getRolePermissions,
} from '../workspaces.js';

describe('RbacSandboxService (#1350)', () => {
  let workspaceId: string;
  let ownerId: string;

  beforeEach(() => {
    ownerId = `owner_${Math.random().toString(36).slice(2, 8)}`;
    const ws = createWorkspace({ name: 'Sandbox WS', ownerId });
    workspaceId = ws.id;
    addMember(workspaceId, 'member-1', 'member');
  });

  it('previews role change grants and revokes without mutating membership', () => {
    const preview = rbacSandbox.previewRoleChange(workspaceId, 'member-1', 'admin');

    expect(preview.currentRole).toBe('member');
    expect(preview.proposedRole).toBe('admin');
    expect(preview.diff.granted).toContain('workspace:manage_members');
    expect(preview.diff.granted.length).toBeGreaterThan(0);
    expect(preview.wouldAllow['workspace:manage_members']).toBe(true);

    // Membership unchanged
    const again = rbacSandbox.previewRoleChange(workspaceId, 'member-1', 'viewer');
    expect(again.currentRole).toBe('member');
  });

  it('previews a custom policy layered on a base role', () => {
    const preview = rbacSandbox.previewCustomPolicy(
      'viewer',
      ['payment:refund'],
      ['audit:read']
    );

    expect(preview.effectivePermissions).toContain('payment:refund');
    expect(preview.effectivePermissions).not.toContain('audit:read');
    expect(preview.diff.granted).toEqual(['payment:refund']);
    expect(preview.diff.revoked).toEqual(['audit:read']);
  });

  it('simulates a single action under a proposed role', () => {
    const sim = rbacSandbox.simulateAction(
      workspaceId,
      'member-1',
      'workspace:delete',
      'owner'
    );

    expect(sim.currentlyAllowed).toBe(false);
    expect(sim.wouldBeAllowed).toBe(true);
    expect(sim.changed).toBe(true);
  });

  it('diffs two roles and estimates migration blast radius', () => {
    const diff = rbacSandbox.diffRoles('viewer', 'member');
    expect(diff.granted.length + diff.revoked.length).toBeGreaterThan(0);

    const migration = rbacSandbox.previewRoleMigration(
      [
        { userId: 'a', role: 'viewer' },
        { userId: 'b', role: 'member' },
        { userId: 'c', role: 'viewer' },
      ],
      'viewer',
      'member'
    );

    expect(migration.affected).toHaveLength(2);
    expect(migration.summary.granted).toEqual(diff.granted);
  });

  it('uses the same permission set as getRolePermissions', () => {
    const preview = rbacSandbox.previewRoleChange(workspaceId, 'ghost', 'admin');
    expect(preview.currentRole).toBeNull();
    expect(preview.proposedPermissions).toEqual(getRolePermissions('admin'));
  });
});
