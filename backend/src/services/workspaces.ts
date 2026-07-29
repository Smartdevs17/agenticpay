import { randomUUID, randomBytes } from 'node:crypto';
import { AppError } from '../middleware/errorHandler.js';
import { ImmutableAuditLogger } from '../audit/immutable-logger.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export type WorkspaceRecord = {
    id: string;
    name: string;
    slug: string;
    description?: string;
    logoUrl?: string;
    ownerId: string;
    isActive: boolean;
    settings: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};

export type WorkspaceMemberRecord = {
    id: string;
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
    joinedAt: string;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string;
};

export type WorkspaceInvitationRecord = {
    id: string;
    workspaceId: string;
    email: string;
    role: WorkspaceRole;
    token: string;
    invitedBy: string;
    status: 'pending' | 'accepted' | 'declined' | 'expired';
    expiresAt: string;
    acceptedAt?: string;
    declinedAt?: string;
    createdAt: string;
};

// ── Permission Matrix ────────────────────────────────────────────────────────

export type ResourceAction =
    | 'workspace:read'
    | 'workspace:update'
    | 'workspace:delete'
    | 'workspace:manage_members'
    | 'workspace:manage_billing'
    | 'payment:read'
    | 'payment:refund'
    | 'payment:approve_refund'
    | 'invoice:read'
    | 'invoice:create'
    | 'invoice:update'
    | 'webhook:read'
    | 'webhook:create'
    | 'webhook:update'
    | 'webhook:delete'
    | 'report:read'
    | 'report:create'
    | 'settings:read'
    | 'settings:update'
    | 'audit:read';

const ROLE_PERMISSIONS: Record<WorkspaceRole, ResourceAction[]> = {
    owner: [
        'workspace:read', 'workspace:update', 'workspace:delete',
        'workspace:manage_members', 'workspace:manage_billing',
        'payment:read', 'payment:refund', 'payment:approve_refund',
        'invoice:read', 'invoice:create', 'invoice:update',
        'webhook:read', 'webhook:create', 'webhook:update', 'webhook:delete',
        'report:read', 'report:create',
        'settings:read', 'settings:update',
        'audit:read',
    ],
    admin: [
        'workspace:read', 'workspace:update',
        'workspace:manage_members',
        'payment:read', 'payment:refund', 'payment:approve_refund',
        'invoice:read', 'invoice:create', 'invoice:update',
        'webhook:read', 'webhook:create', 'webhook:update', 'webhook:delete',
        'report:read', 'report:create',
        'settings:read', 'settings:update',
        'audit:read',
    ],
    member: [
        'workspace:read',
        'payment:read', 'payment:refund',
        'invoice:read', 'invoice:create',
        'webhook:read',
        'report:read', 'report:create',
        'settings:read',
    ],
    viewer: [
        'workspace:read',
        'payment:read',
        'invoice:read',
        'webhook:read',
        'report:read',
        'settings:read',
        'audit:read',
    ],
};

// ── In-Memory Store ──────────────────────────────────────────────────────────

const workspaceStore = new Map<string, WorkspaceRecord>();
const memberStore = new Map<string, WorkspaceMemberRecord>();
const invitationStore = new Map<string, WorkspaceInvitationRecord>();
const auditLogger = new ImmutableAuditLogger();

// ── Slug Generation ──────────────────────────────────────────────────────────

function generateSlug(name: string): string {
    const base = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48);
    const suffix = randomBytes(4).toString('hex');
    return `${base}-${suffix}`;
}

// ── Workspace CRUD ───────────────────────────────────────────────────────────

export function createWorkspace(input: {
    name: string;
    description?: string;
    logoUrl?: string;
    ownerId: string;
    settings?: Record<string, unknown>;
}): WorkspaceRecord {
    const id = randomUUID();
    const slug = generateSlug(input.name);
    const now = new Date().toISOString();

    const workspace: WorkspaceRecord = {
        id,
        name: input.name,
        slug,
        description: input.description,
        logoUrl: input.logoUrl,
        ownerId: input.ownerId,
        isActive: true,
        settings: input.settings ?? {},
        createdAt: now,
        updatedAt: now,
    };

    workspaceStore.set(id, workspace);

    // Add owner as member with owner role
    const membership: WorkspaceMemberRecord = {
        id: randomUUID(),
        workspaceId: id,
        userId: input.ownerId,
        role: 'owner',
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
    };
    memberStore.set(membership.id, membership);

    auditLogger.log({
        actor: input.ownerId,
        action: 'workspace.created',
        resource: `workspace:${id}`,
        details: { name: input.name, slug },
    });

    return workspace;
}

