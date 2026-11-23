/**
 * Short-lived service tokens bound to mutual TLS, for worker → backend calls (#1474).
 *
 * The Cloudflare edge worker (`workers/`) calls this API on behalf of users and
 * on its own schedule. Before this module those calls were indistinguishable
 * from any other client: a request that claimed to come from the edge (for
 * example by setting `X-Forwarded-For`) had to be believed or ignored.
 *
 * A worker now proves itself with two things on every call:
 *
 *  1. A service token in `X-Service-Token`: a compact JWS signed with the
 *     worker's Ed25519 key (`alg: EdDSA`). It lives at most
 *     `MAX_SERVICE_TOKEN_TTL_SECONDS`, is single-use (`jti`), and names the
 *     HTTP method and path it was minted for (`htm`/`htu`), so a captured
 *     token is useless for any other request.
 *  2. The TLS client certificate the worker presented (Cloudflare
 *     `mtls_certificates` binding). The token carries the certificate's
 *     SHA-256 thumbprint in `cnf["x5t#S256"]` (RFC 8705), so a token is only
 *     accepted on a connection authenticated with that certificate.
 *
 * The backend only holds public keys, so its configuration cannot be used to
 * mint tokens. Keys are scoped: each key belongs to one service and may only
 * grant the scopes listed for it.
 *
 * Rollout is controlled by `SERVICE_AUTH_MODE`:
 *  - `off`: tokens are ignored.
 *  - `optional` (default): tokens are verified when present and failures are
 *    logged, but nothing is rejected. Deploy the worker in this mode and watch
 *    the logs/stats until every call verifies.
 *  - `enforce`: a present-but-invalid token is rejected with 401, and routes
 *    guarded by `requireServiceToken` reject callers without one.
 */

import { createHash, createPublicKey, verify as verifySignature, X509Certificate, type KeyObject } from 'node:crypto';
import type { TLSSocket } from 'node:tls';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from './errorHandler.js';
import { createModuleLogger } from './logger.js';

const log = createModuleLogger('service-auth');

export const SERVICE_TOKEN_HEADER = 'x-service-token';
export const SERVICE_TOKEN_TYPE = 'svc+jwt';
export const SERVICE_TOKEN_AUDIENCE = 'agenticpay-backend';
export const MAX_SERVICE_TOKEN_TTL_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 30;

/** Scope that lets a service report the end-user's IP (`X-Real-IP`). */
export const SCOPE_FORWARD_CLIENT_IP = 'edge:forward-client-ip';

export type ServiceAuthMode = 'off' | 'optional' | 'enforce';

export interface ServiceKey {
  kid: string;
  /** The only `iss` this key may sign for. */
  service: string;
  /** Ed25519 public key: PEM, or base64 DER (SPKI). */
  publicKey: string;
  /** Upper bound on the scopes a token signed with this key may carry. */
  scopes: string[];
  /** Optional certificate pins (SHA-256 thumbprints, base64url). Empty = any certificate the TLS layer authorized. */
  certThumbprints?: string[];
  /** ISO time after which the key is no longer accepted. */
  notAfter?: string;
}

export interface ServiceTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  scope: string;
  htm: string;
  htu: string;
  cnf: { 'x5t#S256': string };
}

export interface ServicePrincipal {
  service: string;
  subject: string;
  scopes: string[];
  tokenId: string;
  keyId: string;
  certThumbprint: string;
  /** End-user IP reported by the service, only with `edge:forward-client-ip`. */
  clientIp?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express augments its Request type through this namespace.
  namespace Express {
    interface Request {
      /** Set when the request carried a valid service token (#1474). */
      service?: ServicePrincipal;
    }
  }
}

export class ServiceAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ServiceAuthError';
  }
}

export interface ClientCertificateEvidence {
  /** SHA-256 thumbprint of the DER certificate, base64url. */
  thumbprint: string;
  source: 'tls' | 'proxy';
}

export interface ServiceAuthOptions {
  mode?: ServiceAuthMode;
  keys?: ServiceKey[];
  /**
   * Header a TLS-terminating proxy uses to pass the verified client
   * certificate (URL-escaped PEM, e.g. nginx `$ssl_client_escaped_cert`) or its
   * SHA-256 fingerprint (hex or base64url). Unset = only direct TLS counts.
   */
  clientCertHeader?: string;
  /** Header carrying the proxy's verification result; must equal `SUCCESS` when set. */
  clientVerifyHeader?: string;
  /** Peers allowed to send the certificate headers. Empty = any peer (only safe if the backend is reachable solely through the proxy). */
  trustedProxies?: string[];
  now?: () => number;
}

