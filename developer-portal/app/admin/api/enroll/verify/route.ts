import { jsonResponse } from '@/app/admin/guard';
import { getPortalRuntime } from '@/app/admin/runtime';
import { contextFromRequest } from '@/app/actions/context';
import { completeEnroll } from '@/app/actions/core';
import { actionResponse } from '@/app/actions/http';
import { readJsonObject } from '@/app/admin/api/helpers';

export const runtime = 'nodejs';

/**
 * Finish the registration ceremony: verify the attestation and persist the new
 * credential. Applies the same bootstrap rule as `../options` — a second (or
 * later) authenticator requires an existing step-up.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return jsonResponse(400, { error: 'INVALID_BODY', message: 'Expected a JSON ceremony response' });

  const result = await completeEnroll(body, contextFromRequest(request), getPortalRuntime());
  return actionResponse(result, 201);
}
