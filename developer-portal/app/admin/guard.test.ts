import { afterEach, describe, expect, it } from 'vitest';
import {
  OPERATOR_COOKIE,
  STEP_UP_COOKIE,
  evaluateAdminAccess,
  evaluateAdminHeaders,
  evaluateAdminRequest,
  jsonResponse,
  readCookie,
  requestCorrelation,
  requireAdminApi,
  requireOperator,
  resolveOperatorId,
  serializeCookie,
  type AdminGuardDeps,
} from './guard';
import {
  createInMemoryOperatorSessionStore,
  createInMemoryStepUpSessionStore,
  createSecurityEvents,
  type SecurityEvent,
} from '@/lib/webauthn';

const NOW = 1_700_000_000_000;

function testClock(start = NOW) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function createDeps(overrides: Partial<AdminGuardDeps> = {}) {
  const clock = overrides.clock ?? testClock();
  const events: SecurityEvent[] = [];
  return {
    clock,
    events,
    deps: {
      operatorSessions: createInMemoryOperatorSessionStore({ clock }),
      stepUpSessions: createInMemoryStepUpSessionStore({ clock }),
      events: createSecurityEvents({ write: (line) => events.push(JSON.parse(line) as SecurityEvent) }),
      clock,
      ...overrides,
    } satisfies AdminGuardDeps,
  };
}

function cookieHeader(cookies: Record<string, string>): Headers {
  const header = Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
  return new Headers({ cookie: header });
}

function request(cookies: Record<string, string> = {}, headers: Record<string, string> = {}): Request {
  const all = new Headers(headers);
  if (Object.keys(cookies).length > 0) all.set('cookie', cookieHeader(cookies).get('cookie')!);
  return new Request('https://portal.agenticpay.dev/admin', { method: 'POST', headers: all });
}

describe('readCookie', () => {
  it('returns null when there is no cookie header', () => {
    expect(readCookie(new Headers(), OPERATOR_COOKIE)).toBeNull();
  });

  it('selects the requested cookie by exact name and decodes it', () => {
    const headers = new Headers({ cookie: 'a=1; dp.operator=op%3A42; dp.stepup=xyz' });
    expect(readCookie(headers, OPERATOR_COOKIE)).toBe('op:42');
    expect(readCookie(headers, STEP_UP_COOKIE)).toBe('xyz');
  });

  it('does not match a cookie whose name merely contains the target', () => {
    expect(readCookie(new Headers({ cookie: 'dp.operator.extra=nope' }), OPERATOR_COOKIE)).toBeNull();
  });

  it('ignores malformed parts and empty values', () => {
    expect(readCookie(new Headers({ cookie: 'flag; dp.operator=' }), OPERATOR_COOKIE)).toBeNull();
    expect(readCookie(new Headers({ cookie: 'dp.operator' }), OPERATOR_COOKIE)).toBeNull();
  });
});

describe('serializeCookie', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('sets the path, max-age, same-site and http-only attributes', () => {
    expect(serializeCookie(STEP_UP_COOKIE, 'session-1', { maxAgeSeconds: 120, path: '/admin', sameSite: 'Strict' })).toBe(
      'dp.stepup=session-1; Path=/admin; Max-Age=120; SameSite=Strict; HttpOnly',
    );
  });

  it('clamps a negative max-age to zero and floors fractions', () => {
    expect(serializeCookie('c', 'v', { maxAgeSeconds: -5, path: '/', sameSite: 'Lax' })).toContain('Max-Age=0;');
    expect(serializeCookie('c', 'v', { maxAgeSeconds: 1.9, path: '/', sameSite: 'Lax' })).toContain('Max-Age=1;');
  });

  it('adds Secure only in production', () => {
    expect(serializeCookie('c', 'v', { maxAgeSeconds: 1, path: '/', sameSite: 'Lax' })).not.toContain('Secure');
    process.env.NODE_ENV = 'production';
    expect(serializeCookie('c', 'v', { maxAgeSeconds: 1, path: '/', sameSite: 'Lax' })).toContain('Secure');
  });
});

