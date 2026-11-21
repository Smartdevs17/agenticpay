/**
 * Hardened JWT access tokens — Issue #1014
 *
 * Access tokens used to be opaque random strings that were only checked for *shape*, so
 * any well-formed string was accepted and nothing could be revoked. They are now signed
 * JWTs with:
 *
 * - Short lifetimes: 15 minutes by default (`JWT_ACCESS_TOKEN_TTL_SECONDS`), clamped to
 *   [1 minute, 1 hour]. A token whose own `exp - iat` exceeds the ceiling is rejected
 *   even if correctly signed.
 * - A pinned algorithm: only `HS256` is accepted. `none`, asymmetric algorithms (the
 *   classic RS/HS confusion) and missing headers are rejected before any signature work.
 * - Strict claims: `iss`, `aud`, `sub`, `jti`, `iat` and `exp` are required; `nbf` is
 *   honoured; a small clock-skew allowance applies.
 * - Constant-time signature comparison and a minimum secret length.
 * - Key rotation: `kid` selects the current or previous secret (`JWT_SECRET_PREVIOUS`).
 * - Revocation: every verified token is checked against the access-token revocation
 *   list by `jti`, by refresh-token family (`fid`) and by subject cut-off.
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { accessTokenRevocationList, type AccessTokenRevocationList } from './access-token-revocation.js';

export const JWT_ALGORITHM = 'HS256';
export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const MIN_ACCESS_TOKEN_TTL_SECONDS = 60;
export const MAX_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const DEFAULT_CLOCK_SKEW_SECONDS = 30;
export const MIN_JWT_SECRET_LENGTH = 32;
export const DEFAULT_JWT_ISSUER = 'agenticpay';
export const DEFAULT_JWT_AUDIENCE = 'agenticpay-api';

export interface AccessTokenClaims {
  iss: string;
  aud: string;
  /** Subject: the user id. */
  sub: string;
  /** Unique token id, used for revocation. */
  jti: string;
  iat: number;
  nbf?: number;
  exp: number;
  tenantId: string;
  role?: string;
  /** Refresh-token family this access token was minted from. */
  fid?: string;
}

export interface IssueAccessTokenInput {
  userId: string;
  tenantId: string;
  role?: string;
  familyId?: string;
  /** Requested lifetime; clamped to the allowed range. */
  ttlSeconds?: number;
}

export interface IssuedAccessToken {
  token: string;
  claims: AccessTokenClaims;
  expiresAt: Date;
}

export type JwtVerificationFailure =
  | 'malformed'
  | 'unsupported_algorithm'
  | 'unknown_key'
  | 'invalid_signature'
  | 'invalid_claims'
  | 'not_yet_valid'
  | 'expired'
  | 'lifetime_exceeded'
  | 'revoked';

export type JwtVerificationResult =
  | { ok: true; claims: AccessTokenClaims }
  | { ok: false; reason: JwtVerificationFailure };

export interface JwtServiceOptions {
  secret: string;
  previousSecret?: string;
  issuer?: string;
  audience?: string;
  ttlSeconds?: number;
  clockSkewSeconds?: number;
  revocationList?: AccessTokenRevocationList;
  now?: () => Date;
}

const CURRENT_KID = 'k1';
const PREVIOUS_KID = 'k0';

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function parseBase64UrlJson(segment: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('malformed');
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function clampTtl(ttlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds)) return DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  return Math.min(MAX_ACCESS_TOKEN_TTL_SECONDS, Math.max(MIN_ACCESS_TOKEN_TTL_SECONDS, Math.floor(ttlSeconds)));
}

