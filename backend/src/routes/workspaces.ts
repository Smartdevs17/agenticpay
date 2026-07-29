import { Router, Request, Response } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { requirePermission, resolveWorkspace } from '../middleware/rbac.js';
import {
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
    createInvitation,
    acceptInvitation,
    declineInvitation,
    listInvitations,
    getMemberRole,
} from '../services/workspaces.js';

export const workspacesRouter = Router();

// ── Workspace CRUD ───────────────────────────────────────────────────────────

workspacesRouter.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
        const { name, description, logoUrl, settings } = req.body;
        const userId = (req as any).user?.id || req.body.userId;
        if (!userId) {
            throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
        }
        const workspace = createWorkspace({ name, description, logoUrl, ownerId: userId, settings });
        res.status(201).json({ data: workspace });
    }),
);

workspacesRouter.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
        const userId = (req as any).user?.id || req.query.userId as string;
        if (!userId) {
            throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
        }
        const workspaces = listWorkspaces(userId);
        res.json({ data: workspaces, count: workspaces.length });
    }),
);

workspacesRouter.get(
    '/:workspaceId',
    resolveWorkspace,
    asyncHandler(async (req: Request, res: Response) => {
        const workspaceId = req.params.workspaceId;
        const workspace = getWorkspace(workspaceId);
        if (!workspace) {
            throw new AppError(404, 'Workspace not found', 'NOT_FOUND');
        }
        res.json({ data: workspace });
    }),
);

workspacesRouter.patch(
    '/:workspaceId',
    resolveWorkspace,
    requirePermission('workspace:update'),
    asyncHandler(async (req: Request, res: Response) => {
        const workspaceId = req.params.workspaceId;
        const { name, description, logoUrl, settings } = req.body;
        const updated = updateWorkspace(workspaceId, { name, description, logoUrl, settings });
        if (!updated) {
            throw new AppError(404, 'Workspace not found', 'NOT_FOUND');
        }
        res.json({ data: updated });
    }),
);

workspacesRouter.delete(
    '/:workspaceId',
    resolveWorkspace,
    requirePermission('workspace:delete'),
    asyncHandler(async (req: Request, res: Response) => {
        const workspaceId = req.params.workspaceId;
        const deleted = deleteWorkspace(workspaceId);
        if (!deleted) {
            throw new AppError(404, 'Workspace not found', 'NOT_FOUND');
        }
        res.json({ data: { message: 'Workspace deleted' } });
    }),
);

// ── Member Management ────────────────────────────────────────────────────────

workspacesRouter.get(
    '/:workspaceId/members',
    resolveWorkspace,
    requirePermission('workspace:read'),
    asyncHandler(async (req: Request, res: Response) => {
        const workspaceId = req.params.workspaceId;
        const members = getMembers(workspaceId);
        res.json({ data: members, count: members.length });
    }),
);

workspacesRouter.post(
    '/:workspaceId/members',
    resolveWorkspace,
    requirePermission('workspace:manage_members'),
    asyncHandler(async (req: Request, res: Response) => {
        const workspaceId = req.params.workspaceId;
        const { userId, role } = req.body;
        if (!userId) {
            throw new AppError(400, 'userId is required', 'VALIDATION_ERROR');
        }
        const member = addMember(workspaceId, userId, role || 'member');
        if (!member) {
            throw new AppError(404, 'Workspace not found', 'NOT_FOUND');
        }
        res.status(201).json({ data: member });
    }),
);

workspacesRouter.patch(
    '/:workspaceId/members/:userId',
    resolveWorkspace,
    requirePermission('workspace:manage_members'),
    asyncHandler(async (req: Request, res: Response) => {
        const { workspaceId, userId } = req.params;
        const { role } = req.body;
        if (!role) {
            throw new AppError(400, 'role is required', 'VALIDATION_ERROR');
        }
        const updated = updateMemberRole(workspaceId, userId, role);
        if (!updated) {
            throw new AppError(404, 'Member not found', 'NOT_FOUND');
        }
        res.json({ data: updated });
    }),
);

workspacesRouter.delete(
    '/:workspaceId/members/:userId',
    resolveWorkspace,
    requirePermission('workspace:manage_members'),
    asyncHandler(async (req: Request, res: Response) => {
        const { workspaceId, userId } = req.params;
        const removed = removeMember(workspaceId, userId);
        if (!removed) {
            throw new AppError(404, 'Member not found', 'NOT_FOUND');
        }
        res.json({ data: { message: 'Member removed' } });
    }),
);

// ── Invitations ──────────────────────────────────────────────────────────────

workspacesRouter.post(
    '/:workspaceId/invitations',
    resolveWorkspace,
    requirePermission('workspace:manage_members'),
    asyncHandler(async (req: Request, res: Response) => {
        const workspaceId = req.params.workspaceId;
        const { email, role } = req.body;
        const invitedBy = (req as any).user?.id || req.body.invitedBy;
        if (!email) {
            throw new AppError(400, 'email is required', 'VALIDATION_ERROR');
        }
        const invitation = createInvitation({ workspaceId, email, role: role || 'member', invitedBy });
        res.status(201).json({ data: invitation });
    }),
);

workspacesRouter.get(
    '/:workspaceId/invitations',
    resolveWorkspace,
    requirePermission('workspace:manage_members'),
    asyncHandler(async (req: Request, res: Response) => {
        const workspaceId = req.params.workspaceId;
        const invitations = listInvitations(workspaceId);
        res.json({ data: invitations, count: invitations.length });
    }),
);

workspacesRouter.post(
    '/invitations/:token/accept',
    asyncHandler(async (req: Request, res: Response) => {
        const token = req.params.token;
        const userId = (req as any).user?.id || req.body.userId;
        if (!userId) {
            throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
        }
        const member = acceptInvitation(token, userId);
        res.json({ data: member });
    }),
);

workspacesRouter.post(
    '/invitations/:token/decline',
    asyncHandler(async (req: Request, res: Response) => {
        const token = req.params.token;
        const invitation = declineInvitation(token);
        res.json({ data: invitation });
    }),
);

// ── Slug Lookup ──────────────────────────────────────────────────────────────

workspacesRouter.get(
    '/slug/:slug',
    asyncHandler(async (req: Request, res: Response) => {
        const slug = req.params.slug;
        const workspace = getWorkspaceBySlug(slug);
        if (!workspace) {
            throw new AppError(404, 'Workspace not found', 'NOT_FOUND');
        }
        res.json({ data: workspace });
    }),
);