describe('requestCorrelation', () => {
  it('carries the trace and request ids when present', () => {
    expect(requestCorrelation(new Headers({ 'x-trace-id': 't1', 'x-request-id': 'r1' }))).toEqual({ traceId: 't1', requestId: 'r1' });
  });

  it('omits them when absent', () => {
    expect(requestCorrelation(new Headers())).toEqual({});
  });
});

describe('jsonResponse', () => {
  it('serialises the body and marks the response uncacheable', async () => {
    const response = jsonResponse(403, { error: 'X' }, ['dp.stepup=; Max-Age=0']);
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBe('dp.stepup=; Max-Age=0');
    expect(await response.json()).toEqual({ error: 'X' });
  });
});

describe('evaluateAdminAccess', () => {
  it('grants access and emits a correlated success event for a live operator + step-up pair', async () => {
    const { deps, events } = createDeps();
    const operator = await deps.operatorSessions.issue('op-1');
    const stepUp = await deps.stepUpSessions.issue({ operatorId: 'op-1', credentialId: 'cred-1' });

    const result = await evaluateAdminAccess(
      { operatorToken: operator.sessionId, stepUpToken: stepUp.sessionId, correlation: { traceId: 't1' } },
      deps,
    );

    expect(result).toMatchObject({ kind: 'granted', operatorId: 'op-1' });
    expect(events).toEqual([
      { level: 'info', service: 'agenticpay-developer-portal', event: 'admin.access_granted', outcome: 'success', operatorId: 'op-1', traceId: 't1' },
    ]);
  });

  it('treats a missing or unknown operator token as unauthenticated', async () => {
    const { deps, events } = createDeps();
    expect(await evaluateAdminAccess({ operatorToken: null, stepUpToken: null }, deps)).toEqual({ kind: 'unauthenticated' });
    expect(await evaluateAdminAccess({ operatorToken: 'ghost', stepUpToken: null }, deps)).toEqual({ kind: 'unauthenticated' });
    expect(events.map((event) => event.reason)).toEqual(['no-operator-session', 'no-operator-session']);
  });

  it('asks for a step-up when the base session is valid but no step-up is presented', async () => {
    const { deps, events } = createDeps();
    const operator = await deps.operatorSessions.issue('op-1');

    expect(await evaluateAdminAccess({ operatorToken: operator.sessionId, stepUpToken: null }, deps)).toEqual({
      kind: 'step-up-required',
      operatorId: 'op-1',
    });
    expect(events.at(-1)).toMatchObject({ event: 'admin.access_denied', outcome: 'failure', reason: 'no-step-up-session', operatorId: 'op-1' });
  });

  it('asks for a step-up when the step-up session has expired but the base session is still live', async () => {
    const { deps, events } = createDeps();
    const operator = await deps.operatorSessions.issue('op-1');
    const stepUp = await deps.stepUpSessions.issue({ operatorId: 'op-1', credentialId: 'cred-1' });
    // Outlive the 5-minute step-up, stay inside the 12-hour operator session.
    (deps.clock as { advance(ms: number): void }).advance(6 * 60 * 1000);

    expect(await evaluateAdminAccess({ operatorToken: operator.sessionId, stepUpToken: stepUp.sessionId }, deps)).toEqual({
      kind: 'step-up-required',
      operatorId: 'op-1',
    });
    expect(events.at(-1)).toMatchObject({ event: 'admin.access_denied', reason: 'no-step-up-session' });
  });

  it('asks for a step-up when the step-up belongs to another operator', async () => {
    const { deps, events } = createDeps();
    const operator = await deps.operatorSessions.issue('op-1');
    const foreign = await deps.stepUpSessions.issue({ operatorId: 'op-2', credentialId: 'cred-2' });

    expect(await evaluateAdminAccess({ operatorToken: operator.sessionId, stepUpToken: foreign.sessionId }, deps)).toEqual({
      kind: 'step-up-required',
      operatorId: 'op-1',
    });
    expect(events.at(-1)).toMatchObject({ event: 'admin.access_denied', reason: 'step-up-operator-mismatch' });
  });
});