export function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new ServiceAuthError('Malformed service token', 'SERVICE_TOKEN_MALFORMED');
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** RFC 8705 `x5t#S256`: base64url SHA-256 of the DER certificate. */
export function certificateThumbprint(der: Buffer): string {
  return base64UrlEncode(createHash('sha256').update(der).digest());
}

function parsePublicKey(value: string): KeyObject {
  const trimmed = value.trim();
  const key = trimmed.startsWith('-----BEGIN')
    ? createPublicKey(trimmed)
    : createPublicKey({ key: Buffer.from(trimmed, 'base64'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`service key must be Ed25519, got ${key.asymmetricKeyType}`);
  return key;
}

function normalizeFingerprint(value: string): string | undefined {
  const raw = value.trim();
  const hex = raw.replace(/:/g, '');
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return base64UrlEncode(Buffer.from(hex, 'hex'));
  if (/^[A-Za-z0-9_-]{43}$/.test(raw)) return raw;
  return undefined;
}

/** Thumbprint from a proxy header holding a (possibly URL-escaped) PEM or a fingerprint. */
export function thumbprintFromHeader(value: string): string | undefined {
  let decoded = value.trim();
  if (decoded.includes('%')) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return undefined;
    }
  }
  if (decoded.includes('-----BEGIN CERTIFICATE-----')) {
    try {
      return certificateThumbprint(new X509Certificate(decoded).raw);
    } catch {
      return undefined;
    }
  }
  return normalizeFingerprint(decoded);
}

interface LoadedKey extends ServiceKey {
  key: KeyObject;
  notAfterMs?: number;
}

export class ServiceTokenVerifier {
  readonly mode: ServiceAuthMode;
  private readonly keys = new Map<string, LoadedKey>();
  private readonly usedTokenIds = new Map<string, number>();
  private readonly now: () => number;
  private readonly counters = new Map<string, number>();

  constructor(private readonly options: ServiceAuthOptions = {}) {
    this.mode = options.mode ?? 'optional';
    this.now = options.now ?? Date.now;
    for (const key of options.keys ?? []) this.addKey(key);
  }

  addKey(key: ServiceKey): void {
    this.keys.set(key.kid, {
      ...key,
      key: parsePublicKey(key.publicKey),
      notAfterMs: key.notAfter ? Date.parse(key.notAfter) : undefined,
    });
  }

  removeKey(kid: string): boolean {
    return this.keys.delete(kid);
  }

  /** The client certificate the connection was authenticated with, if any. */
  clientCertificate(req: Request): ClientCertificateEvidence | undefined {
    const socket = req.socket as Partial<TLSSocket> | undefined;
    if (socket?.encrypted && socket.authorized && typeof socket.getPeerCertificate === 'function') {
      const cert = socket.getPeerCertificate();
      if (cert?.raw) return { thumbprint: certificateThumbprint(cert.raw), source: 'tls' };
    }

    const { clientCertHeader, clientVerifyHeader, trustedProxies = [] } = this.options;
    if (!clientCertHeader) return undefined;
    const peer = req.socket?.remoteAddress ?? '';
    if (trustedProxies.length > 0 && !trustedProxies.includes(peer.replace(/^::ffff:/, ''))) return undefined;
    if (clientVerifyHeader && req.get(clientVerifyHeader) !== 'SUCCESS') return undefined;
    const value = req.get(clientCertHeader);
    const thumbprint = value ? thumbprintFromHeader(value) : undefined;
    return thumbprint ? { thumbprint, source: 'proxy' } : undefined;
  }

