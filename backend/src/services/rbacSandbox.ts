/**
 * RBAC policy sandbox — Issue #1350
 *
 * Previews workspace permission changes without mutating membership or roles.
 * Diffs current vs proposed role matrices so admins can simulate grants/revokes
 * before applying them.
 */

import { logger } from '../utils/logger.js';
import {
  getMemberRole,
  getRolePermissions,
  roleHasPermission,
  type ResourceAction,
  type WorkspaceRole,
} from './workspaces.js';

export type PermissionDiff = {
  granted: ResourceAction[];
  revoked: ResourceAction[];
  unchanged: ResourceAction[];
};

export type RolePreviewResult = {
  workspaceId: string;
  userId: string;
  currentRole: WorkspaceRole | null;
  proposedRole: WorkspaceRole;
  currentPermissions: ResourceAction[];
  proposedPermissions: ResourceAction[];
  diff: PermissionDiff;
  wouldAllow: Record<ResourceAction, boolean>;
};

export type CustomPolicyPreview = {
  baseRole: WorkspaceRole;
  additions: ResourceAction[];
  removals: ResourceAction[];
  effectivePermissions: ResourceAction[];
  diff: PermissionDiff;
};

export type ActionSimulation = {
  workspaceId: string;
  userId: string;
  action: ResourceAction;
  currentRole: WorkspaceRole | null;
  proposedRole?: WorkspaceRole;
  currentlyAllowed: boolean;
  wouldBeAllowed: boolean;
  changed: boolean;
};

export type MemberImpact = {
  userId: string;
  role: WorkspaceRole;
  diff: PermissionDiff;
};

function uniqueSorted(actions: ResourceAction[]): ResourceAction[] {
  return [...new Set(actions)].sort();
}

function diffPermissions(
  current: ResourceAction[],
  proposed: ResourceAction[]
): PermissionDiff {
  const currentSet = new Set(current);
  const proposedSet = new Set(proposed);

  const granted = uniqueSorted(proposed.filter((a) => !currentSet.has(a)));
  const revoked = uniqueSorted(current.filter((a) => !proposedSet.has(a)));
  const unchanged = uniqueSorted(current.filter((a) => proposedSet.has(a)));

  return { granted, revoked, unchanged };
}

function buildWouldAllow(permissions: ResourceAction[]): Record<ResourceAction, boolean> {
  const allActions = getRolePermissions('owner');
  const allowed = new Set(permissions);
  const result = {} as Record<ResourceAction, boolean>;
  for (const action of allActions) {
    result[action] = allowed.has(action);
  }
  return result;
}

export class RbacSandboxService {
  /**
   * Preview switching a member to a different role without writing membership.
   */
  previewRoleChange(
    workspaceId: string,
    userId: string,
    proposedRole: WorkspaceRole
  ): RolePreviewResult {
    const currentRole = getMemberRole(workspaceId, userId) ?? null;
    const currentPermissions = currentRole ? getRolePermissions(currentRole) : [];
    const proposedPermissions = getRolePermissions(proposedRole);
    const diff = diffPermissions(currentPermissions, proposedPermissions);

    logger.info('[rbac-sandbox] role change preview', {
      workspaceId,
      userId,
      currentRole,
      proposedRole,
      granted: diff.granted.length,
      revoked: diff.revoked.length,
    });

    return {
      workspaceId,
      userId,
      currentRole,
      proposedRole,
      currentPermissions,
      proposedPermissions,
      diff,
      wouldAllow: buildWouldAllow(proposedPermissions),
    };
  }

  /**
   * Preview a custom policy layered on a base role (additions / removals).
   * Does not persist; useful for drafting temporary elevated policies.
   */
  previewCustomPolicy(
    baseRole: WorkspaceRole,
    additions: ResourceAction[] = [],
    removals: ResourceAction[] = []
  ): CustomPolicyPreview {
    const base = getRolePermissions(baseRole);
    const removalSet = new Set(removals);
    const effectivePermissions = uniqueSorted([
      ...base.filter((a) => !removalSet.has(a)),
      ...additions,
    ]);
    const diff = diffPermissions(base, effectivePermissions);

    logger.info('[rbac-sandbox] custom policy preview', {
      baseRole,
      additions: additions.length,
      removals: removals.length,
      effective: effectivePermissions.length,
    });

    return {
      baseRole,
      additions: uniqueSorted(additions),
      removals: uniqueSorted(removals),
      effectivePermissions,
      diff,
    };
  }

  /**
   * Simulate whether a single action would be allowed under current or proposed role.
   */
  simulateAction(
    workspaceId: string,
    userId: string,
    action: ResourceAction,
    proposedRole?: WorkspaceRole
  ): ActionSimulation {
    const currentRole = getMemberRole(workspaceId, userId) ?? null;
    const currentlyAllowed = currentRole
      ? roleHasPermission(currentRole, action)
      : false;
    const effectiveRole = proposedRole ?? currentRole;
    const wouldBeAllowed = effectiveRole
      ? roleHasPermission(effectiveRole, action)
      : false;

    return {
      workspaceId,
      userId,
      action,
      currentRole,
      proposedRole,
      currentlyAllowed,
      wouldBeAllowed,
      changed: currentlyAllowed !== wouldBeAllowed,
    };
  }

  /**
   * Diff two role permission matrices (e.g. before/after a global role edit).
   */
  diffRoles(fromRole: WorkspaceRole, toRole: WorkspaceRole): PermissionDiff {
    return diffPermissions(getRolePermissions(fromRole), getRolePermissions(toRole));
  }

  /**
   * Estimate blast radius of changing every member currently on `fromRole` to `toRole`.
   */
  previewRoleMigration(
    members: Array<{ userId: string; role: WorkspaceRole }>,
    fromRole: WorkspaceRole,
    toRole: WorkspaceRole
  ): { affected: MemberImpact[]; summary: PermissionDiff } {
    const summary = this.diffRoles(fromRole, toRole);
    const affected = members
      .filter((m) => m.role === fromRole)
      .map((m) => ({
        userId: m.userId,
        role: m.role,
        diff: summary,
      }));

    logger.info('[rbac-sandbox] role migration preview', {
      fromRole,
      toRole,
      affectedCount: affected.length,
      granted: summary.granted.length,
      revoked: summary.revoked.length,
    });

    return { affected, summary };
  }
}

export const rbacSandbox = new RbacSandboxService();
