'use server';

/**
 * Typed server actions for the developer portal's WebAuthn ceremonies.
 *
 * Client components call these directly instead of posting untyped bodies to
 * hand-written API routes. Inputs are validated with the schemas in
 * `@/lib/schemas` before they reach the WebAuthn service, and every outcome is
 * returned as a serialisable `ActionResult` rather than an exception.
 *
 * The admin API routes call the same core functions, so a browser action and a
 * REST client enforce exactly the same gate, validation and audit events.
 */
import { cookies, headers } from 'next/headers';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { STEP_UP_COOKIE, STEP_UP_COOKIE_PATH } from '@/app/admin/guard';
import { getPortalRuntime } from '@/app/admin/runtime';
import { contextFromHeaders } from './context';
import {
  beginEnroll,
  beginStepUp,
  completeEnroll,
  completeStepUp,
  type CeremonyDeps,
  type EnrollCompletion,
  type StepUpCompletion,
} from './core';
import { actionFail, type ActionResult } from './result';

/** Keep configuration/runtime failures from escaping the action boundary. */
async function withDeps<T>(run: (deps: CeremonyDeps) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run(getPortalRuntime());
  } catch {
    return actionFail('INTERNAL_ERROR', 'The ceremony could not be completed');
  }
}

/** Start a step-up assertion. Requires the base operator session. */
export async function startStepUpAction(): Promise<ActionResult<PublicKeyCredentialRequestOptionsJSON>> {
  const context = contextFromHeaders(await headers());
  return withDeps((deps) => beginStepUp(context, deps));
}

/**
 * Finish a step-up assertion. The short-lived session cookie is set here, on
 * the server, and never returned to the caller.
 */
export async function finishStepUpAction(response: unknown): Promise<ActionResult<StepUpCompletion>> {
  const context = contextFromHeaders(await headers());
  return withDeps((deps) =>
    completeStepUp(response, context, deps, async ({ token, expiresAt }) => {
      const jar = await cookies();
      jar.set(STEP_UP_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: STEP_UP_COOKIE_PATH,
        maxAge: Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)),
      });
    }),
  );
}

/** Start enrolment. A second (or later) passkey also requires a fresh step-up. */
export async function startEnrollAction(): Promise<
  ActionResult<PublicKeyCredentialCreationOptionsJSON & { bootstrap: boolean }>
> {
  const context = contextFromHeaders(await headers());
  return withDeps((deps) => beginEnroll(context, deps));
}

/** Finish enrolment and persist the credential. */
export async function finishEnrollAction(response: unknown): Promise<ActionResult<EnrollCompletion>> {
  const context = contextFromHeaders(await headers());
  return withDeps((deps) => completeEnroll(response, context, deps));
}
