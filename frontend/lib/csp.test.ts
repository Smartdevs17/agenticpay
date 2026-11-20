import { describe, expect, it } from 'vitest';
import {
  buildContentSecurityPolicy,
  cspDirectives,
  generateNonce,
  isEmbeddablePath,
  originOf,
  readCspEnvironment,
  realtimeOrigins,
  sentryCspReportUri,
} from './csp';

const NONCE = 'AAAAAAAAAAAAAAAAAAAAAA==';

function directive(policy: string, name: string): string[] | undefined {
  const part = policy.split('; ').find((p) => p === name || p.startsWith(`${name} `));
  return part?.split(' ').slice(1);
}

describe('generateNonce', () => {
  it('returns 128 bits of base64', () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(atob(nonce)).toHaveLength(16);
  });

  it('is different on every call', () => {
    const nonces = new Set(Array.from({ length: 50 }, generateNonce));
    expect(nonces.size).toBe(50);
  });
});

describe('buildContentSecurityPolicy (production)', () => {
  const policy = buildContentSecurityPolicy({ nonce: NONCE });

  it('only runs scripts that carry the request nonce', () => {
    expect(directive(policy, 'script-src')).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
  });

  it('never allows inline or eval scripts in production', () => {
    const scripts = directive(policy, 'script-src')!;
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
  });

  it('locks down plugins, base URIs, form targets and framing', () => {
    expect(directive(policy, 'object-src')).toEqual(["'none'"]);
    expect(directive(policy, 'base-uri')).toEqual(["'self'"]);
    expect(directive(policy, 'form-action')).toEqual(["'self'"]);
    expect(directive(policy, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(policy, 'default-src')).toEqual(["'self'"]);
  });

  it('allows what the dashboard needs: wallet connections, Sentry workers, WalletConnect verify frames', () => {
    expect(directive(policy, 'connect-src')).toEqual(["'self'", 'https:', 'wss:']);
    expect(directive(policy, 'worker-src')).toEqual(["'self'", 'blob:']);
    expect(directive(policy, 'frame-src')).toContain('https://verify.walletconnect.com');
    expect(directive(policy, 'img-src')).toEqual(["'self'", 'data:', 'blob:', 'https:']);
  });

  it('upgrades insecure requests and sends no report directives without a report URI', () => {
    expect(directive(policy, 'upgrade-insecure-requests')).toEqual([]);
    expect(directive(policy, 'report-uri')).toBeUndefined();
    expect(directive(policy, 'report-to')).toBeUndefined();
  });
});

describe('buildContentSecurityPolicy options', () => {
  it('adds what next dev needs only in development', () => {
    const dev = buildContentSecurityPolicy({ nonce: NONCE, isDev: true });
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(dev, 'connect-src')).toEqual(
      expect.arrayContaining(['ws:', 'http://localhost:*', 'http://127.0.0.1:*']),
    );
    expect(directive(dev, 'upgrade-insecure-requests')).toBeUndefined();
  });

  it('allows the configured API origins in connect-src without duplicates', () => {
    const policy = buildContentSecurityPolicy({
      nonce: NONCE,
      apiOrigins: ['http://api.internal:3001', 'http://api.internal:3001'],
    });
    expect(directive(policy, 'connect-src')).toEqual(["'self'", 'https:', 'wss:', 'http://api.internal:3001']);
  });

  it('adds report-uri and report-to when reports are configured', () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, reportUri: 'https://reports.example/csp' });
    expect(directive(policy, 'report-uri')).toEqual(['https://reports.example/csp']);
    expect(directive(policy, 'report-to')).toEqual(['csp-endpoint']);
  });

  it('lets other sites frame the document only when framing is allowed', () => {
    const embed = buildContentSecurityPolicy({ nonce: NONCE, allowFraming: true });
    expect(directive(embed, 'frame-ancestors')).toEqual(['*']);
    // The rest of the policy stays strict on embeddable pages.
    expect(directive(embed, 'script-src')).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
  });

  it.each(['', 'short', 'has space aaaaaaaaaa', "quote'aaaaaaaaaaaaaaaa", 'semi;colonaaaaaaaaaaaa'])(
    'rejects an unsafe or too-short nonce %j',
    (nonce) => {
      expect(() => cspDirectives({ nonce })).toThrow(/nonce/);
    },
  );
});

