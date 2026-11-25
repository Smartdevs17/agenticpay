/**
 * The admin gate. Every admin page and admin API route funnels through here.
 *
 * The gate is deliberately two-layered: a valid base operator session (proof the
 * caller signed in) *and* an unexpired step-up session (proof they asserted a
 * passkey recently). See `lib/webauthn.ts` for why the second layer exists.
 *
 * Cookie parsing/serialisation and the JSON responses are plain Web APIs so the
 * whole gate can be exercised in a unit test without a Next.js runtime.
 */
import {
  decideAdminAccess,
  type Clock,
  type OperatorSessionStore,
  type SecurityEventContext,
  type SecurityEvents,
  type StepUpSession,
  type StepUpSessionStore,
} from '@/lib/webauthn';

/** Base operator session cookie, issued by the portal sign-in (out of scope here). */
export const OPERATOR_COOKIE = 'dp.operator';
/** Short-lived step-up session cookie, set by the step-up ceremony. */
export const STEP_UP_COOKIE = 'dp.stepup';

export const OPERATOR_COOKIE_PATH = '/';
export const STEP_UP_COOKIE_PATH = '/admin';

export interface AdminGuardDeps {
  operatorSessions: OperatorSessionStore;
  stepUpSessions: StepUpSessionStore;
  events: SecurityEvents;
  clock?: Clock;
}

const systemClock: Clock = { now: () => Date.now() };

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * The read-only header surface the gate needs. A `Request.headers` and the
 * `headers()` value a Next.js server component receives both satisfy it, so the
 * gate is implemented once for route handlers and pages alike.
 */
export interface HeaderSource {
  get(name: string): string | null;
}

export interface CookieOptions {
  maxAgeSeconds: number;
  path: string;
  sameSite: 'Strict' | 'Lax';
}

export function readCookie(headers: HeaderSource, name: string): string | null {
  const header = headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value ? decodeURIComponent(value) : null;
  }
  return null;
}

/**
 * Serialise a `Set-Cookie` value. `Secure` is added outside development so the
 * session never travels in clear text; `HttpOnly` keeps it away from scripts.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    `SameSite=${options.sameSite}`,
    'HttpOnly',
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

export function requestCorrelation(headers: HeaderSource): SecurityEventContext {
  const traceId = headers.get('x-trace-id');
  const requestId = headers.get('x-request-id');
  return {
    ...(traceId ? { traceId } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

export function jsonResponse(status: number, body: unknown, cookies: string[] = []): Response {
  const headers = new Headers({
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

// ---------------------------------------------------------------------------
// Access evaluation
// ---------------------------------------------------------------------------

export type AdminGateResult =
  | { kind: 'granted'; operatorId: string; stepUp: StepUpSession }
  | { kind: 'step-up-required'; operatorId: string }
  | { kind: 'unauthenticated' };

export interface AdminAccessInput {
  operatorToken: string | null;
  stepUpToken: string | null;
  correlation?: SecurityEventContext;
}

/**
 * Resolve both session cookies and decide. Emits `admin.access_granted` or
 * `admin.access_denied` (with the denial reason and request correlation) so the
 * gate is visible in logs and counters.
 */
export async function evaluateAdminAccess(
  input: AdminAccessInput,
  deps: AdminGuardDeps,
): Promise<AdminGateResult> {
  const now = (deps.clock ?? systemClock).now();
  const [operatorSession, stepUpSession] = await Promise.all([
    input.operatorToken ? deps.operatorSessions.find(input.operatorToken) : Promise.resolve(null),
    input.stepUpToken ? deps.stepUpSessions.find(input.stepUpToken) : Promise.resolve(null),
  ]);

  const decision = decideAdminAccess({ operatorSession, stepUpSession, now });
  if (decision.allow) {
    deps.events.emit({
      name: 'admin.access_granted',
      outcome: 'success',
      operatorId: decision.operatorId,
      ...(input.correlation ?? {}),
    });
    return { kind: 'granted', operatorId: decision.operatorId, stepUp: decision.stepUp };
  }

  deps.events.emit({
    name: 'admin.access_denied',
    outcome: 'failure',
    ...(operatorSession ? { operatorId: operatorSession.operatorId } : {}),
    reason: decision.reason,
    ...(input.correlation ?? {}),
  });
  if (decision.reason === 'no-operator-session') return { kind: 'unauthenticated' };
  return { kind: 'step-up-required', operatorId: operatorSession!.operatorId };
}

/**
 * The header-level gate, shared by route handlers and server components.
 * `Request.headers` and the `headers()` value a page receives both work here.
 */
export function evaluateAdminHeaders(
  headers: HeaderSource,
  deps: AdminGuardDeps,
): Promise<AdminGateResult> {
  return evaluateAdminAccess(
    {
      operatorToken: readCookie(headers, OPERATOR_COOKIE),
      stepUpToken: readCookie(headers, STEP_UP_COOKIE),
      correlation: requestCorrelation(headers),
    },
    deps,
  );
}

export function evaluateAdminRequest(request: Request, deps: AdminGuardDeps): Promise<AdminGateResult> {
  return evaluateAdminHeaders(request.headers, deps);
}

/** Resolve the base operator identity without requiring a step-up. */
export async function resolveOperatorId(
  request: Request,
  deps: AdminGuardDeps,
): Promise<string | null> {
  const token = readCookie(request.headers, OPERATOR_COOKIE);
  if (!token) return null;
  const session = await deps.operatorSessions.find(token);
  return session?.operatorId ?? null;
}

// ---------------------------------------------------------------------------
// Route-handler guards
// ---------------------------------------------------------------------------

export type AdminApiGrant = { ok: true; operatorId: string; stepUp: StepUpSession };
export type AdminApiDenial = { ok: false; response: Response };

/** Require base session + fresh step-up. Returns a ready 401/403 on denial. */
export async function requireAdminApi(
  request: Request,
  deps: AdminGuardDeps,
): Promise<AdminApiGrant | AdminApiDenial> {
  const result = await evaluateAdminRequest(request, deps);
  if (result.kind === 'granted') {
    return { ok: true, operatorId: result.operatorId, stepUp: result.stepUp };
  }
  if (result.kind === 'unauthenticated') {
    return {
      ok: false,
      response: jsonResponse(401, {
        error: 'ADMIN_AUTH_REQUIRED',
        message: 'Sign in to the developer portal before using the admin area',
      }),
    };
  }
  return {
    ok: false,
    response: jsonResponse(403, {
      error: 'STEP_UP_REQUIRED',
      message: 'Complete a WebAuthn step-up before using the admin area',
    }),
  };
}

export type OperatorApiGrant = { ok: true; operatorId: string };
export type OperatorApiDenial = { ok: false; response: Response };

/** Require only the base session, for the ceremonies that establish step-up. */
export async function requireOperator(
  request: Request,
  deps: AdminGuardDeps,
): Promise<OperatorApiGrant | OperatorApiDenial> {
  const operatorId = await resolveOperatorId(request, deps);
  if (operatorId) return { ok: true, operatorId };
  deps.events.emit({
    name: 'admin.access_denied',
    outcome: 'failure',
    reason: 'no-operator-session',
    ...requestCorrelation(request.headers),
  });
  return {
    ok: false,
    response: jsonResponse(401, {
      error: 'ADMIN_AUTH_REQUIRED',
      message: 'Sign in to the developer portal before using the admin area',
    }),
  };
}
