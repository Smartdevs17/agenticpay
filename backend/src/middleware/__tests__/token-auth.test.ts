import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../config/rate-limit-redis.js', () => ({
  getSharedRateLimitRedis: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../services/auditService.js', () => ({
  auditService: { logAction: vi.fn().mockResolvedValue(undefined) },
}));

import { tokenAuthMiddleware } from '../token-auth.js';
import { createWsAuthHandler } from '../ws-auth.js';
import { JwtService, setJwtServiceForTesting } from '../../auth/jwt.js';
import { AccessTokenRevocationList } from '../../auth/access-token-revocation.js';

function makeReq(authorization?: string): Request {
  return {
    headers: authorization ? { authorization } : {},
    socket: { remoteAddress: '127.0.0.1' },
    path: '/x',
  } as unknown as Request;
}

async function run(req: Request): Promise<unknown> {
  let forwarded: unknown = 'not-called';
  await tokenAuthMiddleware(req, {} as Response, (err?: unknown) => {
    forwarded = err;
  });
  return forwarded;
}

describe('tokenAuthMiddleware — Issue #1014', () => {
  let service: JwtService;
  let revocations: AccessTokenRevocationList;

  beforeEach(() => {
    revocations = new AccessTokenRevocationList({ sharedStore: async () => null });
    service = new JwtService({ secret: 'k'.repeat(40), revocationList: revocations });
    setJwtServiceForTesting(service);
  });

  afterEach(() => setJwtServiceForTesting(undefined));

  it('is a no-op without a bearer header', async () => {
    expect(await run(makeReq())).toBeUndefined();
  });

  it('attaches verified claims for a valid token', async () => {
    const { token } = service.issue({ userId: 'u1', tenantId: 't1', role: 'admin' });
    const req = makeReq(`Bearer ${token}`);
    expect(await run(req)).toBeUndefined();
    expect(req.accessToken).toBe(token);
    expect(req.accessTokenClaims).toMatchObject({ sub: 'u1', tenantId: 't1', role: 'admin' });
  });

  it('rejects legacy opaque tokens that carry no verifiable claims', async () => {
    const err = (await run(makeReq(`Bearer at_${'a'.repeat(64)}`))) as { statusCode: number; code: string };
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('TOKEN_MALFORMED');
  });

  it('rejects forged and revoked tokens', async () => {
    const other = new JwtService({ secret: 'z'.repeat(40) });
    const forged = (await run(makeReq(`Bearer ${other.issue({ userId: 'u1', tenantId: 't1' }).token}`))) as {
      code: string;
    };
    expect(forged.code).toBe('TOKEN_INVALID');

    const { token } = service.issue({ userId: 'u1', tenantId: 't1' });
    await service.revoke(token);
    const revoked = (await run(makeReq(`Bearer ${token}`))) as { code: string };
    expect(revoked.code).toBe('TOKEN_REVOKED');
  });

  it('applies the same verification to WebSocket upgrades', async () => {
    const handler = createWsAuthHandler({ allowQueryParam: true });
    const { token } = service.issue({ userId: 'u1', tenantId: 't1' });

    expect(handler({ headers: { authorization: `Bearer ${token}` }, url: '/' } as any)).toEqual({ valid: true, token });
    expect(handler({ headers: {}, url: `/?token=${token}` } as any)).toEqual({ valid: true, token });
    expect(handler({ headers: { authorization: `Bearer at_${'a'.repeat(64)}` }, url: '/' } as any).valid).toBe(false);

    await service.revoke(token);
    expect(handler({ headers: { authorization: `Bearer ${token}` }, url: '/' } as any).valid).toBe(false);
  });
});
