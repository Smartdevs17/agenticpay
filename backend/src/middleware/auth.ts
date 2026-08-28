/**
 * auth.ts — Issue #721
 *
 * Composable, multi-strategy authentication middleware.
 *
 * `routes/push.ts` (and, going forward, any route that needs a hard
 * authentication gate) imports `authMiddleware` from this module — but the
 * module didn't exist, so that import was broken. This codebase already had
 * three independent, single-purpose credential validators
 * (`token-auth.ts`, `hmac-auth.ts`, `ws-auth.ts`) plus a session store
 * (`services/session.ts`) and an API-key registry
 * (`services/api-key-registry.ts`), none of which populated `req.user` or
 * enforced that *some* strategy succeeded. This module is the missing piece:
 * an `AuthStrategy` interface, one implementation per credential type
 * (reusing the existing validators rather than re-implementing their
 * crypto/replay-protection logic), and an orchestrator that tries every
 * strategy whose credential is present on the request, populates
 * `req.user` on the first success (in the same `{id, tenantId, role}` shape
 * `BaseController.getUser()` already expects), and otherwise rejects with a
 * 401.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { AppError } from './errorHandler.js';
import { hmacAuthMiddleware, HEADER_SIGNATURE } from './hmac-auth.js';
import { tokenAuthMiddleware } from './token-auth.js';
import { getSession } from '../services/session.js';
import { lookupApiKey } from '../services/api-key-registry.js';

export type AuthMethod = 'session' | 'hmac' | 'token' | 'apiKey';

export interface AuthPrincipal {
  id: string;
  tenantId: string;
  role: string;
  method: AuthMethod;
}

// `req.user` is read throughout the codebase (errorHandler, BaseController,
// responseFormatter, ...) but was never declared on Express's Request type.
declare global {
  namespace Express {
    interface Request {
      user?: AuthPrincipal;
    }
  }
}

export interface AuthStrategy {
  name: AuthMethod;
  /** Does this request carry this strategy's credential? */
  applies(req: Request): boolean;
  /** Validate the credential and resolve a principal. Throws on invalid credentials. */
  authenticate(req: Request, res: Response): Promise<AuthPrincipal>;
}

function getHeader(req: Request, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Runs an Express-shaped middleware and resolves once it calls `next()`. */
function runMiddleware(mw: RequestHandler, req: Request, res: Response): Promise<{ ok: true } | { ok: false; error: unknown }> {
  return new Promise((resolve) => {
    mw(req, res, ((err?: unknown) => {
      resolve(err ? { ok: false, error: err } : { ok: true });
    }) as NextFunction);
  });
}

// ── Strategies ──────────────────────────────────────────────────────────────

/** `x-session-id` header, validated against the in-memory session store. */
export const sessionStrategy: AuthStrategy = {
  name: 'session',
  applies: (req) => Boolean(getHeader(req, 'x-session-id')),
  async authenticate(req) {
    const sessionId = getHeader(req, 'x-session-id')!;
    const session = getSession(sessionId);
    if (!session || session.status === 'terminated') {
      throw new AppError(401, 'Invalid or terminated session', 'SESSION_INVALID');
    }
    return {
      id: session.userId,
      tenantId: getHeader(req, 'x-tenant-id') ?? 'default',
      role: 'user',
      method: 'session',
    };
  },
};

/** `X-Signature`/`X-Timestamp`/`X-Nonce` headers — delegates to the existing HMAC verifier. */
export const hmacStrategy: AuthStrategy = {
  name: 'hmac',
  applies: (req) => Boolean(getHeader(req, HEADER_SIGNATURE)),
  async authenticate(req, res) {
    const result = await runMiddleware(hmacAuthMiddleware({ required: true }), req, res);
    if (!result.ok) throw result.error;
    const augmented = req as Request & { hmacKeyId?: string; hmacTenantId?: string };
    return {
      id: augmented.hmacKeyId ?? 'unknown-key',
      tenantId: augmented.hmacTenantId ?? 'default',
      role: 'service',
      method: 'hmac',
    };
  },
};

/** `Authorization: Bearer at_...` header — delegates to the existing token format validator. */
export const tokenStrategy: AuthStrategy = {
  name: 'token',
  applies: (req) => Boolean(req.headers.authorization?.startsWith('Bearer ')),
  async authenticate(req, res) {
    const result = await runMiddleware(tokenAuthMiddleware, req, res);
    if (!result.ok) throw result.error;
    const token = (req as Request & { accessToken?: string }).accessToken;
    if (!token) throw new AppError(401, 'Malformed access token', 'TOKEN_MALFORMED');
    return {
      id: token,
      tenantId: getHeader(req, 'x-tenant-id') ?? 'default',
      role: 'user',
      method: 'token',
    };
  },
};

/** `x-api-key` header, resolved against the API key registry. */
export const apiKeyStrategy: AuthStrategy = {
  name: 'apiKey',
  applies: (req) => Boolean(getHeader(req, 'x-api-key')),
  async authenticate(req) {
    const key = getHeader(req, 'x-api-key')!;
    const record = lookupApiKey(key);
    if (!record) throw new AppError(401, 'Invalid API key', 'API_KEY_INVALID');
    return {
      id: record.key,
      tenantId: getHeader(req, 'x-tenant-id') ?? 'default',
      role: record.tier,
      method: 'apiKey',
    };
  },
};

export const DEFAULT_AUTH_STRATEGIES: AuthStrategy[] = [sessionStrategy, hmacStrategy, tokenStrategy, apiKeyStrategy];

/**
 * Build an auth middleware from a list of strategies. Every strategy whose
 * credential is present on the request is tried, in order; the first one to
 * successfully authenticate wins and its principal is attached as
 * `req.user`. If none of the applicable strategies succeed, the last
 * failure is forwarded to the error handler; if no strategy's credential is
 * present at all, responds 401 "Authentication required".
 */
export function createAuthMiddleware(strategies: AuthStrategy[] = DEFAULT_AUTH_STRATEGIES): RequestHandler {
  return async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const applicable = strategies.filter((s) => s.applies(req));
    if (applicable.length === 0) {
      next(new AppError(401, 'Authentication required', 'AUTH_REQUIRED'));
      return;
    }

    for (let i = 0; i < applicable.length; i++) {
      try {
        const principal = await applicable[i].authenticate(req, res);
        req.user = principal;
        next();
        return;
      } catch (err) {
        if (i === applicable.length - 1) {
          next(err);
          return;
        }
        // Otherwise fall through and try the next applicable strategy.
      }
    }
  };
}

export const authMiddleware = createAuthMiddleware();