export function getWorkspace(workspaceId: string): WorkspaceRecord | undefined {
    return workspaceStore.get(workspaceId);
}

export function getWorkspaceBySlug(slug: string): WorkspaceRecord | undefined {
    return Array.from(workspaceStore.values()).find((w) => w.slug === slug);
}

export function updateWorkspace(
    workspaceId: string,
    patch: Partial<Pick<WorkspaceRecord, 'name' | 'description' | 'logoUrl' | 'settings'>>,
): WorkspaceRecord | undefined {
    const existing = workspaceStore.get(workspaceId);
    if (!existing) {
        return undefined;
    }

    const updated: WorkspaceRecord = {
        ...existing,
        ...patch,
        id: existing.id,
        slug: existing.slug,
        ownerId: existing.ownerId,
        isActive: existing.isActive,
        updatedAt: new Date().toISOString(),
    };

    workspaceStore.set(workspaceId, updated);

    auditLogger.log({
        actor: 'system',
        action: 'workspace.updated',
        resource: `workspace:${workspaceId}`,
        details: { changes: Object.keys(patch) },
    });

    return updated;
}

export function deleteWorkspace(workspaceId: string): boolean {
    const existing = workspaceStore.get(workspaceId);
    if (!existing) {
        return false;
    }

    existing.isActive = false;
    existing.updatedAt = new Date().toISOString();
    workspaceStore.set(workspaceId, existing);

    auditLogger.log({
        actor: 'system',
        action: 'workspace.deleted',
        resource: `workspace:${workspaceId}`,
        details: { name: existing.name },
    });

    return true;
}

export function listWorkspaces(userId: string): WorkspaceRecord[] {
    const memberships = Array.from(memberStore.values()).filter(
        (m) => m.userId === userId && !m.deletedAt,
    );
    const workspaceIds = new Set(memberships.map((m) => m.workspaceId));
    return Array.from(workspaceStore.values()).filter(
        (w) => workspaceIds.has(w.id) && w.isActive,
    );
}

// ── Member Management ────────────────────────────────────────────────────────

export function addMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole = 'member',
): WorkspaceMemberRecord | undefined {
    const workspace = workspaceStore.get(workspaceId);
    if (!workspace) {
        return undefined;
    }

    const existing = Array.from(memberStore.values()).find(
        (m) => m.workspaceId === workspaceId && m.userId === userId,
    );
    if (existing) {
        return existing;
    }

    const now = new Date().toISOString();
    const membership: WorkspaceMemberRecord = {
        id: randomUUID(),
        workspaceId,
        userId,
        role,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
    };

    memberStore.set(membership.id, membership);

    auditLogger.log({
        actor: 'system',
        action: 'workspace.member.added',
        resource: `workspace:${workspaceId}`,
        details: { userId, role },
    });

    return membership;
}

export function updateMemberRole(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
): WorkspaceMemberRecord | undefined {
    const member = Array.from(memberStore.values()).find(
        (m) => m.workspaceId === workspaceId && m.userId === userId,
    );
    if (!member) {
        return undefined;
    }

    member.role = role;
    member.updatedAt = new Date().toISOString();
    memberStore.set(member.id, member);

    auditLogger.log({
        actor: 'system',
        action: 'workspace.member.role_updated',
        resource: `workspace:${workspaceId}`,
        details: { userId, newRole: role },
    });

    return member;
}

export function removeMember(workspaceId: string, userId: string): boolean {
    const member = Array.from(memberStore.values()).find(
        (m) => m.workspaceId === workspaceId && m.userId === userId,
    );
    if (!member) {
        return false;
    }

    memberStore.delete(member.id);

    auditLogger.log({
        actor: 'system',
        action: 'workspace.member.removed',
        resource: `workspace:${workspaceId}`,
        details: { userId },
    });

    return true;
}

