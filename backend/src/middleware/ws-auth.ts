import type { IncomingMessage } from 'node:http';
import { getJwtService, looksLikeJwt } from '../auth/jwt.js';

/** Signature, algorithm, lifetime and (locally cached) revocation are all checked. */
function isValidAccessToken(token: string): boolean {
  if (!looksLikeJwt(token)) return false;
  try {
    return getJwtService().verify(token).ok;
  } catch {
    return false;
  }
}

export interface WsAuthResult {
  valid: boolean;
  token?: string;
}

export interface WsAuthHandlerOptions {
  allowQueryParam?: boolean;
}

/**
 * Validates WebSocket upgrade request credentials.
 * Operates on the raw HTTP IncomingMessage — not an Express middleware.
 * Checks `Authorization: Bearer <jwt>` header first, then optionally
 * falls back to the `?token=` query string parameter.
 */
export function createWsAuthHandler(options?: WsAuthHandlerOptions): (req: IncomingMessage) => WsAuthResult {
  const allowQueryParam = options?.allowQueryParam ?? false;

  return (req: IncomingMessage): WsAuthResult => {
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (isValidAccessToken(token)) return { valid: true, token };
    }

    if (allowQueryParam) {
      try {
        const url = new URL(req.url ?? '', 'http://localhost');
        const token = url.searchParams.get('token') ?? '';
        if (isValidAccessToken(token)) return { valid: true, token };
      } catch {
        // Malformed URL — fall through to invalid
      }
    }

    return { valid: false };
  };
}
