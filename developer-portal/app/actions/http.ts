/**
 * HTTP adapter for the typed ceremony actions. The admin API routes remain
 * available for non-browser clients, but they no longer contain any ceremony
 * logic: they translate a Request into an action context and an ActionResult
 * into a Response.
 */
import {
  STEP_UP_COOKIE,
  STEP_UP_COOKIE_PATH,
  jsonResponse,
  serializeCookie,
} from '@/app/admin/guard';
import type { ActionErrorCode, ActionResult } from './result';
import type { StepUpCookieSink, StepUpCookieValue } from './core';

const STATUS_BY_ERROR: Record<ActionErrorCode, number> = {
  ADMIN_AUTH_REQUIRED: 401,
  STEP_UP_REQUIRED: 403,
  INVALID_INPUT: 400,
  INTERNAL_ERROR: 500,
  NO_CREDENTIALS: 400,
  CHALLENGE_INVALID: 400,
  CREDENTIAL_UNKNOWN: 400,
  VERIFICATION_FAILED: 401,
  COUNTER_REPLAYED: 401,
};

export function actionResponse<T>(result: ActionResult<T>, successStatus = 200): Response {
  if (result.ok) return jsonResponse(successStatus, result.data);
  return jsonResponse(STATUS_BY_ERROR[result.error], { error: result.error, message: result.message });
}

/**
 * Collect the step-up cookie so a route handler can attach it to its response.
 * The sink is only invoked after the assertion has been verified.
 */
export function createStepUpCookieSink(): {
  setCookie: StepUpCookieSink;
  cookies: () => string[];
} {
  const cookies: string[] = [];
  return {
    setCookie: ({ token, expiresAt }: StepUpCookieValue) => {
      cookies.push(
        serializeCookie(STEP_UP_COOKIE, token, {
          maxAgeSeconds: Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)),
          path: STEP_UP_COOKIE_PATH,
          sameSite: 'Strict',
        }),
      );
    },
    cookies: () => cookies,
  };
}