  /** Verify a token against the request it arrived on. Throws ServiceAuthError. */
  verify(token: string, req: Request): ServicePrincipal {
    const parts = token.split('.');
    if (parts.length !== 3) throw new ServiceAuthError('Malformed service token', 'SERVICE_TOKEN_MALFORMED');
    const [headerB64, payloadB64, signatureB64] = parts;

    let header: { alg?: string; typ?: string; kid?: string };
    let claims: Partial<ServiceTokenClaims>;
    try {
      header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
      claims = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
    } catch (error) {
      if (error instanceof ServiceAuthError) throw error;
      throw new ServiceAuthError('Malformed service token', 'SERVICE_TOKEN_MALFORMED');
    }

    if (header.alg !== 'EdDSA' || header.typ !== SERVICE_TOKEN_TYPE) {
      throw new ServiceAuthError('Unsupported service token type', 'SERVICE_TOKEN_MALFORMED');
    }
    const key = header.kid ? this.keys.get(header.kid) : undefined;
    if (!key) throw new ServiceAuthError('Unknown service key', 'SERVICE_TOKEN_UNKNOWN_KEY');

    const nowMs = this.now();
    if (key.notAfterMs !== undefined && nowMs >= key.notAfterMs) {
      throw new ServiceAuthError('Service key has expired', 'SERVICE_TOKEN_UNKNOWN_KEY');
    }

    const signature = base64UrlDecode(signatureB64);
    const signed = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
    if (!verifySignature(null, signed, key.key, signature)) {
      throw new ServiceAuthError('Invalid service token signature', 'SERVICE_TOKEN_INVALID');
    }

    // Signature is good; now the claims.
    const now = Math.floor(nowMs / 1000);
    const { iss, sub, aud, iat, exp, jti, scope, htm, htu, cnf } = claims;
    if (typeof iat !== 'number' || typeof exp !== 'number' || typeof jti !== 'string' || !jti) {
      throw new ServiceAuthError('Service token is missing required claims', 'SERVICE_TOKEN_MALFORMED');
    }
    if (iss !== key.service) throw new ServiceAuthError('Service token issuer does not match its key', 'SERVICE_TOKEN_INVALID');
    if (aud !== SERVICE_TOKEN_AUDIENCE) throw new ServiceAuthError('Service token audience mismatch', 'SERVICE_TOKEN_INVALID');
    if (exp - iat > MAX_SERVICE_TOKEN_TTL_SECONDS || exp <= iat) {
      throw new ServiceAuthError('Service token lifetime exceeds the maximum', 'SERVICE_TOKEN_TOO_LONG_LIVED');
    }
    if (iat > now + CLOCK_SKEW_SECONDS) throw new ServiceAuthError('Service token issued in the future', 'SERVICE_TOKEN_INVALID');
    if (exp + CLOCK_SKEW_SECONDS <= now) throw new ServiceAuthError('Service token has expired', 'SERVICE_TOKEN_EXPIRED');

    if (htm !== req.method.toUpperCase() || htu !== req.originalUrl.split('?')[0]) {
      throw new ServiceAuthError('Service token was minted for a different request', 'SERVICE_TOKEN_WRONG_REQUEST');
    }

    const scopes = typeof scope === 'string' ? scope.split(' ').filter(Boolean) : [];
    const unauthorized = scopes.filter((s) => !key.scopes.includes(s));
    if (unauthorized.length > 0) {
      throw new ServiceAuthError(`Service key may not grant: ${unauthorized.join(', ')}`, 'SERVICE_TOKEN_SCOPE');
    }

    const bound = cnf?.['x5t#S256'];
    if (!bound) throw new ServiceAuthError('Service token is not bound to a certificate', 'SERVICE_TOKEN_UNBOUND');
    const presented = this.clientCertificate(req);
    if (!presented) throw new ServiceAuthError('Mutual TLS client certificate required', 'SERVICE_MTLS_REQUIRED');
    if (presented.thumbprint !== bound) {
      throw new ServiceAuthError('Client certificate does not match the service token', 'SERVICE_MTLS_MISMATCH');
    }
    if (key.certThumbprints?.length && !key.certThumbprints.includes(presented.thumbprint)) {
      throw new ServiceAuthError('Client certificate is not pinned for this service key', 'SERVICE_MTLS_MISMATCH');
    }

    // Single use: remember the ID until the token could no longer verify.
    this.sweepTokenIds(now);
    const replayKey = `${key.kid}:${jti}`;
    if (this.usedTokenIds.has(replayKey)) throw new ServiceAuthError('Service token was already used', 'SERVICE_TOKEN_REPLAY');
    this.usedTokenIds.set(replayKey, exp + CLOCK_SKEW_SECONDS);

    const realIp = req.get('x-real-ip')?.trim();
    return {
      service: iss,
      subject: typeof sub === 'string' ? sub : iss,
      scopes,
      tokenId: jti,
      keyId: key.kid,
      certThumbprint: presented.thumbprint,
      clientIp: scopes.includes(SCOPE_FORWARD_CLIENT_IP) && realIp ? realIp : undefined,
    };
  }

