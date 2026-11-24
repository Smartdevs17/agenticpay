import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_JWT_TYPE = 'webhook+jwt';
export const WEBHOOK_JWT_AUDIENCE = 'agenticpay-webhooks';
export const WEBHOOK_JWT_ISSUER = 'agenticpay';
export const MAX_WEBHOOK_JWT_TTL_SECONDS = 300;
export const WEBHOOK_JWT_CLOCK_SKEW_SECONDS = 30;
export const MIN_WEBHOOK_JWT_SECRET_LENGTH = 32;

export type WebhookJwtRejectionReason =
  | 'malformed'
  | 'unsupported_algorithm'
  | 'invalid_signature'
  | 'invalid_claims'
  | 'invalid_issuer'
  | 'invalid_audience'
  | 'invalid_origin'
  | 'expired'
  | 'not_yet_valid'
  | 'lifetime_exceeded';

export interface WebhookJwtClaims {
  iss: string;
  aud: string;
  sub: string;
  origin: string;
  iat: number;
  exp: number;
  jti: string;
  provider?: string;
}

export interface WebhookJwtConfig {
  secret: string;
  issuer?: string;
  audience?: string;
  allowedOrigins: string[];
  now?: number;
  clockSkewSeconds?: number;
}

export type WebhookJwtVerificationResult =
  | { valid: true; claims: WebhookJwtClaims }
  | { valid: false; reason: WebhookJwtRejectionReason; error: string };

export interface SignWebhookJwtInput {
  secret: string;
  subject: string;
  origin: string;
  provider?: string;
  issuer?: string;
  audience?: string;
  ttlSeconds?: number;
  issuedAt?: number;
  jti?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url segment');
  return Buffer.from(value, 'base64url');
}

function encodeSegment(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function constantTimeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeOrigin(value: string): string {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Invalid webhook origin');
  }
  return parsed.origin.toLowerCase();
}

