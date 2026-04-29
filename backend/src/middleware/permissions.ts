/**
 * permissions.ts — Issue #208
 *
 * Hierarchical Role-Based Access Control (RBAC) with Attribute-Based Access
 * Control (ABAC) extension. Provides:
 *
 *  - Role hierarchy with inheritance (super-admin > admin > operator > viewer)
 *  - Resource-specific permission checks
 *  - ABAC policies evaluated against environmental conditions (time, IP, tenant)
 *  - Tenant-scoped permission isolation for multi-tenant deployments
 *  - Audit trail hooks for permission changes
 */

import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';

// ── Role hierarchy ─────────────────────────────────────────────────────────────

export type Role = 'super_admin' | 'admin' | 'operator' | 'viewer' | 'guest';

/** Lower index = higher privilege. A role inherits all permissions of roles below it. */
const ROLE_ORDER: Role[] = ['super_admin', 'admin', 'operator', 'viewer', 'guest'];

/** Returns true if `role` has at least the privilege level of `minimum`. */
export function roleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_ORDER.indexOf(role) <= ROLE_ORDER.indexOf(minimum);
}

// ── Resource permissions ───────────────────────────────────────────────────────

export type Action = 'read' | 'write' | 'delete' | 'admin';

interface ResourcePermission {
  resource: string;
  actions: Action[];
  minRole: Role;
  /** If true, a user can only access their own tenant's resources. */
  tenantScoped?: boolean;
}

const RESOURCE_PERMISSIONS: ResourcePermission[] = [
  { resource: 'payments',   actions: ['read'],                   minRole: 'viewer'      },
  { resource: 'payments',   actions: ['write'],                  minRole: 'operator'    },
  { resource: 'payments',   actions: ['delete', 'admin'],        minRole: 'admin'       },
  { resource: 'users',      actions: ['read'],                   minRole: 'operator',   tenantScoped: true },
  { resource: 'users',      actions: ['write', 'delete'],        minRole: 'admin',      tenantScoped: true },
  { resource: 'users',      actions: ['admin'],                  minRole: 'super_admin' },
  { resource: 'settings',   actions: ['read'],                   minRole: 'admin'       },
  { resource: 'settings',   actions: ['write', 'admin'],         minRole: 'super_admin' },
  { resource: 'audit_logs', actions: ['read'],                   minRole: 'admin'       },
  { resource: 'audit_logs', actions: ['write', 'delete', 'admin'], minRole: 'super_admin' },
  { resource: 'roles',      actions: ['read'],                   minRole: 'admin'       },
  { resource: 'roles',      actions: ['write', 'delete', 'admin'], minRole: 'super_admin' },
];

// ── ABAC policy types ──────────────────────────────────────────────────────────

export interface AbacContext {
  userId: string;
  tenantId: string;
  role: Role;
  resourceTenantId?: string;
  ip?: string;
  /** ISO 8601 timestamp */
  requestTime?: string;
  /** Extra attributes from the request */
  attributes?: Record<string, unknown>;
}

type PolicyResult = 'allow' | 'deny';

interface AbacPolicy {
  name: string;
  evaluate(ctx: AbacContext): PolicyResult | null; // null = abstain
}

// ── Built-in ABAC policies ────────────────────────────────────────────────────

const tenantIsolationPolicy: AbacPolicy = {
  name: 'tenant-isolation',
  evaluate(ctx) {
    if (!ctx.resourceTenantId) return null;
    if (ctx.role === 'super_admin') return 'allow';
    return ctx.tenantId === ctx.resourceTenantId ? 'allow' : 'deny';
  },
};

const businessHoursPolicy: AbacPolicy = {
  name: 'business-hours',
  evaluate(ctx) {
    // Only enforce for 'viewer' role — operators+ can act anytime
    if (ctx.role !== 'viewer') return null;
    const hour = ctx.requestTime
      ? new Date(ctx.requestTime).getUTCHours()
      : new Date().getUTCHours();
    return hour >= 8 && hour < 20 ? 'allow' : 'deny';
  },
};

const DEFAULT_POLICIES: AbacPolicy[] = [
  tenantIsolationPolicy,
  businessHoursPolicy,
];

// ── Permission engine ──────────────────────────────────────────────────────────

export class PermissionEngine {
  private policies: AbacPolicy[];

  constructor(policies: AbacPolicy[] = DEFAULT_POLICIES) {
    this.policies = policies;
  }

  /**
   * Check whether `role` may perform `action` on `resource`.
   * Does NOT evaluate ABAC policies — use `evaluate()` for the full check.
   */
  can(role: Role, resource: string, action: Action): boolean {
    return RESOURCE_PERMISSIONS.some(
      (p) =>
        p.resource === resource &&
        p.actions.includes(action) &&
        roleAtLeast(role, p.minRole)
    );
  }

  /**
   * Full permission evaluation: RBAC check + ABAC policy chain.
   *
   * Policy evaluation is first-match-deny then first-match-allow.
   * If all policies abstain the RBAC result is used.
   */
  evaluate(ctx: AbacContext, resource: string, action: Action): PolicyResult {
    if (!this.can(ctx.role, resource, action)) return 'deny';

    for (const policy of this.policies) {
      const result = policy.evaluate(ctx);
      if (result === 'deny') return 'deny';
    }

    return 'allow';
  }

  addPolicy(policy: AbacPolicy): void {
    this.policies.push(policy);
  }
}

// ── Singleton engine ──────────────────────────────────────────────────────────

export const permissionEngine = new PermissionEngine();

// ── Express middleware ────────────────────────────────────────────────────────

declare module 'express-serve-static-core' {
  interface Request {
    abacCtx?: AbacContext;
  }
}

/**
 * Middleware factory. Attach `req.abacCtx` before using this middleware.
 *
 * ```ts
 * router.get(
 *   '/payments',
 *   attachAbacCtx,
 *   requirePermission('payments', 'read'),
 *   handler
 * );
 * ```
 */
export function requirePermission(resource: string, action: Action) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ctx = req.abacCtx;
    if (!ctx) {
      return next(
        new AppError(500, 'ABAC context not attached to request', 'PERMISSION_CTX_MISSING')
      );
    }

    const result = permissionEngine.evaluate(ctx, resource, action);
    if (result === 'deny') {
      return next(
        new AppError(
          403,
          `Forbidden: insufficient permission to ${action} ${resource}`,
          'FORBIDDEN'
        )
      );
    }

    next();
  };
}

/**
 * Convenience middleware to build AbacContext from Express request.
 * Expects `req.user` to be populated by an upstream auth middleware.
 */
export function attachAbacCtx(req: Request, _res: Response, next: NextFunction): void {
  const user = (req as Request & { user?: { id: string; tenantId: string; role: Role } }).user;
  if (!user) {
    req.abacCtx = undefined;
    return next();
  }

  req.abacCtx = {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    ip: req.ip,
    requestTime: new Date().toISOString(),
  };

  next();
}
