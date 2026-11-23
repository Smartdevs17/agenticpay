/**
 * Worker → backend authentication (#1474).
 *
 * Every call the edge worker makes to the backend carries a fresh service
 * token in `X-Service-Token` and, when the `BACKEND_MTLS` binding is
 * configured, goes out over that binding so the connection presents the
 * worker's client certificate. The token is:
 *
 *  - signed with the worker's Ed25519 key (`SERVICE_TOKEN_PRIVATE_KEY`); the
 *    backend only holds the public half (`SERVICE_TOKEN_KEYS`),
 *  - valid for `SERVICE_TOKEN_TTL_SECONDS` (60 s by default, never more than
 *    300 s) and single-use,
 *  - bound to the request's method and path (`htm`/`htu`),
 *  - bound to the client certificate's SHA-256 thumbprint
 *    (`cnf["x5t#S256"]`, RFC 8705, from `SERVICE_MTLS_CERT_SHA256`).
 *
 * Verification lives in `backend/src/middleware/serviceAuth.ts`.
 */

export const SERVICE_TOKEN_HEADER = 'X-Service-Token';
export const SERVICE_TOKEN_AUDIENCE = 'agenticpay-backend';
export const DEFAULT_SERVICE_TOKEN_TTL_SECONDS = 60;
export const MAX_SERVICE_TOKEN_TTL_SECONDS = 300;
export const SERVICE_NAME = 'agenticpay-edge';

/** Subset of a Cloudflare `Fetcher` (mTLS certificate binding). */
export interface MtlsFetcher {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

export interface ServiceAuthEnv {
  /** Ed25519 private key, base64 PKCS#8 DER. Unset = calls go out unauthenticated. */
  SERVICE_TOKEN_PRIVATE_KEY?: string;
  /** Key ID registered with the backend. */
  SERVICE_TOKEN_KEY_ID?: string;
  /** SHA-256 thumbprint of the mTLS client certificate (hex or base64url). */
  SERVICE_MTLS_CERT_SHA256?: string;
  SERVICE_TOKEN_TTL_SECONDS?: string;
  /** `[[mtls_certificates]]` binding that presents the client certificate. */
  BACKEND_MTLS?: MtlsFetcher;
}

export interface MintOptions {
  method: string;
  /** Path the backend will see, without the query string. */
  path: string;
  scopes: string[];
  now?: number;
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value.replace(/\s+/g, ''));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

/** Normalise a hex (optionally colon-separated) or base64url SHA-256 thumbprint to base64url. */
export function normalizeThumbprint(value: string): string {
  const hex = value.trim().replace(/:/g, '');
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return base64UrlEncode(bytes);
  }
  if (/^[A-Za-z0-9_-]{43}$/.test(value.trim())) return value.trim();
  throw new Error('SERVICE_MTLS_CERT_SHA256 must be a SHA-256 thumbprint (hex or base64url)');
}

let warnedMissingMtls = false;

// Imported keys are reused for the isolate's lifetime.
const keyCache = new Map<string, Promise<CryptoKey>>();

function importSigningKey(pkcs8Base64: string): Promise<CryptoKey> {
  let key = keyCache.get(pkcs8Base64);
  if (!key) {
    key = crypto.subtle.importKey('pkcs8', base64ToArrayBuffer(pkcs8Base64), { name: 'Ed25519' }, false, ['sign']);
    keyCache.set(pkcs8Base64, key);
  }
  return key;
}

export function isServiceAuthConfigured(env: ServiceAuthEnv): boolean {
  return Boolean(env.SERVICE_TOKEN_PRIVATE_KEY && env.SERVICE_TOKEN_KEY_ID && env.SERVICE_MTLS_CERT_SHA256);
}

/** Mint a single-use token for one backend request. */
export async function mintServiceToken(env: ServiceAuthEnv, options: MintOptions): Promise<string> {
  if (!isServiceAuthConfigured(env)) throw new Error('service token signing is not configured');

  const requestedTtl = Number(env.SERVICE_TOKEN_TTL_SECONDS ?? DEFAULT_SERVICE_TOKEN_TTL_SECONDS);
  const ttl = Math.min(
    Number.isFinite(requestedTtl) && requestedTtl > 0 ? Math.floor(requestedTtl) : DEFAULT_SERVICE_TOKEN_TTL_SECONDS,
    MAX_SERVICE_TOKEN_TTL_SECONDS,
  );
  const iat = Math.floor((options.now ?? Date.now()) / 1000);

  const header = { alg: 'EdDSA', typ: 'svc+jwt', kid: env.SERVICE_TOKEN_KEY_ID };
  const claims = {
    iss: SERVICE_NAME,
    sub: SERVICE_NAME,
    aud: SERVICE_TOKEN_AUDIENCE,
    iat,
    exp: iat + ttl,
    jti: crypto.randomUUID(),
    scope: options.scopes.join(' '),
    htm: options.method.toUpperCase(),
    htu: options.path,
    cnf: { 'x5t#S256': normalizeThumbprint(env.SERVICE_MTLS_CERT_SHA256!) },
  };

  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
  const key = await importSigningKey(env.SERVICE_TOKEN_PRIVATE_KEY!);
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * `fetch` for backend calls: adds a service token for this exact request and
 * sends it over the mTLS binding when one is configured. Without signing
 * configuration it behaves like plain `fetch`, so local development and the
 * backend's `optional` rollout mode keep working.
 */
export async function backendFetch(
  env: ServiceAuthEnv,
  url: string,
  init: RequestInit & { scopes: string[] },
): Promise<Response> {
  const { scopes, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);

  if (isServiceAuthConfigured(env)) {
    const token = await mintServiceToken(env, {
      method: requestInit.method ?? 'GET',
      path: new URL(url).pathname,
      scopes,
    });
    headers.set(SERVICE_TOKEN_HEADER, token);
  }

  if (!env.BACKEND_MTLS && isServiceAuthConfigured(env) && !warnedMissingMtls) {
    warnedMissingMtls = true;
    console.warn('[service-auth] BACKEND_MTLS binding missing: tokens are certificate-bound and will fail in enforce mode');
  }
  const transport = env.BACKEND_MTLS ?? { fetch: (input: string, opts?: RequestInit) => fetch(input, opts) };
  return transport.fetch(url, { ...requestInit, headers });
}
