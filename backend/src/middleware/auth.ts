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

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { AppError } from './errorHandler.js';
import { hmacAuthMiddleware, HEADER_SIGNATURE } from './hmac-auth.js';
import { tokenAuthMiddleware } from './token-auth.js';
import { getSession } from '../services/session.js';
import { lookupApiKey } from '../services/api-key-registry.js';
import type { AccessTokenClaims } from '../auth/jwt.js';
import { mergeLogContext } from '../logging/context.js';
import { getWorkspaceScopes, type WorkspaceRole } from '../services/workspaces.js';
import { logger } from '../utils/logger.js';

export type AuthMethod = 'session' | 'hmac' | 'token' | 'apiKey' | 'agent';

export const AGENT_TOKEN_HEADER = 'x-agent-token';
export const AGENT_TOKEN_TYPE = 'agent+jwt';
export const AGENT_TOKEN_AUDIENCE = 'agenticpay-agent';
export const AGENT_TOKEN_ISSUER = 'agenticpay-agent-sdk';
export const MAX_AGENT_TOKEN_TTL_SECONDS = 300;
export const AGENT_TOKEN_CLOCK_SKEW_SECONDS = 30;

const AGENT_TOKEN_SCOPE_PATTERN = /^[a-z0-9][a-z0-9:._-]{1,127}$/i;

export interface AgentTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  agentId: string;
  jti: string;
  iat: number;
  exp: number;
  scope: string[];
  tenantId?: string;
}

export interface AuthPrincipal {
  id: string;
  tenantId: string;
  role: string;
  method: AuthMethod;
}

/**
 * The principal's workspace memberships (workspace id → role), loaded once
 * per request right after authentication (#1464). `userId` records whose
 * scopes these are, so a check for a different user never reads them.
 */
export interface WorkspaceScopes {
  userId: string;
  roles: ReadonlyMap<string, WorkspaceRole>;
}

export type WorkspaceScopeLoader = (
  principal: AuthPrincipal,
) => ReadonlyMap<string, WorkspaceRole> | Promise<ReadonlyMap<string, WorkspaceRole>>;

export const defaultWorkspaceScopeLoader: WorkspaceScopeLoader = (principal) => getWorkspaceScopes(principal.id);

export interface AuthMiddlewareOptions {
  /** Loads the principal's workspace scopes; pass `false` to skip prefetching. */
  loadWorkspaceScopes?: WorkspaceScopeLoader | false;
}

export interface ScopePrefetchStats {
  prefetches: number;
  failures: number;
  lastDurationMs: number;
  averageDurationMs: number;
}

const prefetchStats = { prefetches: 0, failures: 0, lastDurationMs: 0, totalDurationMs: 0 };

/** Scope prefetch counters and timing since process start (or the last reset). */
export function getScopePrefetchStats(): ScopePrefetchStats {
  return {
    prefetches: prefetchStats.prefetches,
    failures: prefetchStats.failures,
    lastDurationMs: prefetchStats.lastDurationMs,
    averageDurationMs:
      prefetchStats.prefetches === 0 ? 0 : prefetchStats.totalDurationMs / prefetchStats.prefetches,
  };
}

export function resetScopePrefetchStatsForTests(): void {
  prefetchStats.prefetches = 0;
  prefetchStats.failures = 0;
  prefetchStats.lastDurationMs = 0;
  prefetchStats.totalDurationMs = 0;
}

/**
 * Attaches the principal's workspace scopes to the request. A loader failure
 * never fails authentication: the request continues without prefetched
 * scopes, and RBAC falls back to looking the role up directly, so access
 * decisions stay correct.
 */
