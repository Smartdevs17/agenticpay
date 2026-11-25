import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VirtualAuthenticator } from '../test/virtual-authenticator';
import {
  DEFAULT_CHALLENGE_TTL_MS,
  DEFAULT_STEP_UP_TTL_MS,
  WebAuthnConfigError,
  WebAuthnError,
  createFileCredentialStore,
  createInMemoryChallengeStore,
  createInMemoryCredentialStore,
  createInMemoryOperatorSessionStore,
  createInMemoryStepUpSessionStore,
  createSecurityEvents,
  createWebAuthnService,
  decideAdminAccess,
  isCounterReplay,
  readWebAuthnConfig,
  type PortalWebAuthnConfig,
  type SecurityEvent,
  type StoredCredential,
} from './webauthn';

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

const config: PortalWebAuthnConfig = {
  rpID: 'portal.agenticpay.dev',
  rpName: 'AgenticPay Developer Portal',
  origin: 'https://portal.agenticpay.dev',
  challengeTtlMs: 60_000,
  stepUpTtlMs: 300_000,
  userVerification: 'required',
};

function credential(overrides: Partial<StoredCredential> = {}): StoredCredential {
  return {
    id: 'cred-1',
    publicKey: 'AAAA',
    counter: 0,
    operatorId: 'op-1',
    deviceType: 'singleDevice',
    backedUp: false,
    createdAt: NOW,
    lastUsedAt: NOW,
    ...overrides,
  };
}

/** The error code a promise rejects with, or `undefined` if it resolves. */
function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  return promise.then(
    () => undefined,
    (error: unknown) => (error instanceof WebAuthnError ? error.code : `not-a-webauthn-error:${String(error)}`),
  );
}

function createHarness(overrides: Partial<PortalWebAuthnConfig> = {}) {
  const clock = testClock();
  const events: SecurityEvent[] = [];
  const securityEvents = createSecurityEvents({
    write: (line) => {
      const parsed = JSON.parse(line) as SecurityEvent & { event: SecurityEvent['name'] };
      events.push({ ...parsed, name: parsed.event });
    },
  });
  const credentials = createInMemoryCredentialStore();
  const challenges = createInMemoryChallengeStore({ clock });
  const stepUpSessions = createInMemoryStepUpSessionStore({ clock, ttlMs: config.stepUpTtlMs });
  const effective = { ...config, ...overrides };
  const service = createWebAuthnService({
    config: effective,
    credentials,
    challenges,
    stepUpSessions,
    events: securityEvents,
    clock,
  });
  return { clock, events, credentials, challenges, stepUpSessions, service, config: effective };
}

describe('readWebAuthnConfig', () => {
  it('requires the relying-party id and origin', () => {
    expect(() => readWebAuthnConfig({})).toThrow(WebAuthnConfigError);
    expect(() => readWebAuthnConfig({ WEBAUTHN_ORIGIN: 'https://x.dev' })).toThrow(/WEBAUTHN_RP_ID/);
    expect(() => readWebAuthnConfig({ WEBAUTHN_RP_ID: 'x.dev' })).toThrow(/WEBAUTHN_ORIGIN/);
  });

  it('fills in the documented defaults', () => {
    expect(readWebAuthnConfig({ WEBAUTHN_RP_ID: 'x.dev', WEBAUTHN_ORIGIN: 'https://x.dev' })).toEqual({
      rpID: 'x.dev',
      rpName: 'AgenticPay Developer Portal',
      origin: 'https://x.dev',
      challengeTtlMs: DEFAULT_CHALLENGE_TTL_MS,
      stepUpTtlMs: DEFAULT_STEP_UP_TTL_MS,
      userVerification: 'required',
    });
  });

  it('honours overrides and ignores invalid ones', () => {
    expect(
      readWebAuthnConfig({
        WEBAUTHN_RP_ID: 'x.dev',
        WEBAUTHN_ORIGIN: 'https://x.dev',
        WEBAUTHN_RP_NAME: 'Internal',
        WEBAUTHN_CHALLENGE_TTL_MS: '1500',
        WEBAUTHN_STEP_UP_TTL_MS: '-5',
        WEBAUTHN_USER_VERIFICATION: 'preferred',
      }),
    ).toMatchObject({ rpName: 'Internal', challengeTtlMs: 1500, stepUpTtlMs: DEFAULT_STEP_UP_TTL_MS, userVerification: 'preferred' });
    expect(readWebAuthnConfig({ WEBAUTHN_RP_ID: 'x.dev', WEBAUTHN_ORIGIN: 'https://x.dev', WEBAUTHN_USER_VERIFICATION: 'nope' }).userVerification).toBe(
      'required',
    );
  });
});