describe('evaluateAdminHeaders', () => {
  it('reads both cookies straight off a header source', async () => {
    const { deps } = createDeps();
    const operator = await deps.operatorSessions.issue('op-1');
    const stepUp = await deps.stepUpSessions.issue({ operatorId: 'op-1', credentialId: 'cred-1' });

    const result = await evaluateAdminHeaders(
      cookieHeader({ [OPERATOR_COOKIE]: operator.sessionId, [STEP_UP_COOKIE]: stepUp.sessionId }),
      deps,
    );
    expect(result).toMatchObject({ kind: 'granted', operatorId: 'op-1' });
  });

  it('is equivalent to evaluateAdminRequest for the same request', async () => {
    const { deps } = createDeps();
    const operator = await deps.operatorSessions.issue('op-1');
    const req = request({ [OPERATOR_COOKIE]: operator.sessionId });

    expect(await evaluateAdminRequest(req, deps)).toEqual({ kind: 'step-up-required', operatorId: 'op-1' });
  });
});

describe('resolveOperatorId', () => {
  it('returns the operator id for a live base session and null otherwise', async () => {
    const { deps } = createDeps();
    const operator = await deps.operatorSessions.issue('op-1');
    expect(await resolveOperatorId(request({ [OPERATOR_COOKIE]: operator.sessionId }), deps)).toBe('op-1');
    expect(await resolveOperatorId(request(), deps)).toBeNull();
    expect(await resolveOperatorId(request({ [OPERATOR_COOKIE]: 'ghost' }), deps)).toBeNull();
  });
});

describe('requireAdminApi', () => {
  it('returns a ready 401 when there is no base session', async () => {
    const { deps } = createDeps();
    const result = await requireAdminApi(request(), deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toMatchObject({ error: 'ADMIN_AUTH_REQUIRED' });
  });

  it('returns a ready 403 when the step-up is missing', async () => {
    const { deps } = createDeps();
    const operator = await deps.operatorSessions.issue('op-1');
    const result = await requireAdminApi(request({ [OPERATOR_COOKIE]: operator.sessionId }), deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toMatchObject({ error: 'STEP_UP_REQUIRED' });
  });

  it('grants when both sessions are live', async () => {
    const { deps } = createDeps();
    const operator = await deps.operatorSessions.issue('op-1');
    const stepUp = await deps.stepUpSessions.issue({ operatorId: 'op-1', credentialId: 'cred-1' });
    const result = await requireAdminApi(
      request({ [OPERATOR_COOKIE]: operator.sessionId, [STEP_UP_COOKIE]: stepUp.sessionId }),
      deps,
    );
    expect(result).toMatchObject({ ok: true, operatorId: 'op-1' });
  });
});

describe('requireOperator', () => {
  it('grants on the base session alone', async () => {
    const { deps } = createDeps();
    const operator = await deps.operatorSessions.issue('op-1');
    expect(await requireOperator(request({ [OPERATOR_COOKIE]: operator.sessionId }), deps)).toMatchObject({ ok: true, operatorId: 'op-1' });
  });

  it('returns a 401 and emits a denial when there is no session', async () => {
    const { deps, events } = createDeps();
    const result = await requireOperator(request({}, { 'x-request-id': 'r1' }), deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toMatchObject({ error: 'ADMIN_AUTH_REQUIRED' });
    expect(events.at(-1)).toMatchObject({ event: 'admin.access_denied', reason: 'no-operator-session', requestId: 'r1' });
  });
});
