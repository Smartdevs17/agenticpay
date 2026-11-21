/**
 * Workspace scope prefetch in the auth middleware (#1464).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

// Count every per-check role lookup RBAC makes, while keeping the real store.
vi.mock('../../services/workspaces.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/workspaces.js')>();
  return { ...actual, getMemberRole: vi.fn(actual.getMemberRole), getWorkspaceScopes: vi.fn(actual.getWorkspaceScopes) };
});

import {
  createAuthMiddleware,
  getScopePrefetchStats,
  resetScopePrefetchStatsForTests,
  type AuthPrincipal,
  type AuthStrategy,
} from '../auth.js';
import { requirePermission, requireRole } from '../rbac.js';
import * as workspaces from '../../services/workspaces.js';

const getMemberRole = vi.mocked(workspaces.getMemberRole);
const getWorkspaceScopes = vi.mocked(workspaces.getWorkspaceScopes);

function strategy(principal: Partial<AuthPrincipal> & { id: string }, opts: { fail?: boolean } = {}): AuthStrategy {
  return {
    name: 'token',
    applies: () => true,
    authenticate: async () => {
      if (opts.fail) throw new Error('bad credentials');
      return { tenantId: 't1', role: 'user', method: 'token', ...principal };
    },
  };
}

function makeReq(extra: Record<string, unknown> = {}): Request {
  return { headers: {}, params: {}, query: {}, body: {}, ...extra } as unknown as Request;
}

async function run(mw: (req: Request, res: Response, next: NextFunction) => unknown, req: Request) {
  const next = vi.fn();
  await mw(req, {} as Response, next);
  return next;
}

/** Runs a synchronous RBAC middleware and returns what it passed to next(). */
function check(mw: (req: Request, res: Response, next: NextFunction) => void, req: Request) {
  const next = vi.fn();
  mw(req, {} as Response, next);
  return next.mock.calls[0]?.[0];
}