describe('decideAdminAccess', () => {
  const operatorSession = { sessionId: 's1', operatorId: 'op-1', expiresAt: NOW + 1000 };
  const stepUpSession = { sessionId: 'u1', operatorId: 'op-1', credentialId: 'cred-1', issuedAt: NOW, expiresAt: NOW + 1000 };

  it('allows only a live operator session with a live matching step-up', () => {
    expect(decideAdminAccess({ operatorSession, stepUpSession, now: NOW })).toMatchObject({ allow: true, operatorId: 'op-1' });
  });

  it.each([
    ['no-operator-session', { operatorSession: null, stepUpSession, now: NOW }],
    ['no-operator-session', { operatorSession: { ...operatorSession, expiresAt: NOW }, stepUpSession, now: NOW }],
    ['no-step-up-session', { operatorSession, stepUpSession: null, now: NOW }],
    ['step-up-expired', { operatorSession, stepUpSession: { ...stepUpSession, expiresAt: NOW }, now: NOW }],
    ['step-up-operator-mismatch', { operatorSession, stepUpSession: { ...stepUpSession, operatorId: 'op-2' }, now: NOW }],
  ])('denies with %s', (reason, input) => {
    expect(decideAdminAccess(input)).toEqual({ allow: false, reason });
  });

  it('checks the mismatch before expiry so a foreign expired session never allows access', () => {
    expect(
      decideAdminAccess({ operatorSession, stepUpSession: { ...stepUpSession, operatorId: 'op-2', expiresAt: NOW }, now: NOW }),
    ).toEqual({ allow: false, reason: 'step-up-operator-mismatch' });
  });
});

describe('isCounterReplay', () => {
  it.each([
    [0, 0, false],
    [0, 1, false],
    [1, 2, false],
    [1, 1, true],
    [2, 1, true],
    [3, 0, true],
  ])('previous=%i next=%i -> %s', (previous, next, expected) => {
    expect(isCounterReplay(previous, next)).toBe(expected);
  });
});

describe('stores', () => {
  it('operators sessions expire and can be revoked', async () => {
    const clock = testClock();
    const store = createInMemoryOperatorSessionStore({ clock, ttlMs: 1000 });
    const session = await store.issue('op-1');
    expect(await store.find(session.sessionId)).toEqual(session);
    clock.advance(1000);
    expect(await store.find(session.sessionId)).toBeNull();
    const second = await store.issue('op-1');
    await store.revoke(second.sessionId);
    expect(await store.find(second.sessionId)).toBeNull();
  });

  it('step-up sessions are scoped per operator and revocable en masse', async () => {
    const clock = testClock();
    const store = createInMemoryStepUpSessionStore({ clock, ttlMs: 500 });
    const a = await store.issue({ operatorId: 'op-1', credentialId: 'cred-1' });
    const b = await store.issue({ operatorId: 'op-1', credentialId: 'cred-2' });
    const other = await store.issue({ operatorId: 'op-2', credentialId: 'cred-3' });
    await store.revokeForOperator('op-1');
    expect(await store.find(a.sessionId)).toBeNull();
    expect(await store.find(b.sessionId)).toBeNull();
    expect(await store.find(other.sessionId)).toEqual(other);
    clock.advance(500);
    expect(await store.find(other.sessionId)).toBeNull();
  });

  it('challenges are single-use and expire', async () => {
    const clock = testClock();
    const store = createInMemoryChallengeStore({ clock });
    await store.put({ challenge: 'c1', operatorId: 'op-1', ceremony: 'registration', expiresAt: clock.now() + 100 });
    expect(await store.take('c1')).toMatchObject({ challenge: 'c1' });
    expect(await store.take('c1')).toBeNull();

    await store.put({ challenge: 'c2', operatorId: 'op-1', ceremony: 'registration', expiresAt: clock.now() + 100 });
    clock.advance(100);
    expect(await store.take('c2')).toBeNull();
    expect(await store.take('unknown')).toBeNull();
  });
});

