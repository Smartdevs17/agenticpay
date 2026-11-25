/**
 * Integration coverage for the admin ceremony route handlers. These drive the
 * real handlers (guard + runtime + WebAuthn service) over real HTTP-shaped
 * requests, so the documented bootstrap rule and the step-up flow are pinned
 * end to end rather than per-unit.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { OPERATOR_COOKIE, STEP_UP_COOKIE } from '@/app/admin/guard';
import { getPortalRuntime } from '@/app/admin/runtime';
import { VirtualAuthenticator } from '@/test/virtual-authenticator';
import * as enrollOptions from './enroll/options/route';
import * as enrollVerify from './enroll/verify/route';
import * as stepUpOptions from './step-up/options/route';
import * as stepUpVerify from './step-up/verify/route';

const RP_ID = 'portal.agenticpay.dev';
const ORIGIN = 'https://portal.agenticpay.dev';

let stateDir: string;

beforeAll(async () => {
  // The runtime reads its configuration from the environment on first use.
  process.env.WEBAUTHN_RP_ID = RP_ID;
  process.env.WEBAUTHN_ORIGIN = ORIGIN;
  stateDir = await mkdtemp(join(tmpdir(), 'dp-admin-routes-'));
  process.env.WEBAUTHN_STATE_DIR = stateDir;
});

afterAll(async () => {
  await rm(stateDir, { recursive: true, force: true });
  delete process.env.WEBAUTHN_RP_ID;
  delete process.env.WEBAUTHN_ORIGIN;
  delete process.env.WEBAUTHN_STATE_DIR;
});

function post(path: string, cookies: Record<string, string> = {}, body?: unknown): Request {
  const headers = new Headers();
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
  if (cookie) headers.set('cookie', cookie);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Read a `Set-Cookie` value out of a response. */
function readSetCookie(response: Response, name: string): string | null {
  const header = response.headers.get('set-cookie');
  const match = header ? new RegExp(`${name}=([^;]+)`).exec(header) : null;
  return match ? decodeURIComponent(match[1]) : null;
}

async function issueOperator(operatorId: string): Promise<string> {
  const session = await getPortalRuntime().operatorSessions.issue(operatorId);
  return session.sessionId;
}

/** Register the operator's first passkey (bootstrap: base session only). */
async function enrollFirstPasskey(operatorId: string) {
  const token = await issueOperator(operatorId);
  const optionsResponse = await enrollOptions.POST(post('/admin/api/enroll/options', { [OPERATOR_COOKIE]: token }));
  const options = (await optionsResponse.json()) as PublicKeyCredentialCreationOptionsJSON & { bootstrap: boolean };
  const authenticator = new VirtualAuthenticator();
  const verifyResponse = await enrollVerify.POST(
    post('/admin/api/enroll/verify', { [OPERATOR_COOKIE]: token }, authenticator.registrationResponse(RP_ID, ORIGIN, options.challenge)),
  );
  return { token, authenticator, optionsResponse, options, verifyResponse };
}

/** Mint a step-up session cookie for an already-enrolled operator. */
async function stepUp(token: string, authenticator: VirtualAuthenticator, counter: number): Promise<{ response: Response; cookie: string | null }> {
  const optionsResponse = await stepUpOptions.POST(post('/admin/api/step-up/options', { [OPERATOR_COOKIE]: token }));
  const options = (await optionsResponse.json()) as PublicKeyCredentialRequestOptionsJSON;
  const assertion: AuthenticationResponseJSON = authenticator.authenticationResponse(RP_ID, ORIGIN, options.challenge, { counter });
  const response = await stepUpVerify.POST(post('/admin/api/step-up/verify', { [OPERATOR_COOKIE]: token }, assertion));
  return { response, cookie: readSetCookie(response, STEP_UP_COOKIE) };
}

