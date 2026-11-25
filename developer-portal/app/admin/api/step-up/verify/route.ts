import {
  STEP_UP_COOKIE,
  STEP_UP_COOKIE_PATH,
  jsonResponse,
  requestCorrelation,
  requireOperator,
  serializeCookie,
} from '@/app/admin/guard';
import { getPortalRuntime } from '@/app/admin/runtime';
import { ceremonyErrorResponse, readJsonObject } from '@/app/admin/api/helpers';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

export const runtime = 'nodejs';

/**
 * Finish the step-up ceremony: verify the assertion and, on success, mint the
 * short-lived step-up session cookie that unlocks the admin area.
 */
export async function POST(request: Request): Promise<Response> {
  const deps = getPortalRuntime();
  const access = await requireOperator(request, deps);
  if (!access.ok) return access.response;

  const body = await readJsonObject(request);
  if (!body) return jsonResponse(400, { error: 'INVALID_BODY', message: 'Expected a JSON ceremony response' });

  try {
    const session = await deps.service.finishAuthentication(
      access.operatorId,
      body as unknown as AuthenticationResponseJSON,
      requestCorrelation(request.headers),
    );
    const cookie = serializeCookie(STEP_UP_COOKIE, session.sessionId, {
      maxAgeSeconds: Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000)),
      path: STEP_UP_COOKIE_PATH,
      sameSite: 'Strict',
    });
    return jsonResponse(200, { ok: true, expiresAt: session.expiresAt }, [cookie]);
  } catch (error) {
    return ceremonyErrorResponse(error);
  }
}