function assertNonEmpty(value: string | undefined, name: string, maxLength = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`${name} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

export function getWebhookJwtConfig(env: NodeJS.ProcessEnv = process.env): WebhookJwtConfig {
  const secret = env.WEBHOOK_JWT_SECRET ?? env.JWT_SECRET;
  if (!secret || secret.length < MIN_WEBHOOK_JWT_SECRET_LENGTH) {
    throw new Error(`WEBHOOK_JWT_SECRET must be at least ${MIN_WEBHOOK_JWT_SECRET_LENGTH} characters`);
  }

  const allowedOrigins = (env.WEBHOOK_JWT_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .map(normalizeOrigin);

  if (allowedOrigins.length === 0) {
    throw new Error('WEBHOOK_JWT_ALLOWED_ORIGINS must contain at least one origin');
  }

  return {
    secret,
    issuer: env.WEBHOOK_JWT_ISSUER || WEBHOOK_JWT_ISSUER,
    audience: env.WEBHOOK_JWT_AUDIENCE || WEBHOOK_JWT_AUDIENCE,
    allowedOrigins,
  };
}

export function signWebhookJwt(input: SignWebhookJwtInput): string {
  if (typeof input.secret !== 'string' || input.secret.length < MIN_WEBHOOK_JWT_SECRET_LENGTH) {
    throw new Error(`Webhook JWT secret must be at least ${MIN_WEBHOOK_JWT_SECRET_LENGTH} characters`);
  }

  const ttlSeconds = input.ttlSeconds ?? MAX_WEBHOOK_JWT_TTL_SECONDS;
  const issuedAt = input.issuedAt ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_WEBHOOK_JWT_TTL_SECONDS) {
    throw new Error(`ttlSeconds must be between 1 and ${MAX_WEBHOOK_JWT_TTL_SECONDS}`);
  }
  if (!Number.isInteger(issuedAt) || issuedAt < 0) {
    throw new Error('issuedAt must be a non-negative integer timestamp in seconds');
  }

  const payload = {
    iss: assertNonEmpty(input.issuer ?? WEBHOOK_JWT_ISSUER, 'issuer'),
    aud: assertNonEmpty(input.audience ?? WEBHOOK_JWT_AUDIENCE, 'audience'),
    sub: assertNonEmpty(input.subject, 'subject'),
    origin: normalizeOrigin(input.origin),
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    jti: assertNonEmpty(input.jti ?? randomUUID(), 'jti'),
    provider: input.provider === undefined ? undefined : assertNonEmpty(input.provider, 'provider'),
  };

  const header = encodeSegment({ alg: 'HS256', typ: WEBHOOK_JWT_TYPE });
  const body = encodeSegment(payload as unknown as Record<string, unknown>);
  const signingInput = `${header}.${body}`;
  const signature = createHmac('sha256', input.secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

export function isWebhookJwtToken(token: string): boolean {
  const segments = token.split('.');
  if (segments.length !== 3) return false;
  try {
    const header = JSON.parse(decodeBase64Url(segments[0]).toString('utf8')) as unknown;
    return isRecord(header) && header.typ === WEBHOOK_JWT_TYPE;
  } catch {
    return false;
  }
}

function parseClaims(value: unknown): WebhookJwtClaims | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.iss !== 'string' || typeof value.sub !== 'string' || typeof value.jti !== 'string') return undefined;
  if (typeof value.origin !== 'string' || typeof value.iat !== 'number' || typeof value.exp !== 'number') return undefined;
  if (!Number.isFinite(value.iat) || !Number.isFinite(value.exp)) return undefined;
  if (!Array.isArray(value.aud) && typeof value.aud !== 'string') return undefined;
  if (value.provider !== undefined && typeof value.provider !== 'string') return undefined;

  const audiences = typeof value.aud === 'string' ? [value.aud] : value.aud.filter((aud): aud is string => typeof aud === 'string');
  if (audiences.length === 0) return undefined;

  return {
    iss: value.iss,
    aud: audiences[0],
    sub: value.sub,
    origin: value.origin,
    iat: value.iat,
    exp: value.exp,
    jti: value.jti,
    provider: value.provider,
  };
}

export function verifyWebhookJwt(token: string, config: WebhookJwtConfig): WebhookJwtVerificationResult {
  const segments = token.split('.');
  if (segments.length !== 3) return { valid: false, reason: 'malformed', error: 'Webhook JWT must have three segments' };

  let header: Record<string, unknown>;
  let claims: WebhookJwtClaims | undefined;
  try {
    header = JSON.parse(decodeBase64Url(segments[0]).toString('utf8')) as Record<string, unknown>;
    claims = parseClaims(JSON.parse(decodeBase64Url(segments[1]).toString('utf8')) as unknown);
  } catch {
    return { valid: false, reason: 'malformed', error: 'Webhook JWT is malformed' };
  }

  if (!isRecord(header) || header.alg !== 'HS256' || header.typ !== WEBHOOK_JWT_TYPE) {
    return { valid: false, reason: 'unsupported_algorithm', error: 'Webhook JWT must use HS256 with typ webhook+jwt' };
  }

  let signature: Buffer;
  try {
    signature = decodeBase64Url(segments[2]);
  } catch {
    return { valid: false, reason: 'malformed', error: 'Webhook JWT signature is malformed' };
  }

  const expected = createHmac('sha256', config.secret).update(`${segments[0]}.${segments[1]}`).digest();
  if (!constantTimeEqual(signature, expected)) {
    return { valid: false, reason: 'invalid_signature', error: 'Webhook JWT signature is invalid' };
  }

  if (!claims) return { valid: false, reason: 'invalid_claims', error: 'Webhook JWT claims are invalid' };

  const issuer = config.issuer ?? WEBHOOK_JWT_ISSUER;
  const audience = config.audience ?? WEBHOOK_JWT_AUDIENCE;
  const audiences = typeof claims.aud === 'string' ? [claims.aud] : [claims.aud];
  if (claims.iss !== issuer) return { valid: false, reason: 'invalid_issuer', error: 'Webhook JWT issuer is invalid' };
  if (!audiences.includes(audience)) return { valid: false, reason: 'invalid_audience', error: 'Webhook JWT audience is invalid' };

  let origin: string;
  try {
    origin = normalizeOrigin(claims.origin);
  } catch {
    return { valid: false, reason: 'invalid_origin', error: 'Webhook JWT origin is invalid' };
  }
  if (!config.allowedOrigins.includes(origin)) {
    return { valid: false, reason: 'invalid_origin', error: 'Webhook JWT origin is not allowed' };
  }

  const now = config.now ?? Math.floor(Date.now() / 1000);
  const skew = config.clockSkewSeconds ?? WEBHOOK_JWT_CLOCK_SKEW_SECONDS;
  if (claims.iat > now + skew) return { valid: false, reason: 'not_yet_valid', error: 'Webhook JWT is not yet valid' };
  if (claims.exp <= now - skew) return { valid: false, reason: 'expired', error: 'Webhook JWT has expired' };
  if (claims.exp <= claims.iat || claims.exp - claims.iat > MAX_WEBHOOK_JWT_TTL_SECONDS) {
    return { valid: false, reason: 'lifetime_exceeded', error: 'Webhook JWT lifetime exceeds the allowed maximum' };
  }

  return { valid: true, claims: { ...claims, origin } };
}

export const validateWebhookJwt = verifyWebhookJwt;
