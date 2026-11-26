/**
 * Request context for portal server actions.
 *
 * Server actions do not receive a `Request`, so the session cookies and the
 * trace/request ids are read once from `next/headers` and passed into the same
 * core functions the HTTP route handlers use. Keeping this conversion in one
 * place means both entry points enforce identical authentication rules.
 */
import { OPERATOR_COOKIE, STEP_UP_COOKIE, requestCorrelation, readCookie, type HeaderSource } from '@/app/admin/guard';
import type { SecurityEventContext } from '@/lib/webauthn';

export interface ActionContext {
  operatorToken: string | null;
  stepUpToken: string | null;
  correlation: SecurityEventContext;
}

export function contextFromHeaders(headers: HeaderSource): ActionContext {
  return {
    operatorToken: readCookie(headers, OPERATOR_COOKIE),
    stepUpToken: readCookie(headers, STEP_UP_COOKIE),
    correlation: requestCorrelation(headers),
  };
}

export function contextFromRequest(request: Request): ActionContext {
  return contextFromHeaders(request.headers);
}
