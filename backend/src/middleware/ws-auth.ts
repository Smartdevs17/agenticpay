import type { IncomingMessage } from 'node:http';

// Opaque access token format: at_<64 lowercase hex chars>
const ACCESS_TOKEN_RE = /^at_[0-9a-f]{64}$/;

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
 * Checks `Authorization: Bearer at_<token>` header first, then optionally
 * falls back to the `?token=` query string parameter.
 */
export function createWsAuthHandler(options?: WsAuthHandlerOptions): (req: IncomingMessage) => WsAuthResult {
  const allowQueryParam = options?.allowQueryParam ?? false;

  return (req: IncomingMessage): WsAuthResult => {
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (ACCESS_TOKEN_RE.test(token)) return { valid: true, token };
    }

    if (allowQueryParam) {
      try {
        const url = new URL(req.url ?? '', 'http://localhost');
        const token = url.searchParams.get('token') ?? '';
        if (ACCESS_TOKEN_RE.test(token)) return { valid: true, token };
      } catch {
        // Malformed URL — fall through to invalid
      }
    }

    return { valid: false };
  };
}
