import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';
import {
    getMemberRole,
    roleHasPermission,
    type ResourceAction,
    type WorkspaceRole,
} from '../services/workspaces.js';

/**
 * The user's role in a workspace. Uses the scopes the auth middleware
 * prefetched for this request when they belong to the same user (#1464);
 * otherwise falls back to a direct lookup, e.g. on routes that set
 * `req.userId` without going through `authMiddleware`.
 */
function resolveRole(req: Request, workspaceId: string, userId: string): WorkspaceRole | undefined {
    const scopes = req.workspaceScopes;
    if (scopes && scopes.userId === userId) {
        return scopes.roles.get(workspaceId);
    }
    return getMemberRole(workspaceId, userId);
}

/**
 * Middleware factory that checks if the authenticated user has the required
 * permission on a workspace. The workspace ID is extracted from the request
 * (params, query, or body).
 */
export function requirePermission(action: ResourceAction, getWorkspaceId?: (req: Request) => string) {
    return (req: Request, _res: Response, next: NextFunction): void => {
        const userId = (req as any).user?.id || (req as any).userId;
        if (!userId) {
            next(new AppError(401, 'Authentication required', 'UNAUTHORIZED'));
            return;
        }

        const workspaceId = getWorkspaceId
            ? getWorkspaceId(req)
            : req.params.workspaceId || req.query.workspaceId as string || req.body?.workspaceId;

        if (!workspaceId) {
            next(new AppError(400, 'Workspace ID is required', 'VALIDATION_ERROR'));
            return;
        }

        const role = resolveRole(req, workspaceId, userId);
        if (!role || !roleHasPermission(role, action)) {
            next(new AppError(403, 'Insufficient permissions for this action', 'FORBIDDEN'));
            return;
        }

        next();
    };
}

/**
 * Middleware that attaches workspace context to the request.
 * Extracts workspaceId from header, params, query, or body.
 */
export function resolveWorkspace(req: Request, _res: Response, next: NextFunction): void {
    const workspaceId =
        req.headers['x-workspace-id'] as string ||
        req.params.workspaceId ||
        req.query.workspaceId as string ||
        req.body?.workspaceId;

    if (workspaceId) {
        (req as any).workspaceId = workspaceId;
    }

    next();
}

/**
 * Middleware that requires a specific role (or higher) for access.
 * Role hierarchy: owner > admin > member > viewer
 */
export function requireRole(minimumRole: 'admin' | 'owner') {
    const roleHierarchy: Record<string, number> = {
        viewer: 0,
        member: 1,
        admin: 2,
        owner: 3,
    };

    return (req: Request, _res: Response, next: NextFunction): void => {
        const userId = (req as any).user?.id || (req as any).userId;
        if (!userId) {
            next(new AppError(401, 'Authentication required', 'UNAUTHORIZED'));
            return;
        }

        const workspaceId = (req as any).workspaceId ||
            req.params.workspaceId ||
            req.query.workspaceId as string ||
            req.body?.workspaceId;

        if (!workspaceId) {
            next(new AppError(400, 'Workspace ID is required', 'VALIDATION_ERROR'));
            return;
        }

        const role = resolveRole(req, workspaceId, userId);

        if (!role) {
            next(new AppError(403, 'Not a member of this workspace', 'FORBIDDEN'));
            return;
        }

        const userLevel = roleHierarchy[role] ?? -1;
        const requiredLevel = roleHierarchy[minimumRole] ?? 99;

        if (userLevel < requiredLevel) {
            next(new AppError(403, `Requires ${minimumRole} role or higher`, 'FORBIDDEN'));
            return;
        }

        next();
    };
}