function assertSecret(secret: string | undefined, name: string): void {
  if (typeof secret !== 'string' || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function isIntegerSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export class JwtService {
  private readonly keys: Map<string, string>;
  readonly issuer: string;
  readonly audience: string;
  readonly ttlSeconds: number;
  private readonly clockSkewSeconds: number;
  private readonly revocationList: AccessTokenRevocationList;
  private readonly now: () => Date;

  constructor(options: JwtServiceOptions) {
    assertSecret(options.secret, 'JWT_SECRET');
    if (options.previousSecret !== undefined) assertSecret(options.previousSecret, 'JWT_SECRET_PREVIOUS');

    this.keys = new Map([[CURRENT_KID, options.secret]]);
    if (options.previousSecret) this.keys.set(PREVIOUS_KID, options.previousSecret);
    this.issuer = options.issuer ?? DEFAULT_JWT_ISSUER;
    this.audience = options.audience ?? DEFAULT_JWT_AUDIENCE;
    this.ttlSeconds = clampTtl(options.ttlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS);
    this.clockSkewSeconds = Math.max(0, Math.min(options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS, 300));
    this.revocationList = options.revocationList ?? accessTokenRevocationList;
    this.now = options.now ?? (() => new Date());
  }

  /** Mints a signed access token. Lifetimes outside the allowed range are clamped. */
  issue(input: IssueAccessTokenInput): IssuedAccessToken {
    if (!isNonEmptyString(input.userId)) throw new Error('JWT_SUBJECT_REQUIRED');
    if (!isNonEmptyString(input.tenantId)) throw new Error('JWT_TENANT_REQUIRED');

    const iat = Math.floor(this.now().getTime() / 1000);
    const claims: AccessTokenClaims = {
      iss: this.issuer,
      aud: this.audience,
      sub: input.userId,
      jti: randomUUID(),
      iat,
      nbf: iat,
      exp: iat + clampTtl(input.ttlSeconds ?? this.ttlSeconds),
      tenantId: input.tenantId,
      ...(input.role ? { role: input.role } : {}),
      ...(input.familyId ? { fid: input.familyId } : {}),
    };

    const header = base64UrlJson({ alg: JWT_ALGORITHM, typ: 'JWT', kid: CURRENT_KID });
    const payload = base64UrlJson(claims);
    const signature = this.sign(`${header}.${payload}`, this.keys.get(CURRENT_KID)!);
    return { token: `${header}.${payload}.${signature}`, claims, expiresAt: new Date(claims.exp * 1000) };
  }

  /**
   * Verifies signature, algorithm, claims, lifetime and revocation. Uses only the local
   * revocation cache, so it is synchronous; `verifyAsync` also consults shared storage.
   */
  verify(token: string): JwtVerificationResult {
    const decoded = this.decodeAndCheck(token);
    if (!decoded.ok) return decoded;
    if (this.revocationList.isRevoked(decoded.claims)) return { ok: false, reason: 'revoked' };
    return decoded;
  }

  /** As `verify`, but also checks the shared (Redis) revocation list when configured. */
  async verifyAsync(token: string): Promise<JwtVerificationResult> {
    const decoded = this.decodeAndCheck(token);
    if (!decoded.ok) return decoded;
    if (await this.revocationList.isRevokedShared(decoded.claims)) return { ok: false, reason: 'revoked' };
    return decoded;
  }

  /** Revokes a single verified token until it would have expired anyway. */
  async revoke(token: string): Promise<boolean> {
    const decoded = this.decodeAndCheck(token);
    if (!decoded.ok) return false;
    await this.revocationList.revokeToken(decoded.claims.jti, new Date(decoded.claims.exp * 1000));
    return true;
  }

  private decodeAndCheck(token: string): JwtVerificationResult {
    if (typeof token !== 'string' || token.length > 4096) return { ok: false, reason: 'malformed' };
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) return { ok: false, reason: 'malformed' };
    const [headerSegment, payloadSegment, signatureSegment] = parts;

    let header: Record<string, unknown>;
    let payload: Record<string, unknown>;
    try {
      header = parseBase64UrlJson(headerSegment) as Record<string, unknown>;
      payload = parseBase64UrlJson(payloadSegment) as Record<string, unknown>;
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') {
      return { ok: false, reason: 'malformed' };
    }

    // Pin the algorithm before touching the signature: never let the token choose it.
    if (header.alg !== JWT_ALGORITHM || (header.typ !== undefined && header.typ !== 'JWT')) {
      return { ok: false, reason: 'unsupported_algorithm' };
    }
    if (header.crit !== undefined) return { ok: false, reason: 'unsupported_algorithm' };

    const secret = typeof header.kid === 'string' ? this.keys.get(header.kid) : undefined;
    if (!secret) return { ok: false, reason: 'unknown_key' };

    const expected = Buffer.from(this.sign(`${headerSegment}.${payloadSegment}`, secret));
    const actual = Buffer.from(signatureSegment);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, reason: 'invalid_signature' };
    }

    const claims = payload as Partial<AccessTokenClaims>;
    if (
      claims.iss !== this.issuer ||
      claims.aud !== this.audience ||
      !isNonEmptyString(claims.sub) ||
      !isNonEmptyString(claims.jti) ||
      !isNonEmptyString(claims.tenantId) ||
      !isIntegerSeconds(claims.iat) ||
      !isIntegerSeconds(claims.exp) ||
      (claims.nbf !== undefined && !isIntegerSeconds(claims.nbf)) ||
      (claims.role !== undefined && !isNonEmptyString(claims.role)) ||
      (claims.fid !== undefined && !isNonEmptyString(claims.fid))
    ) {
      return { ok: false, reason: 'invalid_claims' };
    }

    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    if (claims.exp - claims.iat > MAX_ACCESS_TOKEN_TTL_SECONDS || claims.exp <= claims.iat) {
      return { ok: false, reason: 'lifetime_exceeded' };
    }
    if (claims.iat > nowSeconds + this.clockSkewSeconds) return { ok: false, reason: 'not_yet_valid' };
    if (claims.nbf !== undefined && claims.nbf > nowSeconds + this.clockSkewSeconds) {
      return { ok: false, reason: 'not_yet_valid' };
    }
    if (claims.exp <= nowSeconds - this.clockSkewSeconds) return { ok: false, reason: 'expired' };

    return { ok: true, claims: claims as AccessTokenClaims };
  }

  private sign(input: string, secret: string): string {
    return createHmac('sha256', secret).update(input).digest('base64url');
  }
}

