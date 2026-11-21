import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('../../config/rate-limit-redis.js', () => ({
  getSharedRateLimitRedis: vi.fn().mockResolvedValue(null),
}));

import {
  JwtService,
  MAX_ACCESS_TOKEN_TTL_SECONDS,
  MIN_ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  resolveJwtSecret,
} from '../jwt.js';
import { AccessTokenRevocationList } from '../access-token-revocation.js';

const SECRET = 's'.repeat(48);
const OTHER_SECRET = 'o'.repeat(48);

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function forge(header: Record<string, unknown>, payload: Record<string, unknown>, secret = SECRET): string {
  const head = b64(header);
  const body = b64(payload);
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

describe('JwtService — Issue #1014', () => {
  let clock: Date;
  let revocations: AccessTokenRevocationList;
  let service: JwtService;
  const now = () => clock;

  beforeEach(() => {
    clock = new Date('2026-01-01T00:00:00Z');
    revocations = new AccessTokenRevocationList({ sharedStore: async () => null, now });
    service = new JwtService({ secret: SECRET, revocationList: revocations, now });
  });

  describe('short-lived access tokens', () => {
    it('issues 15 minute tokens by default with the required claims', () => {
      const { token, claims, expiresAt } = service.issue({ userId: 'u1', tenantId: 't1', familyId: 'f1' });

      expect(claims.exp - claims.iat).toBe(DEFAULT_ACCESS_TOKEN_TTL_SECONDS);
      expect(expiresAt.getTime()).toBe(clock.getTime() + 15 * 60 * 1000);
      expect(claims).toMatchObject({ sub: 'u1', tenantId: 't1', fid: 'f1', iss: 'agenticpay', aud: 'agenticpay-api' });
      expect(claims.jti).toMatch(/[0-9a-f-]{36}/);

      const verified = service.verify(token);
      expect(verified).toEqual({ ok: true, claims });
    });

    it('clamps requested lifetimes into [1 minute, 1 hour]', () => {
      const long = service.issue({ userId: 'u1', tenantId: 't1', ttlSeconds: 30 * 24 * 3600 }).claims;
      const short = service.issue({ userId: 'u1', tenantId: 't1', ttlSeconds: 1 }).claims;
      expect(long.exp - long.iat).toBe(MAX_ACCESS_TOKEN_TTL_SECONDS);
      expect(short.exp - short.iat).toBe(MIN_ACCESS_TOKEN_TTL_SECONDS);
      expect(new JwtService({ secret: SECRET, ttlSeconds: 99_999 }).ttlSeconds).toBe(MAX_ACCESS_TOKEN_TTL_SECONDS);
    });

    it('rejects tokens once expired, allowing only the clock-skew grace', () => {
      const { token } = service.issue({ userId: 'u1', tenantId: 't1' });

      clock = new Date(clock.getTime() + 15 * 60 * 1000 + 10_000);
      expect(service.verify(token).ok).toBe(true); // within 30s skew

      clock = new Date(clock.getTime() + 60_000);
      expect(service.verify(token)).toEqual({ ok: false, reason: 'expired' });
    });

    it('rejects correctly signed tokens whose lifetime exceeds the ceiling', () => {
      const iat = Math.floor(clock.getTime() / 1000);
      const token = forge(
        { alg: 'HS256', typ: 'JWT', kid: 'k1' },
        { iss: 'agenticpay', aud: 'agenticpay-api', sub: 'u1', jti: 'j1', tenantId: 't1', iat, exp: iat + 86_400 },
      );
      expect(service.verify(token)).toEqual({ ok: false, reason: 'lifetime_exceeded' });
    });

    it('rejects tokens issued in the future or not yet valid', () => {
      const iat = Math.floor(clock.getTime() / 1000);
      const base = { iss: 'agenticpay', aud: 'agenticpay-api', sub: 'u1', jti: 'j1', tenantId: 't1' };
      const header = { alg: 'HS256', typ: 'JWT', kid: 'k1' };
      expect(service.verify(forge(header, { ...base, iat: iat + 600, exp: iat + 900 }))).toEqual({
        ok: false,
        reason: 'not_yet_valid',
      });
      expect(service.verify(forge(header, { ...base, iat, nbf: iat + 600, exp: iat + 900 }))).toEqual({
        ok: false,
        reason: 'not_yet_valid',
      });
    });
  });

  describe('algorithm enforcement', () => {
    const iat = () => Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000);
    const payload = () => ({
      iss: 'agenticpay',
      aud: 'agenticpay-api',
      sub: 'u1',
      jti: 'j1',
      tenantId: 't1',
      iat: iat(),
      exp: iat() + 600,
    });

    it('rejects alg "none" tokens with an empty or missing signature', () => {
      const unsigned = `${b64({ alg: 'none', typ: 'JWT', kid: 'k1' })}.${b64(payload())}.`;
      expect(service.verify(unsigned).ok).toBe(false);
      const withSig = forge({ alg: 'none', typ: 'JWT', kid: 'k1' }, payload());
      expect(service.verify(withSig)).toEqual({ ok: false, reason: 'unsupported_algorithm' });
    });

    it.each(['RS256', 'HS384', 'HS512', 'ES256', 'hs256'])('rejects %s even when HMAC-signed with the secret', (alg) => {
      expect(service.verify(forge({ alg, typ: 'JWT', kid: 'k1' }, payload()))).toEqual({
        ok: false,
        reason: 'unsupported_algorithm',
      });
    });

    it('rejects tokens with critical header extensions or unknown key ids', () => {
      expect(service.verify(forge({ alg: 'HS256', kid: 'k1', crit: ['exp'] }, payload())).ok).toBe(false);
      expect(service.verify(forge({ alg: 'HS256', kid: 'nope' }, payload()))).toEqual({
        ok: false,
        reason: 'unknown_key',
      });
    });

    it('rejects tokens signed with a different secret or tampered payloads', () => {
      expect(service.verify(forge({ alg: 'HS256', kid: 'k1' }, payload(), OTHER_SECRET))).toEqual({
        ok: false,
        reason: 'invalid_signature',
      });

      const { token } = service.issue({ userId: 'u1', tenantId: 't1' });
      const [h, , s] = token.split('.');
      const escalated = `${h}.${b64({ ...payload(), sub: 'admin', role: 'admin' })}.${s}`;
      expect(service.verify(escalated)).toEqual({ ok: false, reason: 'invalid_signature' });
    });

    it('rejects wrong issuer/audience and missing claims', () => {
      const header = { alg: 'HS256', kid: 'k1' };
      expect(service.verify(forge(header, { ...payload(), iss: 'evil' }))).toEqual({ ok: false, reason: 'invalid_claims' });
      expect(service.verify(forge(header, { ...payload(), aud: 'other-api' }))).toEqual({
        ok: false,
        reason: 'invalid_claims',
      });
      const { jti: _jti, ...noJti } = payload();
      expect(service.verify(forge(header, noJti))).toEqual({ ok: false, reason: 'invalid_claims' });
    });

    it('rejects malformed input', () => {
      for (const bad of ['', 'a.b', 'a.b.c.d', 'at_' + 'a'.repeat(64), '!!.@@.##', 'x'.repeat(5000)]) {
        expect(service.verify(bad).ok).toBe(false);
      }
    });
  });

  describe('key rotation', () => {
    it('verifies tokens signed by the previous secret only when it is configured', () => {
      const old = new JwtService({ secret: OTHER_SECRET, revocationList: revocations, now });
      const token = old.issue({ userId: 'u1', tenantId: 't1' }).token;
      // `old` signs with kid k1; re-sign the same claims as the previous key (k0).
      const [, body] = token.split('.');
      const head = b64({ alg: 'HS256', typ: 'JWT', kid: 'k0' });
      const sig = createHmac('sha256', OTHER_SECRET).update(`${head}.${body}`).digest('base64url');
      const previousKeyToken = `${head}.${body}.${sig}`;

      expect(service.verify(previousKeyToken)).toEqual({ ok: false, reason: 'unknown_key' });
      const rotated = new JwtService({ secret: SECRET, previousSecret: OTHER_SECRET, revocationList: revocations, now });
      expect(rotated.verify(previousKeyToken).ok).toBe(true);
    });
  });

  describe('revocation list enforcement', () => {
    it('rejects a revoked token by jti while other tokens keep working', async () => {
      const a = service.issue({ userId: 'u1', tenantId: 't1' }).token;
      const b = service.issue({ userId: 'u1', tenantId: 't1' }).token;

      expect(await service.revoke(a)).toBe(true);
      expect(service.verify(a)).toEqual({ ok: false, reason: 'revoked' });
      expect(await service.verifyAsync(a)).toEqual({ ok: false, reason: 'revoked' });
      expect(service.verify(b).ok).toBe(true);
    });

    it('rejects every token of a revoked refresh family', async () => {
      const a = service.issue({ userId: 'u1', tenantId: 't1', familyId: 'fam-1' }).token;
      const b = service.issue({ userId: 'u1', tenantId: 't1', familyId: 'fam-2' }).token;
      await revocations.revokeFamily('fam-1');
      expect(service.verify(a)).toEqual({ ok: false, reason: 'revoked' });
      expect(service.verify(b).ok).toBe(true);
    });

    it('rejects tokens issued before a subject cut-off but accepts later ones', async () => {
      const before = service.issue({ userId: 'u1', tenantId: 't1' }).token;
      const otherUser = service.issue({ userId: 'u2', tenantId: 't1' }).token;
      await revocations.revokeSubject('u1');

      clock = new Date(clock.getTime() + 2000);
      const after = service.issue({ userId: 'u1', tenantId: 't1' }).token;

      expect(service.verify(before)).toEqual({ ok: false, reason: 'revoked' });
      expect(service.verify(otherUser).ok).toBe(true);
      expect(service.verify(after).ok).toBe(true);
    });

    it('consults the shared store so revocations reach other instances', async () => {
      const shared = new Map<string, string>();
      const store = {
        get: async (key: string) => shared.get(key) ?? null,
        set: async (key: string, value: string) => {
          shared.set(key, value);
          return 'OK';
        },
      };
      const instanceA = new AccessTokenRevocationList({ sharedStore: async () => store, now });
      const instanceB = new AccessTokenRevocationList({ sharedStore: async () => store, now });
      const serviceA = new JwtService({ secret: SECRET, revocationList: instanceA, now });
      const serviceB = new JwtService({ secret: SECRET, revocationList: instanceB, now });

      const token = serviceA.issue({ userId: 'u1', tenantId: 't1' }).token;
      await serviceA.revoke(token);

      expect(serviceB.verify(token).ok).toBe(true); // local cache on B knows nothing
      expect(await serviceB.verifyAsync(token)).toEqual({ ok: false, reason: 'revoked' });
    });

    it('drops revocation entries once the covered tokens could no longer be valid', async () => {
      const { token, claims } = service.issue({ userId: 'u1', tenantId: 't1' });
      await service.revoke(token);
      clock = new Date((claims.exp + 3600) * 1000);
      expect(revocations.isRevoked(claims)).toBe(false);
    });
  });

  describe('secret handling', () => {
    it('requires a strong secret', () => {
      expect(() => new JwtService({ secret: 'short' })).toThrow(/at least 32/);
      expect(() => resolveJwtSecret({ JWT_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(/at least 32/);
    });

    it('refuses to fall back to an ephemeral secret in production', () => {
      expect(() => resolveJwtSecret({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/must be set/);
      expect(resolveJwtSecret({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toHaveLength(96);
      expect(resolveJwtSecret({ JWT_SECRET: SECRET } as NodeJS.ProcessEnv)).toBe(SECRET);
    });
  });
});