async function prefetchWorkspaceScopes(req: Request, principal: AuthPrincipal, load: WorkspaceScopeLoader): Promise<void> {
  const started = performance.now();
  try {
    const roles = await load(principal);
    req.workspaceScopes = { userId: principal.id, roles };
    const duration = performance.now() - started;
    prefetchStats.prefetches += 1;
    prefetchStats.lastDurationMs = duration;
    prefetchStats.totalDurationMs += duration;
  } catch (err) {
    prefetchStats.failures += 1;
    req.workspaceScopes = undefined;
    logger.warn('workspace scope prefetch failed; RBAC will look roles up per check', {
      principalId: principal.id,
      method: principal.method,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// `req.user` is read throughout the codebase (errorHandler, BaseController,
// responseFormatter, ...) but was never declared on Express's Request type.
declare global {
  namespace Express {
    interface Request {
      user?: AuthPrincipal;
      /** Raw bearer token, set by `tokenAuthMiddleware` once verified. */
      accessToken?: string;
      /** Verified JWT claims, set by `tokenAuthMiddleware`. */
      accessTokenClaims?: AccessTokenClaims;
      agentToken?: string;
      agentTokenClaims?: AgentTokenClaims;
      /** Workspace memberships prefetched by the auth middleware (#1464). */
      workspaceScopes?: WorkspaceScopes;
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

export interface AgentTokenVerificationOptions {
  secret?: string;
  previousSecret?: string;
  issuer?: string;
  audience?: string;
  now?: number;
  clockSkewSeconds?: number;
}

function envValue(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url segment');
  return Buffer.from(value, 'base64url');
}

function constantTimeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseAgentTokenClaims(value: unknown): AgentTokenClaims | undefined {
  if (!isRecord(value)) return undefined;
  if (!isNonEmptyString(value.iss) || !isNonEmptyString(value.aud)) return undefined;
  if (!isNonEmptyString(value.sub) || !isNonEmptyString(value.agentId) || !isNonEmptyString(value.jti)) return undefined;
  if (value.jti.length > 256) return undefined;
  if (typeof value.iat !== 'number' || !Number.isFinite(value.iat)) return undefined;
  if (typeof value.exp !== 'number' || !Number.isFinite(value.exp)) return undefined;
  if (value.tenantId !== undefined && !isNonEmptyString(value.tenantId)) return undefined;
  if (!Array.isArray(value.scope) || value.scope.length === 0 || value.scope.length > 50) return undefined;
  if (!value.scope.every((scope) => isNonEmptyString(scope) && AGENT_TOKEN_SCOPE_PATTERN.test(scope))) return undefined;

  return {
    iss: value.iss,
    aud: value.aud,
    sub: value.sub,
    agentId: value.agentId,
    jti: value.jti,
    iat: value.iat,
    exp: value.exp,
    scope: value.scope,
    tenantId: value.tenantId,
  };
}

export function verifyAgentToken(token: string, options: AgentTokenVerificationOptions = {}): AgentTokenClaims {
  const secret = options.secret ?? envValue('AGENT_TOKEN_SECRET') ?? envValue('JWT_SECRET');
  if (!secret || secret.length < 32) {
    throw new AppError(503, 'Agent token secret is not configured', 'AGENT_TOKEN_SECRET_MISSING');
  }

  const previousSecret = options.previousSecret ?? envValue('AGENT_TOKEN_SECRET_PREVIOUS');
  const segments = token.split('.');
  if (segments.length !== 3) throw new AppError(401, 'Malformed agent token', 'AGENT_TOKEN_MALFORMED');

  let header: Record<string, unknown>;
  let payload: unknown;
  try {
    header = JSON.parse(decodeBase64Url(segments[0]).toString('utf8')) as Record<string, unknown>;
    payload = JSON.parse(decodeBase64Url(segments[1]).toString('utf8')) as unknown;
  } catch {
    throw new AppError(401, 'Malformed agent token', 'AGENT_TOKEN_MALFORMED');
  }

  if (!isRecord(header) || header.alg !== 'HS256' || header.typ !== AGENT_TOKEN_TYPE) {
    throw new AppError(401, 'Unsupported agent token type', 'AGENT_TOKEN_TYPE_INVALID');
  }

  let signature: Buffer;
  try {
    signature = decodeBase64Url(segments[2]);
  } catch {
    throw new AppError(401, 'Malformed agent token', 'AGENT_TOKEN_MALFORMED');
  }

  const signingInput = `${segments[0]}.${segments[1]}`;
  const secrets = [secret, previousSecret].filter((candidate): candidate is string => Boolean(candidate && candidate.length >= 32));
  const verified = secrets.some((candidate) => constantTimeEqual(signature, createHmac('sha256', candidate).update(signingInput).digest()));
  if (!verified) throw new AppError(401, 'Invalid agent token signature', 'AGENT_TOKEN_SIGNATURE_INVALID');

  const claims = parseAgentTokenClaims(payload);
  if (!claims) throw new AppError(401, 'Invalid agent token claims', 'AGENT_TOKEN_CLAIMS_INVALID');

  const issuer = options.issuer ?? envValue('AGENT_TOKEN_ISSUER') ?? AGENT_TOKEN_ISSUER;
  const audience = options.audience ?? envValue('AGENT_TOKEN_AUDIENCE') ?? AGENT_TOKEN_AUDIENCE;
  if (claims.iss !== issuer || claims.aud !== audience) {
    throw new AppError(401, 'Invalid agent token issuer or audience', 'AGENT_TOKEN_AUDIENCE_INVALID');
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const skew = options.clockSkewSeconds ?? AGENT_TOKEN_CLOCK_SKEW_SECONDS;
  if (claims.iat > now + skew) throw new AppError(401, 'Agent token is not yet valid', 'AGENT_TOKEN_NOT_YET_VALID');
  if (claims.exp <= now - skew) throw new AppError(401, 'Agent token has expired', 'AGENT_TOKEN_EXPIRED');
  if (claims.exp <= claims.iat || claims.exp - claims.iat > MAX_AGENT_TOKEN_TTL_SECONDS) {
    throw new AppError(401, 'Agent token lifetime exceeds the allowed maximum', 'AGENT_TOKEN_TTL_INVALID');
  }

  return claims;
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

/** `Authorization: Bearer <jwt>` header — delegates to the JWT access-token verifier. */
export const tokenStrategy: AuthStrategy = {
  name: 'token',
  applies: (req) => Boolean(req.headers.authorization?.startsWith('Bearer ')),
  async authenticate(req, res) {
    const result = await runMiddleware(tokenAuthMiddleware, req, res);
    if (!result.ok) throw result.error;
    const claims = req.accessTokenClaims;
    if (!claims) throw new AppError(401, 'Malformed access token', 'TOKEN_MALFORMED');
    // Identity comes from the verified claims, never from caller-supplied headers.
    return {
      id: claims.sub,
      tenantId: claims.tenantId,
      role: claims.role ?? 'user',
      method: 'token',
    };
  },
};

export const agentTokenStrategy: AuthStrategy = {
  name: 'agent',
  applies: (req) => Boolean(getHeader(req, AGENT_TOKEN_HEADER)),
  async authenticate(req) {
    const token = getHeader(req, AGENT_TOKEN_HEADER)!;
    const claims = verifyAgentToken(token);
    req.agentToken = token;
    req.agentTokenClaims = claims;
    return {
      id: claims.agentId,
      tenantId: claims.tenantId ?? 'default',
      role: 'agent',
      method: 'agent',
    };
  },
};

export function requireAgentScope(...requiredScopes: string[]): RequestHandler {
  return (req, _res, next) => {
    const claims = req.agentTokenClaims;
    if (!claims || req.user?.method !== 'agent') {
      next(new AppError(401, 'Agent token required', 'AGENT_TOKEN_REQUIRED'));
      return;
    }
    const missing = requiredScopes.filter((scope) => !claims.scope.includes(scope));
    if (missing.length > 0) {
      next(new AppError(403, `Agent token is missing required scopes: ${missing.join(', ')}`, 'AGENT_SCOPE_FORBIDDEN'));
      return;
    }
    next();
  };
}

/** `x-api-key` header, resolved against the API key registry. */
export const apiKeyStrategy: AuthStrategy = {
  name: 'apiKey',
  applies: (req) => Boolean(getHeader(req, 'x-api-key')),
  async authenticate(req) {
    const key = getHeader(req, 'x-api-key')!;
    // Renamed from lookupApiKeyRecord in #979; the stale import made this strategy throw.
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

export const DEFAULT_AUTH_STRATEGIES: AuthStrategy[] = [
  sessionStrategy,
  hmacStrategy,
  tokenStrategy,
  agentTokenStrategy,
  apiKeyStrategy,
];

/**
 * Build an auth middleware from a list of strategies. Every strategy whose
 * credential is present on the request is tried, in order; the first one to
 * successfully authenticate wins and its principal is attached as
 * `req.user`. If none of the applicable strategies succeed, the last
 * failure is forwarded to the error handler; if no strategy's credential is
 * present at all, responds 401 "Authentication required".
 *
 * After a successful authentication the principal's workspace scopes are
 * loaded once and attached as `req.workspaceScopes`, so downstream RBAC
 * checks (`middleware/rbac.ts`) do not each repeat the membership lookup.
 */
export function createAuthMiddleware(
  strategies: AuthStrategy[] = DEFAULT_AUTH_STRATEGIES,
  options: AuthMiddlewareOptions = {},
): RequestHandler {
  const loadScopes = options.loadWorkspaceScopes ?? defaultWorkspaceScopeLoader;
  return async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Never let scopes from an earlier middleware run (or a spoofed object) leak in.
    req.workspaceScopes = undefined;
    const hasAgentToken = Boolean(getHeader(req, AGENT_TOKEN_HEADER));
    const applicable = hasAgentToken
      ? strategies.filter((s) => s.name === 'agent' && s.applies(req))
      : strategies.filter((s) => s.name !== 'agent' && s.applies(req));
    if (applicable.length === 0) {
      next(new AppError(401, 'Authentication required', 'AUTH_REQUIRED'));
      return;
    }

    for (let i = 0; i < applicable.length; i++) {
      try {
        const principal = await applicable[i].authenticate(req, res);
        req.user = principal;
        mergeLogContext({ tenantId: principal.tenantId });
        if (loadScopes) await prefetchWorkspaceScopes(req, principal, loadScopes);
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