let ephemeralSecret: string | undefined;

/**
 * Resolves the signing secret from `JWT_SECRET`. Production refuses to start without a
 * strong secret; other environments fall back to a per-process random secret (tokens
 * then do not survive a restart, which is the safe failure mode).
 */
export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.JWT_SECRET;
  if (configured) {
    assertSecret(configured, 'JWT_SECRET');
    return configured;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  ephemeralSecret ??= randomBytes(48).toString('hex');
  return ephemeralSecret;
}

export function createJwtServiceFromEnv(env: NodeJS.ProcessEnv = process.env): JwtService {
  const ttl = Number(env.JWT_ACCESS_TOKEN_TTL_SECONDS);
  return new JwtService({
    secret: resolveJwtSecret(env),
    ...(env.JWT_SECRET_PREVIOUS ? { previousSecret: env.JWT_SECRET_PREVIOUS } : {}),
    ...(env.JWT_ISSUER ? { issuer: env.JWT_ISSUER } : {}),
    ...(env.JWT_AUDIENCE ? { audience: env.JWT_AUDIENCE } : {}),
    ...(Number.isFinite(ttl) && ttl > 0 ? { ttlSeconds: ttl } : {}),
  });
}

let sharedService: JwtService | undefined;

/** Lazily created so a missing production secret fails at first use with a clear error. */
export function getJwtService(): JwtService {
  sharedService ??= createJwtServiceFromEnv();
  return sharedService;
}

/** Replaces the shared service. Intended for tests. */
export function setJwtServiceForTesting(service: JwtService | undefined): void {
  sharedService = service;
}

/** Cheap structural check used to route a bearer credential to JWT verification. */
export function looksLikeJwt(token: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
}
