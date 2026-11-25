import { jsonResponse, requestCorrelation, requireOperator } from '@/app/admin/guard';
import { getPortalRuntime } from '@/app/admin/runtime';
import { ceremonyErrorResponse } from '@/app/admin/api/helpers';

export const runtime = 'nodejs';

/**
 * Start the step-up ceremony: return the public-key request options the browser
 * feeds to `startAuthentication`. Requires the base operator session and at
 * least one enrolled passkey.
 */
export async function POST(request: Request): Promise<Response> {
  const deps = getPortalRuntime();
  const access = await requireOperator(request, deps);
  if (!access.ok) return access.response;

  try {
    const options = await deps.service.beginAuthentication(access.operatorId, requestCorrelation(request.headers));
    return jsonResponse(200, options);
  } catch (error) {
    return ceremonyErrorResponse(error);
  }
}
