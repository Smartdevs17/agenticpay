/**
 * The typed result contract shared by server actions and route handlers.
 *
 * Actions never throw validation or authentication failures across the network
 * boundary. Every failure is a serialisable value with a stable error code, so
 * callers can branch on `ok` and the HTTP adapters can map codes to statuses
 * without duplicating ceremony logic.
 */
import { WebAuthnError, type WebAuthnErrorCode } from '@/lib/webauthn';

export type ActionErrorCode =
  | WebAuthnErrorCode
  | 'INVALID_INPUT'
  | 'ADMIN_AUTH_REQUIRED'
  | 'STEP_UP_REQUIRED'
  | 'INTERNAL_ERROR';

export type ActionSuccess<T> = { ok: true; data: T };
export type ActionFailure = { ok: false; error: ActionErrorCode; message: string };
export type ActionResult<T> = ActionSuccess<T> | ActionFailure;

export function actionOk<T>(data: T): ActionSuccess<T> {
  return { ok: true, data };
}

export function actionFail(error: ActionErrorCode, message: string): ActionFailure {
  return { ok: false, error, message };
}

/** Translate a service failure without leaking implementation details. */
export function actionFailFromError(error: unknown): ActionFailure {
  if (error instanceof WebAuthnError) return actionFail(error.code, error.message);
  return actionFail('INTERNAL_ERROR', 'The ceremony could not be completed');
}
