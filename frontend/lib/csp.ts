/**
 * Strict, nonce-based Content-Security-Policy for the dashboard (#1466).
 *
 * `middleware.ts` builds a policy with a fresh nonce for every document
 * request. Next.js reads the nonce from the request's CSP header and stamps it
 * on every script it renders, so only those scripts run:
 *
 *   script-src 'self' 'nonce-<random>' 'strict-dynamic'
 *
 * 'strict-dynamic' lets a nonced script load its own chunks (Next's loader,
 * WalletConnect, Sentry), while an injected <script> or inline handler has no
 * nonce and is blocked. Styles keep 'unsafe-inline': React, Radix and
 * Web3Modal set inline style attributes, which a nonce cannot cover, and
 * style injection is not a script-execution vector.
 *
 * Kept free of Next.js imports so it can be unit-tested directly.
 */

export const NONCE_HEADER = 'x-nonce';
export const CSP_HEADER = 'Content-Security-Policy';
export const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';
export const CSP_REPORT_GROUP = 'csp-endpoint';

export interface CspOptions {
  nonce: string;
  /** Adds what `next dev` needs: eval for React's debugging tools, ws: and localhost for HMR and a local API. */
  isDev?: boolean;
  /** Origins of the API/back end the dashboard calls (any scheme); added to connect-src. */
  apiOrigins?: string[];
  /** Where browsers POST violation reports. */
  reportUri?: string;
  /**
   * Whether other sites may frame this document. Only the embeddable payment
   * forms (`isEmbeddablePath`) allow it; everything else is `frame-ancestors 'none'`.
   */
  allowFraming?: boolean;
}

/**
 * Embeddable payment forms (`/forms/embed/:id`, optionally locale-prefixed).
 * Merchants place these in an iframe on their own sites, so they must stay
 * frameable by any origin, as before this policy existed.
 */
export function isEmbeddablePath(pathname: string, locales: readonly string[] = []): boolean {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 0 && locales.includes(segments[0])) segments.shift();
  return segments[0] === 'forms' && segments[1] === 'embed' && segments.length >= 3;
}

/** Hosts the bundled wallet SDKs (WalletConnect / Web3Modal) need beyond https:/wss:. */
const WALLETCONNECT_FRAMES = ['https://verify.walletconnect.com', 'https://verify.walletconnect.org'];

/**
 * A base64 nonce of 16 random bytes (128 bits). Uses Web Crypto, which is
 * available in both the Edge and Node.js middleware runtimes.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The origin of a URL, or undefined when it is missing or not http(s)/ws(s). */
export function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol) ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sentry's CSP report endpoint for a DSN
 * (`https://<key>@o1.ingest.sentry.io/<project>` →
 * `https://o1.ingest.sentry.io/api/<project>/security/?sentry_key=<key>`),
 * so violations land next to the dashboard's other errors.
 */
export function sentryCspReportUri(dsn: string | undefined): string | undefined {
  if (!dsn) return undefined;
  try {
    const url = new URL(dsn);
    const project = url.pathname.replace(/^\/+|\/+$/g, '').split('/').pop();
    if (!url.username || !project || url.protocol !== 'https:') return undefined;
    return `${url.protocol}//${url.host}/api/${project}/security/?sentry_key=${url.username}`;
  } catch {
    return undefined;
  }
}

/** The policy as directive → sources, in a stable order. */
export function cspDirectives(options: CspOptions): Array<[string, string[]]> {
  const { nonce, isDev = false, apiOrigins = [], reportUri, allowFraming = false } = options;
  if (!/^[A-Za-z0-9+/=_-]{16,}$/.test(nonce)) {
    throw new Error('CSP nonce must be at least 16 base64 characters');
  }
  const unique = (values: Array<string | undefined>) => [...new Set(values.filter((v): v is string => Boolean(v)))];

  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', unique(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", isDev ? "'unsafe-eval'" : undefined])],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', 'https:']],
    ['font-src', ["'self'", 'data:', 'https:']],
    // Wallet RPCs, WalletConnect relays and per-chain explorers are
    // configurable and numerous, so outbound connections allow any secure
    // origin; script execution, the XSS-critical directive, stays strict.
    [
      'connect-src',
      unique([
        "'self'",
        'https:',
        'wss:',
        ...apiOrigins,
        ...(isDev ? ['ws:', 'http://localhost:*', 'http://127.0.0.1:*'] : []),
      ]),
    ],
    ['frame-src', ["'self'", ...WALLETCONNECT_FRAMES]],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['media-src', ["'self'", 'blob:', 'data:']],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', allowFraming ? ['*'] : ["'none'"]],
  ];
  if (!isDev) directives.push(['upgrade-insecure-requests', []]);
  if (reportUri) {
    directives.push(['report-uri', [reportUri]]);
    directives.push(['report-to', [CSP_REPORT_GROUP]]);
  }
  return directives;
}

export function buildContentSecurityPolicy(options: CspOptions): string {
  return cspDirectives(options)
    .map(([name, sources]) => (sources.length ? `${name} ${sources.join(' ')}` : name))
    .join('; ');
}

/**
 * A realtime endpoint's origins: the URL's own origin plus its WebSocket
 * counterpart (`http://h` → `ws://h`, `https://h` → `wss://h`), because
 * Socket.IO starts over HTTP polling and then upgrades on the same host.
 */
export function realtimeOrigins(url: string | undefined): string[] {
  const origin = originOf(url);
  if (!origin) return [];
  const websocket = origin.replace(/^http(s?):/, 'ws$1:');
  const http = origin.replace(/^ws(s?):/, 'http$1:');
  return [...new Set([origin, websocket, http])];
}

export interface CspEnvironment {
  isDev: boolean;
  reportOnly: boolean;
  apiOrigins: string[];
  reportUri?: string;
}

/**
 * Reads the CSP settings from the environment:
 *
 * - `CSP_REPORT_ONLY=true` sends the policy as
 *   Content-Security-Policy-Report-Only, to roll it out by watching reports
 *   before enforcing.
 * - `CSP_REPORT_URI` overrides where reports go; otherwise they go to Sentry
 *   when `NEXT_PUBLIC_SENTRY_DSN` is set.
 * - `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_BACKEND_URL` origins, and the
 *   `NEXT_PUBLIC_WS_URL` origin in both its HTTP and WebSocket form, are
 *   allowed in connect-src even over plain http/ws (local and private
 *   deployments).
 */
export function readCspEnvironment(env: Record<string, string | undefined> = process.env): CspEnvironment {
  return {
    isDev: env.NODE_ENV === 'development',
    reportOnly: env.CSP_REPORT_ONLY === 'true',
    apiOrigins: [
      ...new Set(
        [
          originOf(env.NEXT_PUBLIC_API_URL),
          originOf(env.NEXT_PUBLIC_BACKEND_URL),
          ...realtimeOrigins(env.NEXT_PUBLIC_WS_URL),
        ].filter((origin): origin is string => Boolean(origin)),
      ),
    ],
    reportUri: env.CSP_REPORT_URI || sentryCspReportUri(env.NEXT_PUBLIC_SENTRY_DSN),
  };
}
