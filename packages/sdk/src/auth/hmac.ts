// HMAC-SHA256 request signing for server-to-server calls — Issue #510
//
// Usage:
//   import { HmacSigner } from '@agenticpay/sdk/auth/hmac';
//   const signer = new HmacSigner({ keyId: 'key_abc', secret: 'your-secret' });
//   const headers = signer.sign({ method: 'POST', path: '/api/v1/payments', body: payload });
//   fetch(url, { headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

import { createHmac, createHash, randomBytes } from 'crypto';

export interface HmacSignerOptions {
  keyId: string;
  /** The raw secret (not the hash) — keep this server-side only */
  secret: string;
}

export interface SignOptions {
  method: string;
  path: string;
  body?: unknown;
}

export interface SignedHeaders {
  'x-signature': string;
  'x-timestamp': string;
  'x-nonce': string;
}

function bodyHash(body: unknown): string {
  const raw = body === undefined || body === null
    ? ''
    : typeof body === 'string' ? body : JSON.stringify(body);
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function buildPayload(method: string, path: string, timestamp: string, nonce: string, body: unknown): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash(body)}`;
}

export class HmacSigner {
  private readonly keyId: string;
  private readonly secret: string;

  constructor(opts: HmacSignerOptions) {
    this.keyId = opts.keyId;
    this.secret = opts.secret;
  }

  /** Generate signed request headers. Call once per request — nonce must be unique. */
  sign(opts: SignOptions): SignedHeaders {
    const timestamp = String(Date.now());
    const nonce = randomBytes(16).toString('hex');
    const payload = buildPayload(opts.method, opts.path, timestamp, nonce, opts.body);
    const sig = createHmac('sha256', this.secret).update(payload, 'utf8').digest('hex');

    return {
      'x-signature': `kid=${this.keyId};hmac-sha256=${sig}`,
      'x-timestamp': timestamp,
      'x-nonce': nonce,
    };
  }
}

/** Convenience: sign a fetch request options object in place. */
export function signFetchRequest(
  signer: HmacSigner,
  method: string,
  url: string,
  body?: unknown,
): SignedHeaders {
  const parsed = new URL(url, 'http://localhost');
  const path = parsed.pathname + parsed.search;
  return signer.sign({ method, path, body });
}
