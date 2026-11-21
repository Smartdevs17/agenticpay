/**
 * middleware/cors.ts — CORS middleware backed by a dynamic origin whitelist.
 *
 * Resolves every request against the shared `CORSOriginPolicy` in
 * `services/cors.js`, so allowlist changes made at runtime (via the
 * management router, `addAllowedOrigin()`/`removeAllowedOrigin()`, or an
 * async loader refresh) take effect on the very next request — no redeploy.
 *
 * ## Behaviour
 *
 *   - No `Origin` header → passes through, sets `Vary: Origin`.
 *   - Allowed origin   → reflects the concrete origin (or `*` when the
 *     allowlist is open and credentials are disabled), sets `Vary: Origin`.
 *   - Denied origin    → passes through WITHOUT any `Access-Control-*`
 *     header, so the browser blocks the response.
 *   - Preflight        → `OPTIONS` + `Access-Control-Request-Method` is
 *     answered with `204` and the negotiated headers, or handed to the app
 *     when `preflightContinue` is set.
 *   - Credentials      → never combined with a bare `Access-Control-Allow-
 *     Origin: *`; in open mode the concrete origin is always reflected so
 *     credentialed requests keep working.
 *   - Error statuses   → the headers are attached regardless of downstream
 *     status (CORS is transport, not content, policy).
 *
 * ## Usage
 *
 * ```ts
 * import { createCorsMiddleware } from '../middleware/cors.js';
 * import { getCorsPolicy } from '../services/cors.js';
 *
 * getCorsPolicy().set(['https://app.example.com', 'https://*.internal.example.com']);
 *
 * app.use(createCorsMiddleware({
 *   credentials: true,
 *   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
 *   allowedHeaders: ['Content-Type', 'Authorization'],
 * }));
 * ```
 */

import { NextFunction, Request, Response, RequestHandler } from 'express';
import {
  getCorsPolicy,
  recordPreflight,
} from '../services/cors.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CorsMiddlewareOptions {
  /** Seed the shared policy with these origins/patterns (at mount time). */
  allowedOrigins?: string[];
  /** Reflect `Access-Control-Allow-Credentials`. Overrides policy default. */
  credentials?: boolean;
  /** Methods admitted in preflight `Access-Control-Allow-Methods`. */
  methods?: string[];
  /** Whitelist for `Access-Control-Request-Headers`; undefined = echo all. */
  allowedHeaders?: string[];
  /** Headers browser scripts may read (`Access-Control-Expose-Headers`). */
  exposedHeaders?: string[];
  /** Cached preflight validity for `Access-Control-Max-Age` (seconds). */
  maxAge?: number;
  /** Status for answered preflights (default: 204). */
  optionsSuccessStatus?: number;
  /** Hand preflights to the app instead of answering them (default: false). */
  preflightContinue?: boolean;
}

export const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export const DEFAULT_ALLOWED_HEADERS = ['Content-Type', 'Authorization'];

// Header names. Node lowercases incoming header keys on `req.headers`, so
// request lookups use lowercase constants while response setters use the
// canonical title-cased spelling.
const IN = {
  origin: 'origin',
  requestMethod: 'access-control-request-method',
  requestHeaders: 'access-control-request-headers',
  requestPrivateNetwork: 'access-control-request-private-network',
};

const A = {
  allowOrigin: 'Access-Control-Allow-Origin',
  allowCredentials: 'Access-Control-Allow-Credentials',
  allowMethods: 'Access-Control-Allow-Methods',
  allowHeaders: 'Access-Control-Allow-Headers',
  allowPrivateNetwork: 'Access-Control-Allow-Private-Network',
  exposeHeaders: 'Access-Control-Expose-Headers',
  maxAge: 'Access-Control-Max-Age',
};

// ─── Header helpers ───────────────────────────────────────────────────────────

function setHeader(res: Response, name: string, value: string): void {
  res.setHeader(name, value);
}

/** Append a field to `Vary` without clobbering existing values. */
function appendVary(res: Response, field: string): void {
  const existing = res.getHeader('Vary');
  let next: string;
  if (existing === undefined) {
    next = field;
  } else if (Array.isArray(existing)) {
    next = existing.concat(field).join(', ');
  } else {
    next = `${String(existing)}, ${field}`;
  }
  res.setHeader('Vary', next);
}

