/**
 * Integration coverage for the shared ceremony actions. These drive the same
 * core functions used by both server actions and route handlers against real
 * in-memory stores and a virtual authenticator, so the typed result contract,
 * the bootstrap rule and the audit events are pinned in one place.
 */
import { describe, expect, it } from 'vitest';
import { OPERATOR_COOKIE, STEP_UP_COOKIE } from '@/app/admin/guard';
import { VirtualAuthenticator } from '@/test/virtual-authenticator';
import {
  createInMemoryChallengeStore,
  createInMemoryCredentialStore,
  createInMemoryOperatorSessionStore,
  createInMemoryStepUpSessionStore,
  createSecurityEvents,
  createWebAuthnService,
  type PortalWebAuthnConfig,
  type SecurityEvent,
} from '@/lib/webauthn';
import { contextFromHeaders, contextFromRequest, type ActionContext } from './context';
import {
  beginEnroll,
  beginStepUp,
  completeEnroll,
  completeStepUp,
  type CeremonyDeps,
  type StepUpCookieValue,
} from './core';
import { createStepUpCookieSink, actionResponse } from './http';
import { actionFail, actionOk } from './result';

const RP_ID = 'portal.agenticpay.dev';
const ORIGIN = 'https://portal.agenticpay.dev';

const config: PortalWebAuthnConfig = {
  rpID: RP_ID,
  rpName: 'AgenticPay Developer Portal',
  origin: ORIGIN,
  challengeTtlMs: 60_000,
  stepUpTtlMs: 300_000,
  userVerification: 'required',
};

type LoggedEvent = SecurityEvent & { event: SecurityEvent['name'] };

function testClock(start = 1_700_000_000_000) {
  let current = start;
  return { now: () => current, advance: (ms: number) => (current += ms) };
}

function createHarness() {
  const clock = testClock();
  const logged: LoggedEvent[] = [];
  const events = createSecurityEvents({
    write: (line) => {
      const parsed = JSON.parse(line) as LoggedEvent;
      logged.push({ ...parsed, name: parsed.event });
    },
  });
  const credentials = createInMemoryCredentialStore();
  const challenges = createInMemoryChallengeStore({ clock });
  const operatorSessions = createInMemoryOperatorSessionStore({ clock });
  const stepUpSessions = createInMemoryStepUpSessionStore({ clock, ttlMs: config.stepUpTtlMs });
  const service = createWebAuthnService({
    config,
    credentials,
    challenges,
    stepUpSessions,
    events,
    clock,
  });
  const deps: CeremonyDeps = { operatorSessions, stepUpSessions, events, service, clock };
  return { clock, logged, credentials, operatorSessions, stepUpSessions, service, deps };
}

function context(
  operatorToken: string | null = null,
  stepUpToken: string | null = null,
  correlation: ActionContext['correlation'] = {},
): ActionContext {
  return { operatorToken, stepUpToken, correlation };
}

async function enrollFirst(harness: ReturnType<typeof createHarness>) {
  const operator = await harness.deps.operatorSessions.issue('op-1');
  const started = await beginEnroll(context(operator.sessionId), harness.deps);
  if (!started.ok) throw new Error(`beginEnroll failed: ${started.error}`);

  const authenticator = new VirtualAuthenticator();
  const saved = await completeEnroll(
    authenticator.registrationResponse(RP_ID, ORIGIN, started.data.challenge),
    context(operator.sessionId),
    harness.deps,
  );
  if (!saved.ok) throw new Error(`completeEnroll failed: ${saved.error}`);
  return { token: operator.sessionId, authenticator, options: started.data };
}

async function stepUp(harness: ReturnType<typeof createHarness>, token: string, authenticator: VirtualAuthenticator, counter: number) {
  const started = await beginStepUp(context(token), harness.deps);
  if (!started.ok) throw new Error(`beginStepUp failed: ${started.error}`);

  const assertion = authenticator.authenticationResponse(RP_ID, ORIGIN, started.data.challenge, { counter });
  const cookies: StepUpCookieValue[] = [];
  const result = await completeStepUp(assertion, context(token), harness.deps, (value) => {
    cookies.push(value);
  });
  return { result, cookies };
}

describe('action context', () => {
  it('reads both session cookies and the request correlation from a header source', () => {
    const headers = new Headers({
      cookie: `${OPERATOR_COOKIE}=operator-1; ${STEP_UP_COOKIE}=stepup-1`,
      'x-trace-id': 'trace-1',
      'x-request-id': 'request-1',
    });
    expect(contextFromHeaders(headers)).toEqual({
      operatorToken: 'operator-1',
      stepUpToken: 'stepup-1',
      correlation: { traceId: 'trace-1', requestId: 'request-1' },
    });

    const request = new Request(`${ORIGIN}/admin/api/step-up/options`, { headers });
    expect(contextFromRequest(request)).toEqual(contextFromHeaders(request.headers));
  });
});

