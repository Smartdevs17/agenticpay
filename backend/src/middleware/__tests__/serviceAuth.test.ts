import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createHash, generateKeyPairSync, sign, X509Certificate } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  ServiceTokenVerifier,
  SCOPE_FORWARD_CLIENT_IP,
  certificateThumbprint,
  requireServiceToken,
  serviceAuthFromEnv,
  serviceAuthentication,
  thumbprintFromHeader,
  type ServiceAuthOptions,
  type ServiceKey,
} from '../serviceAuth.js';
// The worker's real token minting code, so both halves are tested together.
import { backendFetch, mintServiceToken, normalizeThumbprint, type ServiceAuthEnv } from '../../../../workers/src/serviceAuth.js';
import { resolveVerificationAgent } from '../../services/verification.js';

// Throwaway self-signed certificate (public part only) for the proxy-header path.
const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBUzCCAQWgAwIBAgIUeGQsM8msHng9qq/Podl4JvqMY6UwBQYDK2VwMB8xHTAb
BgNVBAMMFGFnZW50aWNwYXktZWRnZS10ZXN0MB4XDTI2MTEyMzEwMDAxMloXDTM2
MTEyMDEwMDAxMlowHzEdMBsGA1UEAwwUYWdlbnRpY3BheS1lZGdlLXRlc3QwKjAF
BgMrZXADIQB+jKQYm606rGJeELJOpK35rIGnCKLFP/z7A2dx87CpqKNTMFEwHQYD
VR0OBBYEFIPIW90GULs9lgwHStmfRx8q/BO1MB8GA1UdIwQYMBaAFIPIW90GULs9
lgwHStmfRx8q/BO1MA8GA1UdEwEB/wQFMAMBAf8wBQYDK2VwA0EAPE2mm+7js4rM
XA+srMM0t+ryWCVQgZYbWwHz4cMOsD9X8F4GdQjftn3T7omQJDtH4+ZVm2VmLQ+H
9KUOwyCLBQ==
-----END CERTIFICATE-----`;
const CERT_DER = new X509Certificate(TEST_CERT_PEM).raw;
const CERT_HEX = createHash('sha256').update(CERT_DER).digest('hex');
const CERT_THUMBPRINT = certificateThumbprint(CERT_DER);

const NOW = Date.UTC(2026, 10, 23, 12, 0, 0);
const CERT_HEADER = 'x-ssl-client-cert';

let workerEnv: ServiceAuthEnv;
let serviceKey: ServiceKey;
let otherPrivateKey: string;

beforeAll(() => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  workerEnv = {
    SERVICE_TOKEN_PRIVATE_KEY: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    SERVICE_TOKEN_KEY_ID: 'edge-2026-11',
    SERVICE_MTLS_CERT_SHA256: CERT_HEX,
  };
  serviceKey = {
    kid: 'edge-2026-11',
    service: 'agenticpay-edge',
    publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    scopes: ['edge:proxy', 'edge:warmup', SCOPE_FORWARD_CLIENT_IP],
  };
  otherPrivateKey = generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
});

function verifier(options: Partial<ServiceAuthOptions> = {}) {
  return new ServiceTokenVerifier({
    mode: 'enforce',
    keys: [serviceKey],
    clientCertHeader: CERT_HEADER,
    now: () => NOW,
    ...options,
  });
}

/** A request as Express would see it after a proxy verified the worker's client certificate. */
function fakeRequest(init: {
  token?: string;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  socket?: Record<string, unknown>;
} = {}): Request {
  const headers: Record<string, string> = {
    [CERT_HEADER]: encodeURIComponent(TEST_CERT_PEM),
    ...(init.token ? { 'x-service-token': init.token } : {}),
    ...init.headers,
  };
  return {
    method: init.method ?? 'POST',
    originalUrl: init.path ?? '/api/v1/cold-start/warmup',
    path: init.path ?? '/api/v1/cold-start/warmup',
    socket: init.socket ?? { remoteAddress: '10.0.0.5' },
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

const mint = (overrides: Partial<{ method: string; path: string; scopes: string[]; now: number; env: ServiceAuthEnv }> = {}) =>
  mintServiceToken(overrides.env ?? workerEnv, {
    method: overrides.method ?? 'POST',
    path: overrides.path ?? '/api/v1/cold-start/warmup',
    scopes: overrides.scopes ?? ['edge:warmup'],
    now: overrides.now ?? NOW,
  });

function decode(token: string) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

/** Re-sign a token with edited claims using the worker's key (simulates a mis-built or hostile token). */
function resign(token: string, edit: (claims: Record<string, unknown>) => void, privateKeyB64 = workerEnv.SERVICE_TOKEN_PRIVATE_KEY!) {
  const [header] = token.split('.');
  const claims = decode(token);
  edit(claims);
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = sign(null, Buffer.from(`${header}.${payload}`), {
    key: Buffer.from(privateKeyB64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  return `${header}.${payload}.${sig.toString('base64url')}`;
}

describe('worker token minting', () => {
  it('mints a short-lived, single-use EdDSA token bound to the request and the certificate', async () => {
    const token = await mint();
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
    const claims = decode(token);

    expect(header).toEqual({ alg: 'EdDSA', typ: 'svc+jwt', kid: 'edge-2026-11' });
    expect(claims).toMatchObject({
      iss: 'agenticpay-edge',
      aud: 'agenticpay-backend',
      htm: 'POST',
      htu: '/api/v1/cold-start/warmup',
      scope: 'edge:warmup',
      cnf: { 'x5t#S256': CERT_THUMBPRINT },
    });
    expect(claims.exp - claims.iat).toBe(60);
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(decode(await mint()).jti).not.toBe(claims.jti);
  });

  it('caps the lifetime at 300 seconds whatever the configuration says', async () => {
    const claims = decode(await mint({ env: { ...workerEnv, SERVICE_TOKEN_TTL_SECONDS: '86400' } }));
    expect(claims.exp - claims.iat).toBe(300);
  });

  it('accepts hex (with colons) and base64url certificate thumbprints', () => {
    const colons = CERT_HEX.match(/../g)!.join(':').toUpperCase();
    expect(normalizeThumbprint(colons)).toBe(CERT_THUMBPRINT);
    expect(normalizeThumbprint(CERT_THUMBPRINT)).toBe(CERT_THUMBPRINT);
    expect(() => normalizeThumbprint('not-a-thumbprint')).toThrow();
  });

  it('adds the token and uses the mTLS binding for backend calls', async () => {
    const seen: Array<{ url: string; headers: Headers }> = [];
    const env: ServiceAuthEnv = {
      ...workerEnv,
      BACKEND_MTLS: {
        fetch: async (input, init) => {
          seen.push({ url: String(input), headers: new Headers(init?.headers) });
          return new Response('{}');
        },
      },
    };
    await backendFetch(env, 'https://api.example.test/api/v1/verification/verify?x=1', {
      method: 'POST',
      scopes: ['edge:proxy'],
      headers: { 'Content-Type': 'application/json' },
    });

    expect(seen).toHaveLength(1);
    const claims = decode(seen[0].headers.get('x-service-token')!);
    expect(claims).toMatchObject({ htm: 'POST', htu: '/api/v1/verification/verify', scope: 'edge:proxy' });
    expect(seen[0].headers.get('content-type')).toBe('application/json');
  });

  it('sends no token when signing is not configured', async () => {
    let headers: Headers | undefined;
    await backendFetch(
      { BACKEND_MTLS: { fetch: async (_i, init) => ((headers = new Headers(init?.headers)), new Response('{}')) } },
      'https://api.example.test/health',
      { scopes: [] },
    );
    expect(headers?.has('x-service-token')).toBe(false);
  });
});

describe('ServiceTokenVerifier (#1474)', () => {
  it('accepts a worker token presented over the matching client certificate', async () => {
    const principal = verifier().verify(await mint(), fakeRequest());
    expect(principal).toMatchObject({
      service: 'agenticpay-edge',
      keyId: 'edge-2026-11',
      scopes: ['edge:warmup'],
      certThumbprint: CERT_THUMBPRINT,
    });
  });

  it('accepts the certificate from a directly terminated, CA-authorized TLS connection', async () => {
    const req = fakeRequest({
      headers: { [CERT_HEADER]: '' },
      socket: { encrypted: true, authorized: true, getPeerCertificate: () => ({ raw: CERT_DER }) },
    });
    expect(verifier({ clientCertHeader: undefined }).verify(await mint(), req).certThumbprint).toBe(CERT_THUMBPRINT);
  });

  const rejections: Array<[string, () => Promise<{ token: string; req?: Request; options?: Partial<ServiceAuthOptions> }>, string]> = [
    ['an unknown key', async () => ({ token: resign(await mint(), () => {}, otherPrivateKey) }), 'SERVICE_TOKEN_INVALID'],
    [
      'a tampered claim',
      async () => {
        const token = await mint();
        const [h, , s] = token.split('.');
        const claims = decode(token);
        claims.scope = 'edge:warmup edge:proxy';
        return { token: `${h}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${s}` };
      },
      'SERVICE_TOKEN_INVALID',
    ],
    ['an expired token', async () => ({ token: await mint({ now: NOW - 10 * 60_000 }) }), 'SERVICE_TOKEN_EXPIRED'],
    [
      'a token living longer than five minutes',
      async () => ({ token: resign(await mint(), (c) => ((c.exp as number) += 3600)) }),
      'SERVICE_TOKEN_TOO_LONG_LIVED',
    ],
    ['a token for another path', async () => ({ token: await mint({ path: '/api/v1/cold-start/reset' }) }), 'SERVICE_TOKEN_WRONG_REQUEST'],
    ['a token for another method', async () => ({ token: await mint({ method: 'GET' }) }), 'SERVICE_TOKEN_WRONG_REQUEST'],
    ['a scope the key may not grant', async () => ({ token: await mint({ scopes: ['admin:all'] }) }), 'SERVICE_TOKEN_SCOPE'],
    [
      'a wrong issuer for the key',
      async () => ({ token: resign(await mint(), (c) => (c.iss = 'agenticpay-backend')) }),
      'SERVICE_TOKEN_INVALID',
    ],
    ['no client certificate', async () => ({ token: await mint(), req: fakeRequest({ headers: { [CERT_HEADER]: '' } }) }), 'SERVICE_MTLS_REQUIRED'],
    [
      'a different client certificate',
      async () => ({ token: await mint(), req: fakeRequest({ headers: { [CERT_HEADER]: 'ab'.repeat(32) } }) }),
      'SERVICE_MTLS_MISMATCH',
    ],
    [
      'a certificate that is not pinned for the key',
      async () => ({ token: await mint(), options: { keys: [{ ...serviceKey, certThumbprints: ['A'.repeat(43)] }] } }),
      'SERVICE_MTLS_MISMATCH',
    ],
    [
      'a certificate header from an untrusted peer',
      async () => ({ token: await mint(), options: { trustedProxies: ['10.0.0.1'] } }),
      'SERVICE_MTLS_REQUIRED',
    ],
    [
      'a proxy that did not verify the certificate',
      async () => ({
        token: await mint(),
        req: fakeRequest({ headers: { 'x-ssl-client-verify': 'FAILED:self signed' } }),
        options: { clientVerifyHeader: 'x-ssl-client-verify' },
      }),
      'SERVICE_MTLS_REQUIRED',
    ],
    [
      'an unauthorized direct TLS connection',
      async () => ({
        token: await mint(),
        req: fakeRequest({
          headers: { [CERT_HEADER]: '' },
          socket: { encrypted: true, authorized: false, getPeerCertificate: () => ({ raw: CERT_DER }) },
        }),
        options: { clientCertHeader: undefined },
      }),
      'SERVICE_MTLS_REQUIRED',
    ],
    [
      'a retired key',
      async () => ({ token: await mint(), options: { keys: [{ ...serviceKey, notAfter: new Date(NOW - 1).toISOString() }] } }),
      'SERVICE_TOKEN_UNKNOWN_KEY',
    ],
    ['garbage', async () => ({ token: 'not.a.token' }), 'SERVICE_TOKEN_MALFORMED'],
  ];

  for (const [name, build, code] of rejections) {
    it(`rejects ${name}`, async () => {
      const { token, req, options } = await build();
      expect(() => verifier(options).verify(token, req ?? fakeRequest())).toThrow(expect.objectContaining({ code }));
    });
  }

  it('accepts each token once', async () => {
    const v = verifier();
    const token = await mint();
    v.verify(token, fakeRequest());
    expect(() => v.verify(token, fakeRequest())).toThrow(expect.objectContaining({ code: 'SERVICE_TOKEN_REPLAY' }));
  });

  it('only trusts the forwarded client IP with the forward-client-ip scope', async () => {
    const path = '/api/v1/verification/verify';
    const headers = { 'x-real-ip': '198.51.100.23' };
    const withScope = verifier().verify(await mint({ path, scopes: ['edge:proxy', SCOPE_FORWARD_CLIENT_IP] }), fakeRequest({ path, headers }));
    const without = verifier().verify(await mint({ path, scopes: ['edge:proxy'] }), fakeRequest({ path, headers }));
    expect(withScope.clientIp).toBe('198.51.100.23');
    expect(without.clientIp).toBeUndefined();
  });

  it('reads proxy certificate headers as escaped PEM or fingerprint', () => {
    expect(thumbprintFromHeader(encodeURIComponent(TEST_CERT_PEM))).toBe(CERT_THUMBPRINT);
    expect(thumbprintFromHeader(TEST_CERT_PEM)).toBe(CERT_THUMBPRINT);
    expect(thumbprintFromHeader(CERT_HEX)).toBe(CERT_THUMBPRINT);
    expect(thumbprintFromHeader('%E0%A4%A')).toBeUndefined();
  });

  it('only accepts Ed25519 public keys', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'pem', type: 'spki' }).toString();
    expect(() => verifier({ keys: [{ ...serviceKey, publicKey: rsa }] })).toThrow(/Ed25519/);
  });

  it('reads its configuration from the environment', () => {
    const v = serviceAuthFromEnv({
      SERVICE_AUTH_MODE: 'enforce',
      SERVICE_TOKEN_KEYS: JSON.stringify([serviceKey]),
      SERVICE_AUTH_CLIENT_CERT_HEADER: CERT_HEADER,
    });
    expect(v.mode).toBe('enforce');
    expect(() => serviceAuthFromEnv({ SERVICE_AUTH_MODE: 'strict' })).toThrow(/SERVICE_AUTH_MODE/);
  });
});

describe('service auth middleware', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise((resolve) => server!.close(resolve));
    server = undefined;
  });

  async function start(v: ServiceTokenVerifier) {
    const app = express();
    app.use(serviceAuthentication(v));
    app.post('/api/v1/cold-start/warmup', requireServiceToken('edge:warmup', v), (req, res) => {
      res.json({ service: req.service?.service ?? null });
    });
    app.post('/api/v1/verification/verify', (req, res) => {
      res.json({ agent: resolveVerificationAgent(req).id });
    });
    app.use((err: { statusCode?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(err.statusCode ?? 500).json({ code: err.code });
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const address = server.address();
    return typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
  }

  const call = (url: string, headers: Record<string, string>) =>
    fetch(url, { method: 'POST', headers: { [CERT_HEADER]: encodeURIComponent(TEST_CERT_PEM), ...headers } });

  it('enforce: lets the worker in and keeps everyone else out of the warmup route', async () => {
    const base = await start(verifier());
    const ok = await call(`${base}/api/v1/cold-start/warmup`, { 'x-service-token': await mint() });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ service: 'agenticpay-edge' });

    const missing = await call(`${base}/api/v1/cold-start/warmup`, {});
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ code: 'SERVICE_AUTH_REQUIRED' });

    const wrongScope = await call(`${base}/api/v1/cold-start/warmup`, { 'x-service-token': await mint({ scopes: ['edge:proxy'] }) });
    expect(wrongScope.status).toBe(403);

    const once = await mint();
    expect((await call(`${base}/api/v1/cold-start/warmup`, { 'x-service-token': once })).status).toBe(200);
    const replay = await call(`${base}/api/v1/cold-start/warmup`, { 'x-service-token': once });
    expect(replay.status).toBe(401);
    expect(await replay.json()).toEqual({ code: 'SERVICE_TOKEN_REPLAY' });
  });

  it('optional: logs failures but lets requests through, for rollout', async () => {
    const v = verifier({ mode: 'optional' });
    const base = await start(v);
    expect((await call(`${base}/api/v1/cold-start/warmup`, {})).status).toBe(200);
    expect((await call(`${base}/api/v1/cold-start/warmup`, { 'x-service-token': 'garbage' })).status).toBe(200);
    expect(v.stats()).toMatchObject({ missing: 2, SERVICE_TOKEN_MALFORMED: 1 });
  });

  it('keys anonymous verification quotas on the edge-reported client IP only for verified workers', async () => {
    const base = await start(verifier());
    const path = '/api/v1/verification/verify';
    const viaEdge = await call(`${base}${path}`, {
      'x-service-token': await mint({ path, scopes: ['edge:proxy', SCOPE_FORWARD_CLIENT_IP] }),
      'x-real-ip': '198.51.100.23',
    });
    expect(await viaEdge.json()).toEqual({ agent: 'ip:198.51.100.23' });

    const spoofed = await call(`${base}${path}`, { 'x-real-ip': '198.51.100.23' });
    expect((await spoofed.json()).agent).not.toBe('ip:198.51.100.23');
  });
});
