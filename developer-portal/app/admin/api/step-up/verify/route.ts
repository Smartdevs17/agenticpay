import { jsonResponse } from '@/app/admin/guard';
import { getPortalRuntime } from '@/app/admin/runtime';
import { contextFromRequest } from '@/app/actions/context';
import { completeStepUp } from '@/app/actions/core';
import { actionResponse, createStepUpCookieSink } from '@/app/actions/http';
import { readJsonObject } from '@/app/admin/api/helpers';

export const runtime = 'nodejs';

/**
 * Finish the step-up ceremony: verify the assertion and, on success, mint the
 * short-lived step-up session cookie that unlocks the admin area.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return jsonResponse(400, { error: 'INVALID_BODY', message: 'Expected a JSON ceremony response' });

  // The cookie sink is only called after the shared core verifies the assertion.
  const { setCookie, cookies } = createStepUpCookieSink();
  const result = await completeStepUp(body, contextFromRequest(request), getPortalRuntime(), setCookie);
  const response = actionResponse(result);
  for (const cookie of cookies()) response.headers.append('set-cookie', cookie);
  return response;
}
