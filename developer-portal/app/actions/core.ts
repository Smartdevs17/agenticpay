/**
 * Ceremony orchestration shared by the portal's two entry points: typed server
 * actions (`app/actions/index.ts`) and the admin API route handlers.
 *
 * Nothing in this module reads `next/headers` or builds an HTTP response. It
 * takes a resolved action context and injected dependencies, which keeps the
 * privileged logic testable with the in-memory stores and lets the two adapters
 * stay thin.
 */
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { evaluateAdminAccess, type AdminGuardDeps } from '@/app/admin/guard';
import { parseAuthenticationResponse, parseRegistrationResponse } from '@/lib/schemas';
import type { WebAuthnService } from '@/lib/webauthn';
import type { ActionContext } from './context';
import { actionFail, actionFailFromError, actionOk, type ActionFailure, type ActionResult } from './result';

export interface CeremonyDeps extends AdminGuardDeps {
  service: WebAuthnService;
}

export interface StepUpCompletion {
  ok: true;
  expiresAt: number;
}

export interface EnrollCompletion {
  ok: true;
  credentialId: string;
}

export interface StepUpCookieValue {
  token: string;
  expiresAt: number;
}

/** Called only after a verified assertion, so a cookie is never minted early. */
export type StepUpCookieSink = (value: StepUpCookieValue) => void | Promise<void>;

interface EnrollPrivilege {
  operatorId: string;
  bootstrap: boolean;
}

function isFailure(value: string | ActionFailure | EnrollPrivilege): value is ActionFailure {
  return typeof value === 'object' && 'ok' in value && value.ok === false;
}

function denyUnauthenticated(context: ActionContext, deps: CeremonyDeps): ActionFailure {
  deps.events.emit({
    name: 'admin.access_denied',
    outcome: 'failure',
    reason: 'no-operator-session',
    ...context.correlation,
  });
  return actionFail('ADMIN_AUTH_REQUIRED', 'Sign in to the developer portal before using the admin area');
}

async function requireOperator(context: ActionContext, deps: CeremonyDeps): Promise<string | ActionFailure> {
  if (!context.operatorToken) return denyUnauthenticated(context, deps);
  const session = await deps.operatorSessions.find(context.operatorToken);
  if (!session) return denyUnauthenticated(context, deps);
  return session.operatorId;
}

/**
 * Enrolling the first passkey is the bootstrap path: the base session is enough
 * because there is no authenticator to step up with yet. Every later enrolment
 * is a privileged change and needs a fresh assertion as well.
 */
async function requireEnrollPrivilege(
  context: ActionContext,
  deps: CeremonyDeps,
): Promise<EnrollPrivilege | ActionFailure> {
  const operatorId = await requireOperator(context, deps);
  if (isFailure(operatorId)) return operatorId;

  const existing = await deps.service.listCredentials(operatorId);
  if (existing.length === 0) return { operatorId, bootstrap: true };

  const access = await evaluateAdminAccess(
    {
      operatorToken: context.operatorToken,
      stepUpToken: context.stepUpToken,
      correlation: context.correlation,
    },
    deps,
  );
  if (access.kind !== 'granted') {
    return actionFail(
      access.kind === 'unauthenticated' ? 'ADMIN_AUTH_REQUIRED' : 'STEP_UP_REQUIRED',
      access.kind === 'unauthenticated'
        ? 'Sign in to the developer portal before using the admin area'
        : 'Complete a WebAuthn step-up before using the admin area',
    );
  }
  return { operatorId, bootstrap: false };
}

/** Start the step-up ceremony for an operator with at least one passkey. */
export async function beginStepUp(
  context: ActionContext,
  deps: CeremonyDeps,
): Promise<ActionResult<PublicKeyCredentialRequestOptionsJSON>> {
  const operatorId = await requireOperator(context, deps);
  if (isFailure(operatorId)) return operatorId;

  try {
    return actionOk(await deps.service.beginAuthentication(operatorId, context.correlation));
  } catch (error) {
    return actionFailFromError(error);
  }
}

/** Verify an assertion and hand the resulting session id to the cookie adapter. */
export async function completeStepUp(
  response: unknown,
  context: ActionContext,
  deps: CeremonyDeps,
  setCookie: StepUpCookieSink = () => undefined,
): Promise<ActionResult<StepUpCompletion>> {
  const operatorId = await requireOperator(context, deps);
  if (isFailure(operatorId)) return operatorId;

  const parsed = parseAuthenticationResponse(response);
  if (!parsed) {
    deps.events.emit({
      name: 'webauthn.authentication_failed',
      outcome: 'failure',
      operatorId,
      reason: 'INVALID_INPUT',
      ...context.correlation,
    });
    return actionFail('INVALID_INPUT', 'Expected a valid WebAuthn assertion');
  }

  try {
    const session = await deps.service.finishAuthentication(operatorId, parsed, context.correlation);
    await setCookie({ token: session.sessionId, expiresAt: session.expiresAt });
    return actionOk({ ok: true, expiresAt: session.expiresAt });
  } catch (error) {
    return actionFailFromError(error);
  }
}

/** Start registration, enforcing the bootstrap rule for additional passkeys. */
export async function beginEnroll(
  context: ActionContext,
  deps: CeremonyDeps,
): Promise<ActionResult<PublicKeyCredentialCreationOptionsJSON & { bootstrap: boolean }>> {
  const privilege = await requireEnrollPrivilege(context, deps);
  if (isFailure(privilege)) return privilege;

  try {
    const options = await deps.service.beginRegistration(privilege.operatorId, context.correlation);
    return actionOk({ ...options, bootstrap: privilege.bootstrap });
  } catch (error) {
    return actionFailFromError(error);
  }
}

/** Verify an attestation and persist the new credential. */
export async function completeEnroll(
  response: unknown,
  context: ActionContext,
  deps: CeremonyDeps,
): Promise<ActionResult<EnrollCompletion>> {
  const privilege = await requireEnrollPrivilege(context, deps);
  if (isFailure(privilege)) return privilege;

  const parsed = parseRegistrationResponse(response);
  if (!parsed) {
    deps.events.emit({
      name: 'webauthn.registration_failed',
      outcome: 'failure',
      operatorId: privilege.operatorId,
      reason: 'INVALID_INPUT',
      ...context.correlation,
    });
    return actionFail('INVALID_INPUT', 'Expected a valid WebAuthn attestation');
  }

  try {
    const credential = await deps.service.finishRegistration(
      privilege.operatorId,
      parsed,
      context.correlation,
    );
    return actionOk({ ok: true, credentialId: credential.id });
  } catch (error) {
    return actionFailFromError(error);
  }
}