export function getMembers(workspaceId: string): WorkspaceMemberRecord[] {
    return Array.from(memberStore.values())
        .filter((m) => m.workspaceId === workspaceId)
        .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}

export function getMemberRole(workspaceId: string, userId: string): WorkspaceRole | undefined {
    const member = Array.from(memberStore.values()).find(
        (m) => m.workspaceId === workspaceId && m.userId === userId,
    );
    return member?.role;
}

// ── Invitation System ────────────────────────────────────────────────────────

export function createInvitation(input: {
    workspaceId: string;
    email: string;
    role: WorkspaceRole;
    invitedBy: string;
}): WorkspaceInvitationRecord {
    const workspace = workspaceStore.get(input.workspaceId);
    if (!workspace) {
        throw new AppError(404, 'Workspace not found', 'NOT_FOUND');
    }

    const existing = Array.from(invitationStore.values()).find(
        (inv) =>
            inv.workspaceId === input.workspaceId &&
            inv.email === input.email &&
            inv.status === 'pending',
    );
    if (existing) {
        throw new AppError(409, 'A pending invitation already exists for this email', 'CONFLICT');
    }

    const token = randomBytes(32).toString('hex');
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const invitation: WorkspaceInvitationRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        email: input.email,
        role: input.role,
        token,
        invitedBy: input.invitedBy,
        status: 'pending',
        expiresAt,
        createdAt: now,
    };

    invitationStore.set(invitation.id, invitation);

    auditLogger.log({
        actor: input.invitedBy,
        action: 'workspace.invitation.created',
        resource: `workspace:${input.workspaceId}`,
        details: { email: input.email, role: input.role },
    });

    return invitation;
}

export function acceptInvitation(token: string, userId: string): WorkspaceMemberRecord | undefined {
    const invitation = Array.from(invitationStore.values()).find((inv) => inv.token === token);
    if (!invitation) {
        throw new AppError(404, 'Invitation not found', 'NOT_FOUND');
    }

    if (invitation.status !== 'pending') {
        throw new AppError(400, 'Invitation is no longer pending', 'INVITATION_EXPIRED');
    }

    if (new Date(invitation.expiresAt) < new Date()) {
        invitation.status = 'expired';
        invitationStore.set(invitation.id, invitation);
        throw new AppError(400, 'Invitation has expired', 'INVITATION_EXPIRED');
    }

    invitation.status = 'accepted';
    invitation.acceptedAt = new Date().toISOString();
    invitationStore.set(invitation.id, invitation);

    const member = addMember(invitation.workspaceId, userId, invitation.role);

    auditLogger.log({
        actor: userId,
        action: 'workspace.invitation.accepted',
        resource: `workspace:${invitation.workspaceId}`,
        details: { email: invitation.email, role: invitation.role },
    });

    return member;
}

export function declineInvitation(token: string): WorkspaceInvitationRecord | undefined {
    const invitation = Array.from(invitationStore.values()).find((inv) => inv.token === token);
    if (!invitation) {
        throw new AppError(404, 'Invitation not found', 'NOT_FOUND');
    }

    invitation.status = 'declined';
    invitation.declinedAt = new Date().toISOString();
    invitationStore.set(invitation.id, invitation);

    return invitation;
}

export function listInvitations(workspaceId: string): WorkspaceInvitationRecord[] {
    return Array.from(invitationStore.values())
        .filter((inv) => inv.workspaceId === workspaceId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── Permission Check ─────────────────────────────────────────────────────────

export function hasPermission(
    workspaceId: string,
    userId: string,
    action: ResourceAction,
): boolean {
    const role = getMemberRole(workspaceId, userId);
    if (!role) {
        return false;
    }
    return ROLE_PERMISSIONS[role].includes(action);
}

export function requirePermission(
    workspaceId: string,
    userId: string,
    action: ResourceAction,
): void {
    if (!hasPermission(workspaceId, userId, action)) {
        throw new AppError(403, 'Insufficient permissions', 'FORBIDDEN');
    }
}

export function getRolePermissions(role: WorkspaceRole): ResourceAction[] {
    return [...ROLE_PERMISSIONS[role]];
}

// ── Test Helpers ─────────────────────────────────────────────────────────────

export function resetForTests(): void {
    workspaceStore.clear();
    memberStore.clear();
    invitationStore.clear();
}