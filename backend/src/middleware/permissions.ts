/**
 * permissions.ts — Role-Based Access Control & Permissions Engine
 *
 * Provides role hierarchy, ABAC evaluation, custom roles, team management,
 * temporary permissions, API key permissions, and audit logging.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Role = 'super_admin' | 'admin' | 'operator' | 'viewer' | 'guest';

export interface Permission {
  resource: string;
  actions: string[];
}

export interface AbacContext {
  userId: string;
  tenantId: string;
  role: Role;
  requestTime?: string;
}

export interface CustomRole {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  tenantId: string;
  createdBy: string;
  inheritsFrom?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  userId: string;
  roleId: string;
  addedBy: string;
  addedAt: string;
}

export interface TemporaryPermission {
  id: string;
  userId: string;
  resource: string;
  actions: string[];
  expiresAt: string;
  grantedBy: string;
  reason: string;
  createdAt: string;
}

export interface ApiKey {
  keyId: string;
  name: string;
  permissions: Permission[];
  createdBy: string;
  expiresAt?: string;
  rateLimit: number;
  createdAt: string;
  revokedAt?: string;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  action: string;
  resource: string;
  details: Record<string, unknown>;
  timestamp: string;
}

// ─── Role Hierarchy ───────────────────────────────────────────────────────────

const ROLE_HIERARCHY: Record<Role, number> = {
  super_admin: 5,
  admin: 4,
  operator: 3,
  viewer: 2,
  guest: 1,
};

export function roleAtLeast(userRole: Role, requiredRole: Role): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 0);
}

// ─── Default Role Permissions ─────────────────────────────────────────────────

const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [
    { resource: '*', actions: ['*'] },
  ],
  admin: [
    { resource: 'payments', actions: ['read', 'write'] },
    { resource: 'projects', actions: ['read', 'write', 'admin'] },
    { resource: 'users', actions: ['read', 'write'] },
    { resource: 'invoices', actions: ['read', 'write'] },
    { resource: 'settings', actions: ['read'] },
  ],
  operator: [
    { resource: 'payments', actions: ['read', 'write'] },
    { resource: 'projects', actions: ['read', 'write'] },
    { resource: 'invoices', actions: ['read'] },
    { resource: 'users', actions: ['read'] },
  ],
  viewer: [
    { resource: 'payments', actions: ['read'] },
    { resource: 'projects', actions: ['read'] },
    { resource: 'invoices', actions: ['read'] },
  ],
  guest: [
    { resource: 'projects', actions: ['read'] },
  ],
};

// ─── In-Memory Stores ─────────────────────────────────────────────────────────

const customRoles = new Map<string, CustomRole>();
const teams = new Map<string, TeamMember[]>();
const temporaryPermissions = new Map<string, TemporaryPermission>();
const apiKeys = new Map<string, ApiKey>();
const auditLogs: AuditLogEntry[] = [];

// Unique ID helper
function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Permission Engine ────────────────────────────────────────────────────────

export class PermissionEngine {
  private customPermissions: Map<string, Permission[]>;

  constructor(extraPermissions?: Array<{ resource: string; actions: string[] }>) {
    this.customPermissions = new Map();
    if (extraPermissions) {
      for (const perm of extraPermissions) {
        if (!this.customPermissions.has(perm.resource)) {
          this.customPermissions.set(perm.resource, []);
        }
        this.customPermissions.get(perm.resource)!.push(perm);
      }
    }
  }

  can(role: Role, resource: string, action: string): boolean {
    if (role === 'super_admin') return true;

    const rolePerms = DEFAULT_ROLE_PERMISSIONS[role] ?? [];
    for (const perm of rolePerms) {
      if ((perm.resource === '*' || perm.resource === resource) &&
          (perm.actions.includes('*') || perm.actions.includes(action))) {
        return true;
      }
    }

    // Check custom permissions
    const custom = this.customPermissions.get(resource);
    if (custom) {
      for (const perm of custom) {
        if (perm.actions.includes(action) || perm.actions.includes('*')) {
          return true;
        }
      }
    }

    return false;
  }

  evaluate(ctx: AbacContext, resource: string, action: string): 'allow' | 'deny' {
    return this.can(ctx.role, resource, action) ? 'allow' : 'deny';
  }
}

// ─── Custom Roles ─────────────────────────────────────────────────────────────

export function createRole(
  name: string,
  description: string,
  permissions: Permission[],
  tenantId: string,
  createdBy: string,
  inheritsFrom?: string,
): CustomRole {
  const id = uid();
  const now = new Date().toISOString();
  const role: CustomRole = {
    id,
    name,
    description,
    permissions,
    tenantId,
    createdBy,
    inheritsFrom,
    createdAt: now,
    updatedAt: now,
  };
  customRoles.set(id, role);

  auditLogs.push({
    id: uid(),
    userId: createdBy,
    action: 'role_created',
    resource: id,
    details: { name, tenantId },
    timestamp: now,
  });

  return role;
}

export function getRole(roleId: string): CustomRole | undefined {
  return customRoles.get(roleId);
}

export function updateRole(
  roleId: string,
  updates: { description?: string; permissions?: Permission[]; inheritsFrom?: string },
  updatedBy: string,
): CustomRole {
  const role = customRoles.get(roleId);
  if (!role) throw new Error(`Role not found: ${roleId}`);

  // Check for circular inheritance
  if (updates.inheritsFrom) {
    let current = updates.inheritsFrom;
    while (current) {
      if (current === roleId) {
        throw new Error('Circular role inheritance detected');
      }
      const parent = customRoles.get(current);
      current = parent?.inheritsFrom ?? '';
    }
  }

  if (updates.description !== undefined) role.description = updates.description;
  if (updates.permissions !== undefined) role.permissions = updates.permissions;
  if (updates.inheritsFrom !== undefined) role.inheritsFrom = updates.inheritsFrom;
  role.updatedAt = new Date().toISOString();

  customRoles.set(roleId, role);
  return role;
}

export function deleteRole(roleId: string, deletedBy: string): boolean {
  return customRoles.delete(roleId);
}

export function listRoles(tenantId: string): CustomRole[] {
  return Array.from(customRoles.values()).filter((r) => r.tenantId === tenantId);
}

export function resolveRolePermissions(roleId: string): Permission[] {
  const role = customRoles.get(roleId);
  if (!role) return [];

  const perms = new Map<string, Set<string>>();
  const addPerms = (r: CustomRole) => {
    for (const p of r.permissions) {
      if (!perms.has(p.resource)) perms.set(p.resource, new Set());
      for (const a of p.actions) perms.get(p.resource)!.add(a);
    }
  };

  addPerms(role);

  // Walk up the inheritance chain
  let parentId = role.inheritsFrom;
  while (parentId) {
    const parent = customRoles.get(parentId);
    if (parent) {
      addPerms(parent);
      parentId = parent.inheritsFrom;
    } else {
      break;
    }
  }

  return Array.from(perms.entries()).map(([resource, actions]) => ({
    resource,
    actions: Array.from(actions),
  }));
}

// ─── Team Management ──────────────────────────────────────────────────────────

export function addTeamMember(
  teamId: string,
  userId: string,
  roleId: string,
  addedBy: string,
): void {
  if (!teams.has(teamId)) teams.set(teamId, []);

  const members = teams.get(teamId)!;
  if (members.some((m) => m.userId === userId)) {
    throw new Error('User already in team');
  }

  members.push({
    userId,
    roleId,
    addedBy,
    addedAt: new Date().toISOString(),
  });
}

export function removeTeamMember(teamId: string, userId: string, removedBy: string): boolean {
  const members = teams.get(teamId);
  if (!members) return false;

  const idx = members.findIndex((m) => m.userId === userId);
  if (idx === -1) return false;

  members.splice(idx, 1);
  return true;
}

export function updateTeamMemberRole(
  teamId: string,
  userId: string,
  newRoleId: string,
  updatedBy: string,
): boolean {
  const members = teams.get(teamId);
  if (!members) return false;

  const member = members.find((m) => m.userId === userId);
  if (!member) return false;

  member.roleId = newRoleId;
  return true;
}

export function getTeamMembers(teamId: string): TeamMember[] {
  return teams.get(teamId) ?? [];
}

// ─── Temporary Permissions ────────────────────────────────────────────────────

export function grantTemporaryPermission(
  userId: string,
  resource: string,
  actions: string[],
  expiresAt: string,
  grantedBy: string,
  reason: string,
): TemporaryPermission {
  const id = uid();
  const perm: TemporaryPermission = {
    id,
    userId,
    resource,
    actions,
    expiresAt,
    grantedBy,
    reason,
    createdAt: new Date().toISOString(),
  };
  temporaryPermissions.set(id, perm);

  auditLogs.push({
    id: uid(),
    userId: grantedBy,
    action: 'permission_granted',
    resource: id,
    details: { targetUserId: userId, resource, actions, reason },
    timestamp: perm.createdAt,
  });

  return perm;
}

export function getActiveTemporaryPermissions(userId: string): TemporaryPermission[] {
  const now = new Date();
  return Array.from(temporaryPermissions.values()).filter(
    (p) => p.userId === userId && new Date(p.expiresAt) > now,
  );
}

export function revokeTemporaryPermission(permId: string, revokedBy: string): boolean {
  return temporaryPermissions.delete(permId);
}

export function cleanupExpiredPermissions(): number {
  const now = new Date();
  let count = 0;
  for (const [id, perm] of temporaryPermissions) {
    if (new Date(perm.expiresAt) <= now) {
      temporaryPermissions.delete(id);
      count++;
    }
  }
  return count;
}

// ─── API Key Permissions ─────────────────────────────────────────────────────

export function createApiKey(
  name: string,
  permissions: Permission[],
  createdBy: string,
  expiresAt?: string,
  rateLimit?: number,
): ApiKey {
  const keyId = uid();
  const key: ApiKey = {
    keyId,
    name,
    permissions,
    createdBy,
    expiresAt,
    rateLimit: rateLimit ?? 60,
    createdAt: new Date().toISOString(),
  };
  apiKeys.set(keyId, key);
  return key;
}

export function getApiKeyPermissions(keyId: string): ApiKey | undefined {
  const key = apiKeys.get(keyId);
  if (!key) return undefined;
  if (key.revokedAt) return undefined;
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
    return undefined;
  }
  return key;
}

export function revokeApiKey(keyId: string, revokedBy: string): boolean {
  const key = apiKeys.get(keyId);
  if (!key) return false;
  key.revokedAt = new Date().toISOString();
  apiKeys.set(keyId, key);
  return true;
}

export function listApiKeys(createdBy: string): ApiKey[] {
  return Array.from(apiKeys.values()).filter((k) => k.createdBy === createdBy && !k.revokedAt);
}

// ─── Enhanced Permission Engine ───────────────────────────────────────────────

export class EnhancedPermissionEngine {
  private extraPermissions: Permission[];

  constructor(extraPermissions: Permission[] = []) {
    this.extraPermissions = extraPermissions;
  }

  evaluateWithCustomRole(
    ctx: AbacContext,
    resource: string,
    action: string,
    customRoleId?: string,
    apiKeyId?: string,
  ): 'allow' | 'deny' {
    // Check API key first
    if (apiKeyId) {
      const apiKey = getApiKeyPermissions(apiKeyId);
      if (apiKey) {
        for (const perm of apiKey.permissions) {
          if ((perm.resource === resource || perm.resource === '*') &&
              (perm.actions.includes(action) || perm.actions.includes('*'))) {
            return 'allow';
          }
        }
        return 'deny';
      }
    }

    // Check custom role
    if (customRoleId) {
      const perms = resolveRolePermissions(customRoleId);
      for (const perm of perms) {
        if ((perm.resource === resource || perm.resource === '*') &&
            (perm.actions.includes(action) || perm.actions.includes('*'))) {
          return 'allow';
        }
      }
      return 'deny';
    }

    // Check temporary permissions
    const tempPerms = getActiveTemporaryPermissions(ctx.userId);
    for (const tp of tempPerms) {
      if ((tp.resource === resource || tp.resource === '*') &&
          (tp.actions.includes(action) || tp.actions.includes('*'))) {
        return 'allow';
      }
    }

    // Fall back to role-based evaluation
    return roleAtLeast(ctx.role, 'admin') ? 'allow' : 'deny';
  }
}

// ─── Audit Logging ────────────────────────────────────────────────────────────

export interface AuditLogFilter {
  action?: string;
  userId?: string;
  limit?: number;
}

export function getAuditLogs(filter?: AuditLogFilter): AuditLogEntry[] {
  let logs = [...auditLogs].reverse();

  if (filter?.action) {
    logs = logs.filter((l) => l.action === filter.action);
  }
  if (filter?.userId) {
    logs = logs.filter((l) => l.userId === filter.userId);
  }
  if (filter?.limit && filter.limit > 0) {
    logs = logs.slice(0, filter.limit);
  }

  return logs;
}