describe('auth middleware workspace scope prefetch', () => {
  let alphaId: string;
  let betaId: string;

  beforeEach(() => {
    workspaces.resetForTests();
    resetScopePrefetchStatsForTests();
    vi.clearAllMocks();
    alphaId = workspaces.createWorkspace({ name: 'Alpha', ownerId: 'owner-a' }).id;
    betaId = workspaces.createWorkspace({ name: 'Beta', ownerId: 'owner-b' }).id;
    workspaces.addMember(alphaId, 'alice', 'admin');
    workspaces.addMember(betaId, 'alice', 'viewer');
  });

  it('attaches every workspace role of the principal after authenticating', async () => {
    const req = makeReq();
    const next = await run(createAuthMiddleware([strategy({ id: 'alice' })]), req);

    expect(next).toHaveBeenCalledWith();
    expect(req.workspaceScopes?.userId).toBe('alice');
    expect(Object.fromEntries(req.workspaceScopes!.roles)).toEqual({ [alphaId]: 'admin', [betaId]: 'viewer' });
    expect(getWorkspaceScopes).toHaveBeenCalledTimes(1);
  });

  it('attaches an empty scope set for a principal with no memberships', async () => {
    const req = makeReq();
    await run(createAuthMiddleware([strategy({ id: 'nobody' })]), req);
    expect(req.workspaceScopes).toEqual({ userId: 'nobody', roles: new Map() });
  });

  it('serves every RBAC check on the request from the prefetched scopes', async () => {
    const req = makeReq({ params: { workspaceId: alphaId } });
    await run(createAuthMiddleware([strategy({ id: 'alice' })]), req);

    expect(check(requirePermission('payment:read'), req)).toBeUndefined();
    expect(check(requirePermission('payment:refund'), req)).toBeUndefined();
    expect(check(requireRole('admin'), req)).toBeUndefined();
    expect(check(requirePermission('workspace:delete'), req)).toMatchObject({ statusCode: 403 });
    expect(check(requireRole('owner'), req)).toMatchObject({ statusCode: 403 });

    // Five checks, zero per-check lookups: the single prefetch covered them.
    expect(getMemberRole).not.toHaveBeenCalled();
    expect(getWorkspaceScopes).toHaveBeenCalledTimes(1);
  });

  it('denies a workspace the principal does not belong to, from the scopes alone', async () => {
    const outsider = workspaces.createWorkspace({ name: 'Gamma', ownerId: 'owner-c' }).id;
    const req = makeReq({ params: { workspaceId: outsider } });
    await run(createAuthMiddleware([strategy({ id: 'alice' })]), req);

    expect(check(requirePermission('payment:read'), req)).toMatchObject({ statusCode: 403 });
    expect(check(requireRole('admin'), req)).toMatchObject({ statusCode: 403, message: 'Not a member of this workspace' });
    expect(getMemberRole).not.toHaveBeenCalled();
  });

  it('matches the direct lookup for every role and action', async () => {
    const actions = ['workspace:delete', 'payment:refund', 'payment:approve_refund', 'audit:read', 'webhook:create'] as const;
    const roles = ['owner', 'admin', 'member', 'viewer'] as const;
    for (const role of roles) {
      const userId = `user-${role}`;
      if (role !== 'owner') workspaces.addMember(alphaId, userId, role);
      const principalId = role === 'owner' ? 'owner-a' : userId;
      const req = makeReq({ params: { workspaceId: alphaId } });
      await run(createAuthMiddleware([strategy({ id: principalId })]), req);
      for (const action of actions) {
        const allowed = check(requirePermission(action), req) === undefined;
        expect(allowed, `${role} ${action}`).toBe(workspaces.hasPermission(alphaId, principalId, action));
      }
    }
  });

  it('falls back to a direct lookup when the request has no prefetched scopes', () => {
    const req = makeReq({ params: { workspaceId: alphaId }, userId: 'alice' });
    expect(check(requirePermission('payment:refund'), req)).toBeUndefined();
    expect(getMemberRole).toHaveBeenCalledWith(alphaId, 'alice');
  });

  it('never uses scopes that belong to a different user', async () => {
    const req = makeReq({ params: { workspaceId: alphaId } });
    await run(createAuthMiddleware([strategy({ id: 'alice' })]), req);
    // A later middleware switched the acting user; alice's scopes must not apply.
    (req as unknown as { user: AuthPrincipal }).user = { id: 'mallory', tenantId: 't1', role: 'user', method: 'token' };

    expect(check(requirePermission('payment:read'), req)).toMatchObject({ statusCode: 403 });
    expect(getMemberRole).toHaveBeenCalledWith(alphaId, 'mallory');
  });

  it('clears scopes supplied before authentication instead of trusting them', async () => {
    const forged = { userId: 'alice', roles: new Map([[alphaId, 'owner' as const]]) };
    const req = makeReq({ workspaceScopes: forged });
    const next = await run(createAuthMiddleware([strategy({ id: 'alice' }, { fail: true })]), req);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(req.workspaceScopes).toBeUndefined();
  });

  it('does not prefetch when authentication fails', async () => {
    const req = makeReq();
    await run(createAuthMiddleware([strategy({ id: 'alice' }, { fail: true })]), req);
    expect(getWorkspaceScopes).not.toHaveBeenCalled();
    expect(getScopePrefetchStats().prefetches).toBe(0);
  });

  it('still authenticates when the scope loader fails, and RBAC falls back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const req = makeReq({ params: { workspaceId: alphaId } });
    const next = await run(
      createAuthMiddleware([strategy({ id: 'alice' })], {
        loadWorkspaceScopes: () => {
          throw new Error('membership store unavailable');
        },
      }),
      req,
    );

    expect(next).toHaveBeenCalledWith();
    expect(req.user?.id).toBe('alice');
    expect(req.workspaceScopes).toBeUndefined();
    expect(check(requirePermission('payment:refund'), req)).toBeUndefined();
    expect(getMemberRole).toHaveBeenCalledTimes(1);
    expect(getScopePrefetchStats()).toMatchObject({ failures: 1, prefetches: 0 });
    expect(String(warn.mock.calls[0]?.[0])).toContain('workspace scope prefetch failed');
    warn.mockRestore();
  });

  it('awaits an asynchronous scope loader before continuing', async () => {
    const req = makeReq();
    await run(
      createAuthMiddleware([strategy({ id: 'alice' })], {
        loadWorkspaceScopes: async () => new Map([[alphaId, 'member' as const]]),
      }),
      req,
    );
    expect(req.workspaceScopes?.roles.get(alphaId)).toBe('member');
  });

  it('can disable prefetching', async () => {
    const req = makeReq();
    await run(createAuthMiddleware([strategy({ id: 'alice' })], { loadWorkspaceScopes: false }), req);
    expect(req.workspaceScopes).toBeUndefined();
    expect(getWorkspaceScopes).not.toHaveBeenCalled();
  });

  it('records prefetch counts and timing', async () => {
    const mw = createAuthMiddleware([strategy({ id: 'alice' })]);
    await run(mw, makeReq());
    await run(mw, makeReq());
    const stats = getScopePrefetchStats();
    expect(stats).toMatchObject({ prefetches: 2, failures: 0 });
    expect(stats.averageDurationMs).toBeGreaterThanOrEqual(0);
  });
});
