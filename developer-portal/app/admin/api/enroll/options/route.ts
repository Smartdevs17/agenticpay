import { jsonResponse, requestCorrelation, requireAdminApi, requireOperator } from '@/app/admin/guard';
import { getPortalRuntime } from '@/app/admin/runtime';
import { ceremonyErrorResponse } from '@/app/admin/api/helpers';

export const runtime = 'nodejs';

/**
 * Start the registration ceremony: return the public-key creation options the
 * browser feeds to `startRegistration`.
 *
 * The first passkey an operator enrolls (bootstrap) only needs the base
 * session, since there is nothing to step up with yet. Enrolling any later
 * authenticator is itself a privileged change, so it also requires a fresh
 * step-up — a stolen base cookie cannot silently add an attacker's passkey.
 */
export async function POST(request: Request): Promise<Response> {
  const deps = getPortalRuntime();
  const access = await requireOperator(request, deps);
  if (!access.ok) return access.response;

  const existing = await deps.service.listCredentials(access.operatorId);
  if (existing.length > 0) {
    const gate = await requireAdminApi(request, deps);
    if (!gate.ok) return gate.response;
  }

  try {
    const options = await deps.service.beginRegistration(access.operatorId, requestCorrelation(request.headers));
    return jsonResponse(200, { ...options, bootstrap: existing.length === 0 });
  } catch (error) {
    return ceremonyErrorResponse(error);
  }
}