describe('isEmbeddablePath', () => {
  const locales = ['en', 'es', 'fr', 'ja', 'ar'];

  it.each(['/forms/embed/abc', '/en/forms/embed/abc', '/ar/forms/embed/abc/', '/forms/embed/abc/step'])(
    'treats %s as embeddable',
    (path) => {
      expect(isEmbeddablePath(path, locales)).toBe(true);
    },
  );

  it.each(['/', '/en', '/forms/abc', '/forms/embed', '/en/dashboard', '/dashboard/forms/embed/x', '/de/forms/embed/x'])(
    'keeps %s unframeable',
    (path) => {
      expect(isEmbeddablePath(path, locales)).toBe(false);
    },
  );
});

describe('originOf', () => {
  it('returns the origin of http(s) and ws(s) URLs', () => {
    expect(originOf('http://localhost:3001/api/v1')).toBe('http://localhost:3001');
    expect(originOf('wss://relay.example/ws')).toBe('wss://relay.example');
  });

  it('ignores missing, invalid and non-network URLs', () => {
    expect(originOf(undefined)).toBeUndefined();
    expect(originOf('not a url')).toBeUndefined();
    expect(originOf('javascript:alert(1)')).toBeUndefined();
  });
});

describe('realtimeOrigins', () => {
  it('allows both the HTTP and the WebSocket form of the realtime host', () => {
    expect(realtimeOrigins('http://localhost:3001')).toEqual(['http://localhost:3001', 'ws://localhost:3001']);
    expect(realtimeOrigins('https://rt.agenticpay.com/socket')).toEqual([
      'https://rt.agenticpay.com',
      'wss://rt.agenticpay.com',
    ]);
    expect(realtimeOrigins('wss://rt.agenticpay.com')).toEqual(['wss://rt.agenticpay.com', 'https://rt.agenticpay.com']);
  });

  it('returns nothing for a missing or invalid URL', () => {
    expect(realtimeOrigins(undefined)).toEqual([]);
    expect(realtimeOrigins('nope')).toEqual([]);
  });
});

describe('sentryCspReportUri', () => {
  it('derives the security endpoint from a DSN', () => {
    expect(sentryCspReportUri('https://abc123@o42.ingest.sentry.io/4507')).toBe(
      'https://o42.ingest.sentry.io/api/4507/security/?sentry_key=abc123',
    );
  });

  it('ignores missing or malformed DSNs', () => {
    expect(sentryCspReportUri(undefined)).toBeUndefined();
    expect(sentryCspReportUri('')).toBeUndefined();
    expect(sentryCspReportUri('https://o42.ingest.sentry.io/4507')).toBeUndefined();
    expect(sentryCspReportUri('nonsense')).toBeUndefined();
  });
});

describe('readCspEnvironment', () => {
  it('defaults to an enforced policy with no extra origins', () => {
    expect(readCspEnvironment({ NODE_ENV: 'production' })).toEqual({
      isDev: false,
      reportOnly: false,
      apiOrigins: [],
      reportUri: undefined,
    });
  });

  it('reads report-only mode, API origins and the report URI', () => {
    const env = readCspEnvironment({
      NODE_ENV: 'development',
      CSP_REPORT_ONLY: 'true',
      NEXT_PUBLIC_API_URL: 'http://localhost:3001/api/v1',
      NEXT_PUBLIC_BACKEND_URL: 'https://api.agenticpay.com',
      NEXT_PUBLIC_WS_URL: 'http://localhost:3001',
      NEXT_PUBLIC_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/2',
    });
    expect(env).toEqual({
      isDev: true,
      reportOnly: true,
      apiOrigins: ['http://localhost:3001', 'https://api.agenticpay.com', 'ws://localhost:3001'],
      reportUri: 'https://o1.ingest.sentry.io/api/2/security/?sentry_key=k',
    });
  });

  it('prefers an explicit CSP_REPORT_URI over the Sentry DSN', () => {
    const env = readCspEnvironment({ CSP_REPORT_URI: 'https://r.example/csp', NEXT_PUBLIC_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/2' });
    expect(env.reportUri).toBe('https://r.example/csp');
  });
});
