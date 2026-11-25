import { jsonResponse, requestCorrelation, requireAdminApi, requireOperator } from '@/app/admin/guard';
import { getPortalRuntime } from '@/app/admin/runtime';
import { ceremonyErrorResponse, readJsonObject } from '@/app/admin/api/helpers';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

export const runtime = 'nodejs';

/**
 * Finish the registration ceremony: verify the attestation and persist the new
 * credential. Applies the same bootstrap rule as `../options` — a second (or
 * later) authenticator requires an existing step-up.
 */
export async function POST(request: Request): Promise<Response> {
  const deps = getPortalRuntime();
  const access = await requireOperator(request, deps);
  if (!access.ok) return access.response;

  const body = await readJsonObject(request);
  if (!body) return jsonResponse(400, { error: 'INVALID_BODY', message: 'Expected a JSON ceremony response' });

  const existing = await deps.service.listCredentials(access.operatorId);
  if (existing.length > 0) {
    const gate = await requireAdminApi(request, deps);
    if (!gate.ok) return gate.response;
  }

  try {
    const credential = await deps.service.finishRegistration(
      access.operatorId,
      body as unknown as RegistrationResponseJSON,
      requestCorrelation(request.headers),
    );
    return jsonResponse(201, { ok: true, credentialId: credential.id });
  } catch (error) {
    return ceremonyErrorResponse(error);
  }
}