  /** Counters since start-up: `verified`, `missing`, and one per failure code. */
  stats(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  observe(outcome: string): void {
    this.counters.set(outcome, (this.counters.get(outcome) ?? 0) + 1);
  }

  private sweepTokenIds(now: number): void {
    if (this.usedTokenIds.size < 1_000) return;
    for (const [id, expiresAt] of this.usedTokenIds) {
      if (expiresAt <= now) this.usedTokenIds.delete(id);
    }
  }
}

// ── Configuration ────────────────────────────────────────────────────────────

function parseMode(value: string | undefined): ServiceAuthMode {
  const mode = (value ?? 'optional').toLowerCase();
  if (mode === 'off' || mode === 'optional' || mode === 'enforce') return mode;
  throw new Error(`SERVICE_AUTH_MODE must be off, optional or enforce (got "${value}")`);
}

/** Build a verifier from `SERVICE_AUTH_*` / `SERVICE_TOKEN_KEYS` environment variables. */
export function serviceAuthFromEnv(env: NodeJS.ProcessEnv = process.env): ServiceTokenVerifier {
  const keys = env.SERVICE_TOKEN_KEYS ? (JSON.parse(env.SERVICE_TOKEN_KEYS) as ServiceKey[]) : [];
  const list = (value?: string) =>
    (value ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  return new ServiceTokenVerifier({
    mode: parseMode(env.SERVICE_AUTH_MODE),
    keys,
    clientCertHeader: env.SERVICE_AUTH_CLIENT_CERT_HEADER || undefined,
    clientVerifyHeader: env.SERVICE_AUTH_CLIENT_VERIFY_HEADER || undefined,
    trustedProxies: list(env.SERVICE_AUTH_TRUSTED_PROXIES),
  });
}

let sharedVerifier: ServiceTokenVerifier | undefined;

export function getServiceTokenVerifier(): ServiceTokenVerifier {
  sharedVerifier ??= serviceAuthFromEnv();
  return sharedVerifier;
}

/** Replace the shared verifier (tests, or reload after key rotation). Pass nothing to reset. */
export function setServiceTokenVerifier(verifier?: ServiceTokenVerifier): void {
  sharedVerifier = verifier;
}

// ── Middleware ───────────────────────────────────────────────────────────────

/**
 * Verifies `X-Service-Token` on every request that carries one and sets
 * `req.service`. Mount once, early. A bad token is rejected only in
 * `enforce` mode; in `optional` mode it is logged and the request continues
 * unauthenticated.
 */
export function serviceAuthentication(verifier?: ServiceTokenVerifier): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const v = verifier ?? getServiceTokenVerifier();
    delete req.service;
    const token = req.get(SERVICE_TOKEN_HEADER);
    if (v.mode === 'off' || !token) return next();

    try {
      req.service = v.verify(token, req);
      v.observe('verified');
      log.debug({ service: req.service.service, keyId: req.service.keyId, path: req.path }, 'Service token verified');
      return next();
    } catch (error) {
      const code = error instanceof ServiceAuthError ? error.code : 'SERVICE_TOKEN_INVALID';
      v.observe(code);
      log.warn({ code, path: req.path, mode: v.mode, peer: req.socket?.remoteAddress }, 'Service token rejected');
      if (v.mode === 'enforce') {
        return next(new AppError(401, 'Invalid service credentials', code));
      }
      return next();
    }
  };
}

/**
 * Guard a route that only services should call. Requires a verified token
 * with `scope` in `enforce` mode; in `optional` mode it logs what would have
 * been rejected.
 */
export function requireServiceToken(scope: string, verifier?: ServiceTokenVerifier): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const v = verifier ?? getServiceTokenVerifier();
    if (v.mode === 'off') return next();

    let failure: AppError | undefined;
    if (!req.service) {
      v.observe('missing');
      failure = new AppError(401, 'Service credentials required', 'SERVICE_AUTH_REQUIRED');
    } else if (!req.service.scopes.includes(scope)) {
      v.observe('insufficient_scope');
      failure = new AppError(403, `Service token lacks scope ${scope}`, 'SERVICE_TOKEN_SCOPE');
    }

    if (!failure) return next();
    log.warn({ code: failure.code, scope, path: req.path, mode: v.mode }, 'Service route called without valid credentials');
    return next(v.mode === 'enforce' ? failure : undefined);
  };
}
