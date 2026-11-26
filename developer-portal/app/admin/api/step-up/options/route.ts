import { getPortalRuntime } from '@/app/admin/runtime';
import { contextFromRequest } from '@/app/actions/context';
import { beginStepUp } from '@/app/actions/core';
import { actionResponse } from '@/app/actions/http';

export const runtime = 'nodejs';

/**
 * Start the step-up ceremony: return the public-key request options the browser
 * feeds to `startAuthentication`. Requires the base operator session and at
 * least one enrolled passkey.
 */
export async function POST(request: Request): Promise<Response> {
  const result = await beginStepUp(contextFromRequest(request), getPortalRuntime());
  return actionResponse(result);
}
