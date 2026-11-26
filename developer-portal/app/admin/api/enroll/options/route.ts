import { getPortalRuntime } from '@/app/admin/runtime';
import { contextFromRequest } from '@/app/actions/context';
import { beginEnroll } from '@/app/actions/core';
import { actionResponse } from '@/app/actions/http';

export const runtime = 'nodejs';

/**
 * Start the registration ceremony: return the public-key creation options the
 * browser feeds to `startRegistration`.
 *
 * The first passkey an operator enrolls (bootstrap) only needs the base
 * session, since there is nothing to step up with yet. Enrolling any later
 * authenticator is itself a privileged change, so it also requires a fresh
 * step-up — a stolen base cookie cannot silently add an attacker's passkey.
 * The rule lives in the shared action core; this route is only an adapter.
 */
export async function POST(request: Request): Promise<Response> {
  const result = await beginEnroll(contextFromRequest(request), getPortalRuntime());
  return actionResponse(result);
}