describe('step-up actions', () => {
  it('denies anonymous callers and reports NO_CREDENTIALS for an operator without a passkey', async () => {
    const harness = createHarness();

    const anonymous = await beginStepUp(context(), harness.deps);
    expect(anonymous).toMatchObject({ ok: false, error: 'ADMIN_AUTH_REQUIRED' });
    expect(harness.logged.at(-1)).toMatchObject({ event: 'admin.access_denied', reason: 'no-operator-session' });

    const operator = await harness.deps.operatorSessions.issue('op-empty');
    const result = await beginStepUp(context(operator.sessionId), harness.deps);
    expect(result).toMatchObject({ ok: false, error: 'NO_CREDENTIALS' });
  });

  it('verifies an assertion, sets the cookie only after success, and rejects a replay', async () => {
    const harness = createHarness();
    const { token, authenticator } = await enrollFirst(harness);

    const cookies: StepUpCookieValue[] = [];
    const invalid = await completeStepUp({ id: 'broken' }, context(token), harness.deps, (value) => {
      cookies.push(value);
    });
    expect(invalid).toMatchObject({ ok: false, error: 'INVALID_INPUT' });
    expect(cookies).toHaveLength(0);
    expect(harness.logged.at(-1)).toMatchObject({
      name: 'webauthn.authentication_failed',
      reason: 'INVALID_INPUT',
      operatorId: 'op-1',
    });

    const first = await stepUp(harness, token, authenticator, 1);
    expect(first.result.ok).toBe(true);
    expect(first.cookies).toHaveLength(1);
    expect(first.cookies[0].expiresAt).toBe(harness.clock.now() + config.stepUpTtlMs);

    const replayed = await stepUp(harness, token, authenticator, 1);
    expect(replayed.result).toMatchObject({ ok: false, error: 'COUNTER_REPLAYED' });
    expect(replayed.cookies).toHaveLength(0);
  });
});

describe('enrolment actions', () => {
  it('bootstraps the first passkey on the base session alone', async () => {
    const harness = createHarness();
    const { token, options } = await enrollFirst(harness);
    expect(options.bootstrap).toBe(true);
    expect(options.rp.id).toBe(RP_ID);
    expect(await harness.deps.service.listCredentials('op-1')).toHaveLength(1);
    expect(harness.logged.at(-1)).toMatchObject({ name: 'webauthn.registration_completed', operatorId: 'op-1' });

    const tokenOnly = await beginEnroll(context(token), harness.deps);
    expect(tokenOnly).toMatchObject({ ok: false, error: 'STEP_UP_REQUIRED' });
  });

  it('allows another passkey once a fresh step-up is presented', async () => {
    const harness = createHarness();
    const { token, authenticator } = await enrollFirst(harness);
    const steppedUp = await stepUp(harness, token, authenticator, 1);
    if (!steppedUp.result.ok) throw new Error('step-up failed');
    const stepUpToken = steppedUp.cookies[0].token;

    const started = await beginEnroll(context(token, stepUpToken), harness.deps);
    expect(started).toMatchObject({ ok: true, data: { bootstrap: false } });
    if (!started.ok) return;

    const second = new VirtualAuthenticator();
    const saved = await completeEnroll(
      second.registrationResponse(RP_ID, ORIGIN, started.data.challenge),
      context(token, stepUpToken),
      harness.deps,
    );
    expect(saved).toMatchObject({ ok: true, data: { credentialId: second.credentialIdBase64Url } });
    expect(await harness.deps.service.listCredentials('op-1')).toHaveLength(2);
  });

  it('rejects a malformed attestation without calling the verifier', async () => {
    const harness = createHarness();
    const operator = await harness.deps.operatorSessions.issue('op-malformed');
    const result = await completeEnroll({ id: 'x' }, context(operator.sessionId), harness.deps);
    expect(result).toMatchObject({ ok: false, error: 'INVALID_INPUT' });
    expect(harness.logged.at(-1)).toMatchObject({
      name: 'webauthn.registration_failed',
      reason: 'INVALID_INPUT',
    });
  });
});

describe('HTTP adapter', () => {
  it('maps every action error family to a stable status', () => {
    expect(actionResponse(actionOk({ ok: true }), 201).status).toBe(201);
    expect(actionResponse(actionFail('ADMIN_AUTH_REQUIRED', 'no')).status).toBe(401);
    expect(actionResponse(actionFail('STEP_UP_REQUIRED', 'no')).status).toBe(403);
    expect(actionResponse(actionFail('INVALID_INPUT', 'no')).status).toBe(400);
    expect(actionResponse(actionFail('VERIFICATION_FAILED', 'no')).status).toBe(401);
    expect(actionResponse(actionFail('NO_CREDENTIALS', 'no')).status).toBe(400);
    expect(actionResponse(actionFail('INTERNAL_ERROR', 'no')).status).toBe(500);
  });

  it('serialises the step-up cookie with the admin path and http-only flag', async () => {
    const { setCookie, cookies } = createStepUpCookieSink();
    await setCookie({ token: 'session-1', expiresAt: Date.now() + 60_000 });
    expect(cookies()).toHaveLength(1);
    expect(cookies()[0]).toContain(`${STEP_UP_COOKIE}=session-1`);
    expect(cookies()[0]).toContain('Path=/admin');
    expect(cookies()[0]).toContain('HttpOnly');
  });
});
