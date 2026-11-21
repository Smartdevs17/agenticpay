import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetForTests,
  createWorkspace,
  getWorkspace,
  getWorkspaceBySlug,
  updateWorkspace,
  deleteWorkspace,
  listWorkspaces,
  addMember,
  updateMemberRole,
  removeMember,
  getMembers,
  getMemberRole,
  createInvitation,
  acceptInvitation,
  declineInvitation,
  listInvitations,
  hasPermission,
  requirePermission,
  getRolePermissions,
} from '../workspaces.js';
import type { WorkspaceRole } from '../workspaces.js';

describe('Workspaces', () => {
  beforeEach(() => {
    resetForTests();
  });

  const ownerId = 'user-owner-1';
  const member1 = 'user-member-1';
  const member2 = 'user-member-2';

  // ── CRUD ─────────────────────────────────────────────────────────────────

  describe('createWorkspace', () => {
    it('creates workspace with owner as member', () => {
      const ws = createWorkspace({ name: 'Test Workspace', ownerId });
      expect(ws.name).toBe('Test Workspace');
      expect(ws.ownerId).toBe(ownerId);
      expect(ws.isActive).toBe(true);
      expect(ws.slug).toMatch(/^test-workspace-/);
      expect(ws.id).toBeDefined();

      const members = getMembers(ws.id);
      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe(ownerId);
      expect(members[0].role).toBe('owner');
    });
  });

  describe('getWorkspace / getWorkspaceBySlug', () => {
    it('retrieves workspace by id and slug', () => {
      const ws = createWorkspace({ name: 'Retrieve Test', ownerId });
      expect(getWorkspace(ws.id)?.name).toBe('Retrieve Test');
      expect(getWorkspaceBySlug(ws.slug)?.id).toBe(ws.id);
    });

    it('returns undefined for missing workspace', () => {
      expect(getWorkspace('nonexistent')).toBeUndefined();
      expect(getWorkspaceBySlug('nonexistent')).toBeUndefined();
    });
  });

  describe('updateWorkspace', () => {
    it('updates name and description', () => {
      const ws = createWorkspace({ name: 'Original', ownerId });
      const updated = updateWorkspace(ws.id, { name: 'Updated', description: 'New desc' });
      expect(updated?.name).toBe('Updated');
      expect(updated?.description).toBe('New desc');
      expect(updated?.slug).toBe(ws.slug);
    });

    it('returns undefined for nonexistent workspace', () => {
      expect(updateWorkspace('nonexistent', { name: 'X' })).toBeUndefined();
    });
  });

  describe('deleteWorkspace', () => {
    it('soft-deletes workspace', () => {
      const ws = createWorkspace({ name: 'To Delete', ownerId });
      expect(deleteWorkspace(ws.id)).toBe(true);
      expect(getWorkspace(ws.id)?.isActive).toBe(false);
    });

    it('returns false for nonexistent workspace', () => {
      expect(deleteWorkspace('nonexistent')).toBe(false);
    });
  });

  describe('listWorkspaces', () => {
    it('lists workspaces user belongs to', () => {
      const ws1 = createWorkspace({ name: 'WS1', ownerId });
      const ws2 = createWorkspace({ name: 'WS2', ownerId });
      addMember(ws2.id, member1);

      const ownerList = listWorkspaces(ownerId);
      expect(ownerList).toHaveLength(2);

      const memberList = listWorkspaces(member1);
      expect(memberList).toHaveLength(1);
      expect(memberList[0].id).toBe(ws2.id);
    });

    it('excludes inactive workspaces', () => {
      const ws = createWorkspace({ name: 'Inactive', ownerId });
      deleteWorkspace(ws.id);
      expect(listWorkspaces(ownerId)).toHaveLength(0);
    });
  });

  // ── Members ──────────────────────────────────────────────────────────────

  describe('Member Management', () => {
    it('adds member with default member role', () => {
      const ws = createWorkspace({ name: 'WS', ownerId });
      const membership = addMember(ws.id, member1);
      expect(membership).toBeDefined();
      expect(membership?.role).toBe('member');
    });

    it('does not duplicate members', () => {
      const ws = createWorkspace({ name: 'WS', ownerId });
      const first = addMember(ws.id, member1);
      const second = addMember(ws.id, member1);
      expect(second?.id).toBe(first?.id);
      expect(getMembers(ws.id)).toHaveLength(2); // owner + member1
    });

    it('updates member role', () => {
      const ws = createWorkspace({ name: 'WS', ownerId });
      addMember(ws.id, member1);
      const updated = updateMemberRole(ws.id, member1, 'admin');
      expect(updated?.role).toBe('admin');
    });

    it('removes member', () => {
      const ws = createWorkspace({ name: 'WS', ownerId });
      addMember(ws.id, member1);
      expect(removeMember(ws.id, member1)).toBe(true);
      expect(getMembers(ws.id)).toHaveLength(1);
    });

    it('gets member role', () => {
      const ws = createWorkspace({ name: 'WS', ownerId });
      addMember(ws.id, member1, 'viewer');
      expect(getMemberRole(ws.id, member1)).toBe('viewer');
      expect(getMemberRole(ws.id, member2)).toBeUndefined();
    });
  });

  // ── Invitations ──────────────────────────────────────────────────────────

  describe('Invitation System', () => {
    it('creates invitation with pending status', () => {
      const ws = createWorkspace({ name: 'WS', ownerId });
      const inv = createInvitation({ workspaceId: ws.id, email: 'new@test.com', role: 'member', invitedBy: ownerId });
      expect(inv.status).toBe('pending');
      expect(inv.email).toBe('new@test.com');
      expect(inv.token).toBeDefined();
    });

    it('rejects duplicate pending invitations', () => {
      const ws = createWorkspace({ name: 'WS', ownerId });
      createInvitation({ workspaceId: ws.id, email: 'dup@test.com', role: 'member', invitedBy: ownerId });
      expect(() =>
        createInvitation({ workspaceId: ws.id, email: 'dup@test.com', role: 'member', invitedBy: ownerId }),
      ).toThrow();
    });

    it('accepts invitation and adds member', () => {
      const ws = createWorkspace({ name: 'WS', ownerId });
      const inv = createInvitation({ workspaceId: ws.id, email: 'accept@test.com', role: 'admin', invitedBy: ownerId });
      const member = acceptInvitation(inv.token, 'user-new');
      expect(member).toBeDefined();
      expect(member?.role).toBe('admin');
      expect(getMemberRole(ws.id, 'user-new')).toBe('admin');
    });

    it('declines invitation', () => {
      const ws = createWorkspace({ name: 'WS', ownerId });
      const inv = createInvitation({ workspaceId: ws.id, email: 'decline@test.com', role: 'member', invitedBy: ownerId });
      const declined = declineInvitation(inv.token);
      expect(declined?.status).toBe('declined');
    });

    it('lists invitations for workspace', () => {
      const ws = createWorkspace({ name: 'WS', ownerId });
      createInvitation({ workspaceId: ws.id, email: 'a@test.com', role: 'member', invitedBy: ownerId });
      createInvitation({ workspaceId: ws.id, email: 'b@test.com', role: 'viewer', invitedBy: ownerId });
      expect(listInvitations(ws.id)).toHaveLength(2);
    });
  });

  // ── Permissions ──────────────────────────────────────────────────────────

  describe('Permissions', () => {
    it('owner has all permissions', () => {
      const ws = createWorkspace({ name: 'WS', ownerId });
      const perms = getRolePermissions('owner');
      expect(perms.length).toBeGreaterThan(10);
    });

    it('hasPermission returns true for matching role', () => {
      const ws = createWorkspace({ name: 'WS', ownerId });
      expect(hasPermission(ws.id, ownerId, 'workspace:delete')).toBe(true);
    });

    it('hasPermission returns false for non-member', () => {
      const ws = createWorkspace({ name: 'WS', ownerId });
      expect(hasPermission(ws.id, 'random-user', 'workspace:read')).toBe(false);
    });

    it('viewer cannot update workspace', () => {
      const ws = createWorkspace({ name: 'WS', ownerId });
      addMember(ws.id, member1, 'viewer');
      expect(hasPermission(ws.id, member1, 'workspace:update')).toBe(false);
    });

    it('requirePermission throws for insufficient role', () => {
      const ws = createWorkspace({ name: 'WS', ownerId });
      addMember(ws.id, member1, 'viewer');
      expect(() => requirePermission(ws.id, member1, 'workspace:delete')).toThrow();
    });

    it('requirePermission does not throw for sufficient role', () => {
      const ws = createWorkspace({ name: 'WS', ownerId });
      addMember(ws.id, member1, 'admin');
      expect(() => requirePermission(ws.id, member1, 'workspace:update')).not.toThrow();
    });
  });
});