describe('enrollment bootstrap rule', () => {
  it('refuses to start enrollment without the base operator session', async () => {
    const response = await enrollOptions.POST(post('/admin/api/enroll/options'));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'ADMIN_AUTH_REQUIRED' });
  });

  it('lets the first passkey bootstrap on the base session alone', async () => {
    const { optionsResponse, options, verifyResponse, authenticator } = await enrollFirstPasskey('op-bootstrap');

    expect(optionsResponse.status).toBe(200);
    expect(options.bootstrap).toBe(true);
    expect(options.rp.id).toBe(RP_ID);

    expect(verifyResponse.status).toBe(201);
    expect(await verifyResponse.json()).toMatchObject({ ok: true, credentialId: authenticator.credentialIdBase64Url });
    expect(await getPortalRuntime().service.listCredentials('op-bootstrap')).toHaveLength(1);
  });

  it('demands a fresh step-up before enrolling a second passkey', async () => {
    const { token, authenticator } = await enrollFirstPasskey('op-second');

    // A second enrollment on the base session alone is rejected...
    const blocked = await enrollOptions.POST(post('/admin/api/enroll/options', { [OPERATOR_COOKIE]: token }));
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: 'STEP_UP_REQUIRED' });
    expect(await getPortalRuntime().service.listCredentials('op-second')).toHaveLength(1);

    // ...but succeeds once the operator has stepped up.
    const { cookie } = await stepUp(token, authenticator, 1);
    expect(cookie).toBeTruthy();
    const allowed = await enrollOptions.POST(post('/admin/api/enroll/options', { [OPERATOR_COOKIE]: token, [STEP_UP_COOKIE]: cookie! }));
    expect(allowed.status).toBe(200);
    const options = (await allowed.json()) as PublicKeyCredentialCreationOptionsJSON & { bootstrap: boolean };
    expect(options.bootstrap).toBe(false);

    const second = new VirtualAuthenticator();
    const verify = await enrollVerify.POST(
      post(
        '/admin/api/enroll/verify',
        { [OPERATOR_COOKIE]: token, [STEP_UP_COOKIE]: cookie! },
        second.registrationResponse(RP_ID, ORIGIN, options.challenge),
      ),
    );
    expect(verify.status).toBe(201);
    expect(await getPortalRuntime().service.listCredentials('op-second')).toHaveLength(2);
  });
});

describe('step-up ceremony', () => {
  it('refuses to start step-up without the base operator session', async () => {
    const response = await stepUpOptions.POST(post('/admin/api/step-up/options'));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'ADMIN_AUTH_REQUIRED' });
  });

  it('reports an operator with no passkey as NO_CREDENTIALS', async () => {
    const token = await issueOperator('op-no-passkey');
    const response = await stepUpOptions.POST(post('/admin/api/step-up/options', { [OPERATOR_COOKIE]: token }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'NO_CREDENTIALS' });
  });

  it('issues the step-up cookie on a valid assertion and rejects a bad body', async () => {
    const { token, authenticator } = await enrollFirstPasskey('op-stepup');

    const optionsResponse = await stepUpOptions.POST(post('/admin/api/step-up/options', { [OPERATOR_COOKIE]: token }));
    expect(optionsResponse.status).toBe(200);
    const options = (await optionsResponse.json()) as PublicKeyCredentialRequestOptionsJSON;
    expect(options.allowCredentials).toHaveLength(1);

    const malformed = await stepUpVerify.POST(post('/admin/api/step-up/verify', { [OPERATOR_COOKIE]: token }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: 'INVALID_BODY' });

    const { response, cookie } = await stepUp(
      token,
      authenticator,
      1,
    );
    expect(response.status).toBe(200);
    expect(cookie).toBeTruthy();
    const body = (await response.json()) as { ok: boolean; expiresAt: number };
    expect(body.ok).toBe(true);
    expect(body.expiresAt).toBeGreaterThan(Date.now());

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('Path=/admin');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
  });

  it('rejects a replayed assertion (non-advancing counter) with 401', async () => {
    const { token, authenticator } = await enrollFirstPasskey('op-replay');
    // First assertion advances the stored counter to 2.
    const first = await stepUp(token, authenticator, 2);
    expect(first.response.status).toBe(200);

    const optionsResponse = await stepUpOptions.POST(post('/admin/api/step-up/options', { [OPERATOR_COOKIE]: token }));
    const options = (await optionsResponse.json()) as PublicKeyCredentialRequestOptionsJSON;
    const replayed = authenticator.authenticationResponse(RP_ID, ORIGIN, options.challenge, { counter: 2 });
    const response = await stepUpVerify.POST(post('/admin/api/step-up/verify', { [OPERATOR_COOKIE]: token }, replayed));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'COUNTER_REPLAYED' });
  });
});
