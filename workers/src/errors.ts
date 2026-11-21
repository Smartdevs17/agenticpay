/**
 * workers/src/errors.ts — Edge Error Adapter for Cloudflare Workers
 *
 * Implements the Issue #1402 unified error response contract:
 * {
 *   "error": {
 *     "code": "ERR_...",
 *     "message": "...",
 *     "status": 401,
 *     "requestId": "...",
 *     "retryAfter": 30
 *   }
 * }
 */

export interface EdgeErrorPayload {
  code: string;
  message: string;
  status: number;
  details?: unknown;
  requestId?: string;
  retryAfter?: number;
}

export interface EdgeErrorResponse {
  error: EdgeErrorPayload;
}

const CANONICAL_CODES: Record<string, string> = {
  UNAUTHORIZED: 'ERR_AUTH_UNAUTHENTICATED',
  FORBIDDEN: 'ERR_AUTH_FORBIDDEN',
  RATE_LIMIT_EXCEEDED: 'ERR_RATE_LIMIT_EXCEEDED',
  NOT_FOUND: 'ERR_RESOURCE_NOT_FOUND',
  EDGE_ERROR: 'ERR_BLOCKCHAIN_TRANSACTION_FAILED',
  INTERNAL_ERROR: 'ERR_INTERNAL',
};

export function resolveEdgeCode(code: string, status: number): string {
  if (code.startsWith('ERR_')) return code;
  if (CANONICAL_CODES[code]) return CANONICAL_CODES[code];
  if (status === 401) return 'ERR_AUTH_UNAUTHENTICATED';
  if (status === 403) return 'ERR_AUTH_FORBIDDEN';
  if (status === 400) return 'ERR_VALIDATION_FAILED';
  if (status === 404) return 'ERR_RESOURCE_NOT_FOUND';
  if (status === 429) return 'ERR_RATE_LIMIT_EXCEEDED';
  if (status === 502) return 'ERR_BLOCKCHAIN_TRANSACTION_FAILED';
  return 'ERR_INTERNAL';
}

export function formatEdgeError(options: {
  code?: string;
  message: string;
  status: number;
  details?: unknown;
  requestId?: string;
  retryAfter?: number;
}): EdgeErrorResponse {
  const code = resolveEdgeCode(options.code || '', options.status);
  const payload: EdgeErrorPayload = {
    code,
    message: options.message,
    status: options.status,
  };

  if (options.details !== undefined) payload.details = options.details;
  if (options.requestId) payload.requestId = options.requestId;
  if (options.retryAfter !== undefined) payload.retryAfter = options.retryAfter;

  return { error: payload };
}

export function createEdgeErrorResponse(
  options: {
    code?: string;
    message: string;
    status: number;
    details?: unknown;
    requestId?: string;
    retryAfter?: number;
  },
  extraHeaders: Record<string, string> = {}
): Response {
  const body = formatEdgeError(options);
  return new Response(JSON.stringify(body), {
    status: options.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  });
}
