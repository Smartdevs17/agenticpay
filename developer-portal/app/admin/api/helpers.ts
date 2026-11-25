/** Shared helpers for the admin ceremony route handlers. */
import { jsonResponse } from '@/app/admin/guard';
import { WebAuthnError } from '@/lib/webauthn';

/** Read a JSON request body, treating malformed JSON as absent. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Map a ceremony failure to an HTTP response. A verification or replay failure
 * is an authentication failure (401); a bad or stale challenge is a bad request
 * (400). Anything unexpected stays a generic 500 — never leak internals.
 */
export function ceremonyErrorResponse(error: unknown): Response {
  if (error instanceof WebAuthnError) {
    const unauthorized = error.code === 'VERIFICATION_FAILED' || error.code === 'COUNTER_REPLAYED';
    return jsonResponse(unauthorized ? 401 : 400, {
      error: error.code,
      message: error.message,
    });
  }
  return jsonResponse(500, { error: 'INTERNAL_ERROR', message: 'The ceremony could not be completed' });
}
