import createMiddleware from 'next-intl/middleware';
import { NextRequest, type NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import {
  CSP_HEADER,
  CSP_REPORT_GROUP,
  CSP_REPORT_ONLY_HEADER,
  NONCE_HEADER,
  buildContentSecurityPolicy,
  generateNonce,
  isEmbeddablePath,
  readCspEnvironment,
} from './lib/csp';

const handleI18nRouting = createMiddleware(routing);

/**
 * Locale routing (next-intl) plus a strict, per-request nonce CSP (#1466).
 *
 * The nonce and policy are set on the *forwarded request* so Next.js can read
 * the nonce and stamp it on the scripts it renders (next-intl copies request
 * headers into the response it forwards), and on the *response* so the
 * browser enforces the policy. Every document request gets a new nonce.
 *
 * Framing is denied everywhere except the embeddable payment forms, which
 * merchants iframe on their own sites.
 */
export default function middleware(request: NextRequest): NextResponse {
  const env = readCspEnvironment();
  const nonce = generateNonce();
  const allowFraming = isEmbeddablePath(request.nextUrl.pathname, routing.locales);
  const policy = buildContentSecurityPolicy({ nonce, ...env, allowFraming });
  const headerName = env.reportOnly ? CSP_REPORT_ONLY_HEADER : CSP_HEADER;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set(headerName, policy);

  const response = handleI18nRouting(new NextRequest(request, { headers: requestHeaders }));

  response.headers.set(headerName, policy);
  if (!allowFraming) {
    // Legacy equivalent of frame-ancestors 'none' for browsers without CSP2.
    response.headers.set('X-Frame-Options', 'DENY');
  }
  if (env.reportUri) {
    response.headers.set('Reporting-Endpoints', `${CSP_REPORT_GROUP}="${env.reportUri}"`);
  }
  return response;
}

export const config = {
  matcher: ['/', '/(en|es|fr|ja|ar)/:path*', '/((?!api|_next|_vercel|.*\\..*).*)'],
};