describe('createSecurityEvents', () => {
  it('writes one JSON line per event and counts them by name and outcome', () => {
    const lines: string[] = [];
    const events = createSecurityEvents({ write: (line) => lines.push(line) });
    events.emit({ name: 'admin.access_granted', outcome: 'success', operatorId: 'op-1', traceId: 'trace-1' });
    events.emit({ name: 'admin.access_denied', outcome: 'failure', reason: 'no-step-up-session' });
    events.emit({ name: 'admin.access_denied', outcome: 'failure', reason: 'no-operator-session' });

    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toMatchObject({
      level: 'info',
      service: 'agenticpay-developer-portal',
      event: 'admin.access_granted',
      outcome: 'success',
      operatorId: 'op-1',
      traceId: 'trace-1',
    });
    expect(JSON.parse(lines[1])).toMatchObject({ level: 'warn', reason: 'no-step-up-session' });
    expect(events.snapshot()).toEqual({ 'admin.access_granted.success': 1, 'admin.access_denied.failure': 2 });
  });
});

describe('createFileCredentialStore', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  async function storeAt() {
    const dir = await mkdtemp(join(tmpdir(), 'dp-credentials-'));
    dirs.push(dir);
    return { filePath: join(dir, 'credentials.json'), dir };
  }

  it('starts empty when the file is missing', async () => {
    const { filePath } = await storeAt();
    expect(await createFileCredentialStore({ filePath }).list('op-1')).toEqual([]);
  });

  it('persists, updates and removes credentials durably', async () => {
    const { filePath, dir } = await storeAt();
    const store = createFileCredentialStore({ filePath });
    await store.save(credential({ id: 'cred-1' }));
    await store.save(credential({ id: 'cred-2', operatorId: 'op-2' }));

    expect(await store.list('op-1')).toHaveLength(1);
    expect(await store.find('cred-2')).toMatchObject({ operatorId: 'op-2' });

    await store.updateCounter('cred-1', 7, NOW + 5);
    expect(await store.find('cred-1')).toMatchObject({ counter: 7, lastUsedAt: NOW + 5 });

    // A fresh instance reads what the previous one wrote — credentials survive a restart.
    expect(await createFileCredentialStore({ filePath }).find('cred-1')).toMatchObject({ counter: 7 });

    await store.remove('cred-1');
    expect(await store.find('cred-1')).toBeNull();
    // Writes are atomic: no temp files are left behind.
    expect(await readdir(dir)).toEqual(['credentials.json']);
  });

  it('serialises concurrent writes so none are lost', async () => {
    const { filePath } = await storeAt();
    const store = createFileCredentialStore({ filePath });
    await Promise.all([
      store.save(credential({ id: 'a' })),
      store.save(credential({ id: 'b' })),
      store.save(credential({ id: 'c' })),
    ]);
    expect((await store.list('op-1')).map((item) => item.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('createWebAuthnService', () => {
  it('tells an operator with no passkey to enroll first', async () => {
    const { service } = createHarness();
    expect(await errorCode(service.beginAuthentication('op-1'))).toBe('NO_CREDENTIALS');
  });

  it('registers a passkey end to end and emits correlated events', async () => {
    const harness = createHarness();
    const authenticator = new VirtualAuthenticator();

    const options = await harness.service.beginRegistration('op-1', { traceId: 'trace-1', requestId: 'req-1' });
    expect(options.rp.id).toBe(config.rpID);
    expect(options.challenge).toBeTruthy();

    const stored = await harness.service.finishRegistration(
      'op-1',
      authenticator.registrationResponse(config.rpID, config.origin, options.challenge),
      { traceId: 'trace-1' },
    );
    expect(stored).toMatchObject({ operatorId: 'op-1', counter: 0, deviceType: 'singleDevice', backedUp: false });
    expect(stored.id).toBe(authenticator.credentialIdBase64Url);
    expect(await harness.service.listCredentials('op-1')).toEqual([stored]);
    expect(harness.events.map((event) => event.name)).toEqual(['webauthn.registration_started', 'webauthn.registration_completed']);
    expect(harness.events[0]).toMatchObject({ traceId: 'trace-1', requestId: 'req-1' });
  });

  it('excludes already-registered credentials from a new registration', async () => {
    const harness = createHarness();
    const authenticator = new VirtualAuthenticator();
    const first = await harness.service.beginRegistration('op-1');
    await harness.service.finishRegistration('op-1', authenticator.registrationResponse(config.rpID, config.origin, first.challenge));

    const second = await harness.service.beginRegistration('op-1');
    expect(second.excludeCredentials).toEqual([
      { id: authenticator.credentialIdBase64Url, type: 'public-key', transports: undefined },
    ]);
  });

  it('mints a step-up session via a real assertion and advances the counter', async () => {
    const harness = createHarness();
    const authenticator = new VirtualAuthenticator();
    const registration = await harness.service.beginRegistration('op-1');
    await harness.service.finishRegistration('op-1', authenticator.registrationResponse(config.rpID, config.origin, registration.challenge));

    const options = await harness.service.beginAuthentication('op-1', { traceId: 'trace-2' });
    const session = await harness.service.finishAuthentication(
      'op-1',
      authenticator.authenticationResponse(config.rpID, config.origin, options.challenge, { counter: 4 }),
      { traceId: 'trace-2' },
    );
    expect(session).toMatchObject({ operatorId: 'op-1', credentialId: authenticator.credentialIdBase64Url });
    expect(session.expiresAt - session.issuedAt).toBe(config.stepUpTtlMs);
    expect(await harness.credentials.find(authenticator.credentialIdBase64Url)).toMatchObject({ counter: 4 });
    expect(harness.events.at(-1)).toMatchObject({ name: 'webauthn.step_up_issued', traceId: 'trace-2' });
  });

  it('accepts an authenticator that never increments its counter', async () => {
    const harness = createHarness();
    const authenticator = new VirtualAuthenticator();
    const registration = await harness.service.beginRegistration('op-1');
    await harness.service.finishRegistration('op-1', authenticator.registrationResponse(config.rpID, config.origin, registration.challenge));

    const first = await harness.service.beginAuthentication('op-1');
    await harness.service.finishAuthentication('op-1', authenticator.authenticationResponse(config.rpID, config.origin, first.challenge, { counter: 0 }));
    const second = await harness.service.beginAuthentication('op-1');
    await expect(
      harness.service.finishAuthentication('op-1', authenticator.authenticationResponse(config.rpID, config.origin, second.challenge, { counter: 0 })),
    ).resolves.toMatchObject({ operatorId: 'op-1' });
  });

  it('rejects a replayed challenge', async () => {
    const harness = createHarness();
    const authenticator = new VirtualAuthenticator();
    const registration = await harness.service.beginRegistration('op-1');
    const response = authenticator.registrationResponse(config.rpID, config.origin, registration.challenge);
    await harness.service.finishRegistration('op-1', response);
    expect(await errorCode(harness.service.finishRegistration('op-1', response))).toBe('CHALLENGE_INVALID');
    expect(harness.events.at(-1)).toMatchObject({ name: 'webauthn.registration_failed', reason: 'CHALLENGE_INVALID' });
  });

  it('rejects an expired challenge', async () => {
    const harness = createHarness();
    const authenticator = new VirtualAuthenticator();
    const registration = await harness.service.beginRegistration('op-1');
    harness.clock.advance(config.challengeTtlMs);
    expect(
      await errorCode(harness.service.finishRegistration('op-1', authenticator.registrationResponse(config.rpID, config.origin, registration.challenge))),
    ).toBe('CHALLENGE_INVALID');
  });

  it('rejects a challenge issued for another ceremony or another operator', async () => {
    const harness = createHarness();
    const authenticator = new VirtualAuthenticator();
    const registration = await harness.service.beginRegistration('op-1');
    // Same challenge string, but presented as an authentication response.
    expect(
      await errorCode(harness.service.finishAuthentication('op-1', authenticator.authenticationResponse(config.rpID, config.origin, registration.challenge))),
    ).toBe('CHALLENGE_INVALID');

    const other = await harness.service.beginRegistration('op-2');
    expect(
      await errorCode(harness.service.finishRegistration('op-1', authenticator.registrationResponse(config.rpID, config.origin, other.challenge))),
    ).toBe('CHALLENGE_INVALID');
  });

  it('rejects a response whose client data carries no challenge', async () => {
    const harness = createHarness();
    const response = { ...new VirtualAuthenticator().registrationResponse(config.rpID, config.origin, 'ignored') };
    response.response = { ...response.response, clientDataJSON: Buffer.from('{}').toString('base64url') };
    expect(await errorCode(harness.service.finishRegistration('op-1', response))).toBe('CHALLENGE_INVALID');
  });

  it('reports an assertion for an unknown credential as CREDENTIAL_UNKNOWN', async () => {
    const harness = createHarness();
    const authenticator = new VirtualAuthenticator();
    const registration = await harness.service.beginRegistration('op-1');
    await harness.service.finishRegistration('op-1', authenticator.registrationResponse(config.rpID, config.origin, registration.challenge));

    const stranger = new VirtualAuthenticator();
    const options = await harness.service.beginAuthentication('op-1');
    expect(
      await errorCode(harness.service.finishAuthentication('op-1', stranger.authenticationResponse(config.rpID, config.origin, options.challenge))),
    ).toBe('CREDENTIAL_UNKNOWN');
  });

  it("reports another operator's credential as CREDENTIAL_UNKNOWN, never confirming it exists", async () => {
    const harness = createHarness();
    const alice = new VirtualAuthenticator();
    const bob = new VirtualAuthenticator();
    const aliceRegistration = await harness.service.beginRegistration('op-alice');
    await harness.service.finishRegistration('op-alice', alice.registrationResponse(config.rpID, config.origin, aliceRegistration.challenge));
    const bobRegistration = await harness.service.beginRegistration('op-bob');
    await harness.service.finishRegistration('op-bob', bob.registrationResponse(config.rpID, config.origin, bobRegistration.challenge));

    const options = await harness.service.beginAuthentication('op-alice');
    expect(
      await errorCode(harness.service.finishAuthentication('op-alice', bob.authenticationResponse(config.rpID, config.origin, options.challenge))),
    ).toBe('CREDENTIAL_UNKNOWN');
  });

  it('rejects a tampered assertion as VERIFICATION_FAILED', async () => {
    const harness = createHarness();
    const authenticator = new VirtualAuthenticator();
    const registration = await harness.service.beginRegistration('op-1');
    await harness.service.finishRegistration('op-1', authenticator.registrationResponse(config.rpID, config.origin, registration.challenge));

    const options = await harness.service.beginAuthentication('op-1');
    const assertion = authenticator.authenticationResponse(config.rpID, config.origin, options.challenge, { counter: 1 });
    assertion.response = { ...assertion.response, signature: Buffer.from(new Uint8Array(71)).toString('base64url') };
    expect(await errorCode(harness.service.finishAuthentication('op-1', assertion))).toBe('VERIFICATION_FAILED');
    expect(harness.events.at(-1)).toMatchObject({ name: 'webauthn.authentication_failed', reason: 'VERIFICATION_FAILED' });
  });

  it('rejects an assertion from a different origin', async () => {
    const harness = createHarness();
    const authenticator = new VirtualAuthenticator();
    const registration = await harness.service.beginRegistration('op-1');
    await harness.service.finishRegistration('op-1', authenticator.registrationResponse(config.rpID, config.origin, registration.challenge));

    const options = await harness.service.beginAuthentication('op-1');
    const assertion = authenticator.authenticationResponse(config.rpID, 'https://evil.example', options.challenge);
    expect(await errorCode(harness.service.finishAuthentication('op-1', assertion))).toBe('VERIFICATION_FAILED');
  });

  it('rejects a non-advancing counter as COUNTER_REPLAYED', async () => {
    const harness = createHarness();
    const authenticator = new VirtualAuthenticator();
    const registration = await harness.service.beginRegistration('op-1');
    await harness.service.finishRegistration('op-1', authenticator.registrationResponse(config.rpID, config.origin, registration.challenge));

    const first = await harness.service.beginAuthentication('op-1');
    await harness.service.finishAuthentication('op-1', authenticator.authenticationResponse(config.rpID, config.origin, first.challenge, { counter: 5 }));

    const second = await harness.service.beginAuthentication('op-1');
    expect(
      await errorCode(harness.service.finishAuthentication('op-1', authenticator.authenticationResponse(config.rpID, config.origin, second.challenge, { counter: 5 }))),
    ).toBe('COUNTER_REPLAYED');
    expect(harness.events.at(-1)).toMatchObject({ name: 'webauthn.authentication_failed', reason: 'COUNTER_REPLAYED' });
  });

  it('retires the previous step-up when a new one is minted', async () => {
    const harness = createHarness();
    const authenticator = new VirtualAuthenticator();
    const registration = await harness.service.beginRegistration('op-1');
    await harness.service.finishRegistration('op-1', authenticator.registrationResponse(config.rpID, config.origin, registration.challenge));

    const firstOptions = await harness.service.beginAuthentication('op-1');
    const firstSession = await harness.service.finishAuthentication(
      'op-1',
      authenticator.authenticationResponse(config.rpID, config.origin, firstOptions.challenge, { counter: 1 }),
    );
    const secondOptions = await harness.service.beginAuthentication('op-1');
    await harness.service.finishAuthentication(
      'op-1',
      authenticator.authenticationResponse(config.rpID, config.origin, secondOptions.challenge, { counter: 2 }),
    );
    expect(await harness.stepUpSessions.find(firstSession.sessionId)).toBeNull();
  });

  it('revokes existing step-ups when a new credential is enrolled', async () => {
    const harness = createHarness();
    const authenticator = new VirtualAuthenticator();
    const first = await harness.service.beginRegistration('op-1');
    await harness.service.finishRegistration('op-1', authenticator.registrationResponse(config.rpID, config.origin, first.challenge));

    const options = await harness.service.beginAuthentication('op-1');
    const session = await harness.service.finishAuthentication(
      'op-1',
      authenticator.authenticationResponse(config.rpID, config.origin, options.challenge, { counter: 1 }),
    );

    const second = await harness.service.beginRegistration('op-1');
    await harness.service.finishRegistration('op-1', new VirtualAuthenticator().registrationResponse(config.rpID, config.origin, second.challenge));
    expect(await harness.stepUpSessions.find(session.sessionId)).toBeNull();
  });

  it('rejects a registration whose attestation carries the wrong origin', async () => {
    const harness = createHarness();
    const authenticator = new VirtualAuthenticator();
    const registration = await harness.service.beginRegistration('op-1');
    const response = authenticator.registrationResponse(config.rpID, 'https://evil.example', registration.challenge);
    expect(await errorCode(harness.service.finishRegistration('op-1', response))).toBe('VERIFICATION_FAILED');
    expect(harness.events.at(-1)).toMatchObject({ name: 'webauthn.registration_failed', reason: 'VERIFICATION_FAILED' });
  });
});