function firstHeader(value: unknown): string | undefined {
  if (Array.isArray(value)) return value[0] as string | undefined;
  if (typeof value === 'string') return value;
  return undefined;
}

/** The request's first `Origin` value, trimmed of surrounding whitespace. */
function parseRequestOrigin(req: Request): string | undefined {
  const raw = firstHeader(req.headers[IN.origin]);
  if (!raw) return undefined;
  const [origin] = raw.split(/\s+/);
  return origin?.trim() || undefined;
}

function parseRequestHeaders(value: unknown): string[] {
  const raw = firstHeader(value);
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const header = part.trim();
    if (header && !seen.has(header.toLowerCase())) {
      seen.add(header.toLowerCase());
      out.push(header);
    }
  }
  return out;
}

function isPreflight(req: Request): boolean {
  return req.method === 'OPTIONS' && Boolean(req.headers[IN.requestMethod]);
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function createCorsMiddleware(options: CorsMiddlewareOptions = {}): RequestHandler {
  const credentials = options.credentials ?? getCorsPolicy().credentials;
  const methods = new Set((options.methods ?? DEFAULT_METHODS).map((m) => m.toUpperCase().trim()));
  const configuredHeaders = options.allowedHeaders
    ? new Set(options.allowedHeaders.map((h) => h.toLowerCase().trim()))
    : undefined;
  const exposedHeaders = options.exposedHeaders ?? [];
  const optionsSuccessStatus = options.optionsSuccessStatus ?? 204;
  const preflightContinue = options.preflightContinue ?? false;
  const maxAge = options.maxAge;

  if (options.allowedOrigins) {
    getCorsPolicy().set(options.allowedOrigins);
  }

  function allowOriginFor(origin: string, policyOpen: boolean): string {
    // Open mode + credentials must reflect the concrete origin — a bare `*`
    // with `Access-Control-Allow-Credentials` is rejected by browsers.
    if (policyOpen && !credentials) return '*';
    return origin;
  }

  return function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
    const policy = getCorsPolicy();
    const requestOrigin = parseRequestOrigin(req);

    if (!requestOrigin) {
      appendVary(res, 'Origin');
      next();
      return;
    }

    const allowed = policy.isAllowed(requestOrigin);

    if (isPreflight(req)) {
      recordPreflight(allowed);
      appendVary(res, 'Origin');
      appendVary(res, 'Access-Control-Request-Method');
      appendVary(res, 'Access-Control-Request-Headers');

      if (allowed) {
        setHeader(res, A.allowOrigin, allowOriginFor(requestOrigin, policy.wildcard));

        if (credentials) {
          setHeader(res, A.allowCredentials, 'true');
        }

        const requestedMethod = String(req.headers[IN.requestMethod]).toUpperCase().trim();
        if (requestedMethod && methods.has(requestedMethod)) {
          setHeader(res, A.allowMethods, requestedMethod);
        }

        const requestedHeaders = parseRequestHeaders(req.headers[IN.requestHeaders]);
        const finalHeaders = configuredHeaders
          ? requestedHeaders.filter((h) => configuredHeaders.has(h.toLowerCase()))
          : requestedHeaders;
        if (finalHeaders.length > 0) {
          setHeader(res, A.allowHeaders, finalHeaders.join(', '));
        }

        if (req.headers[IN.requestPrivateNetwork] === 'true') {
          setHeader(res, A.allowPrivateNetwork, 'true');
        }

        if (typeof maxAge === 'number') {
          setHeader(res, A.maxAge, String(maxAge));
        }
      }

      if (preflightContinue) {
        next();
        return;
      }
      res.status(optionsSuccessStatus).end();
      return;
    }

    appendVary(res, 'Origin');

    if (allowed) {
      setHeader(res, A.allowOrigin, allowOriginFor(requestOrigin, policy.wildcard));
      if (credentials) {
        setHeader(res, A.allowCredentials, 'true');
      }
      if (exposedHeaders.length > 0) {
        setHeader(res, A.exposeHeaders, exposedHeaders.join(', '));
      }
    }

    next();
  };
}

/** Descriptive alias matching the `cors` package import name. */
export const cors = createCorsMiddleware;