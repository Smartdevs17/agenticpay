// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import middleware from './middleware';

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, 'https://app.agenticpay.test'), {
    headers: { 'accept-language': 'en', ...headers },
  });
}

function nonceIn(policy: string | null): string | undefined {
  return policy?.match(/'nonce-([^']+)'/)?.[1];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('middleware CSP (#1466)', () => {
  it('sets an enforced CSP with a nonce on the response', () => {
    const response = middleware(request('/en/dashboard'));
    const policy = response.headers.get('content-security-policy');

    expect(policy).toContain("script-src 'self' 'nonce-");
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(nonceIn(policy)).toBeTruthy();
    expect(response.headers.get('content-security-policy-report-only')).toBeNull();
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  // `/dashboard` is rewritten to the default locale; `/es/dashboard` passes
  // straight through. Both must forward the nonce to the app.
  it.each(['/dashboard', '/es/dashboard', '/'])(
    'forwards the same nonce and policy to the app on %s so Next.js can stamp its scripts',
    (path) => {
      const response = middleware(request(path));
      const policy = response.headers.get('content-security-policy');

      // NextResponse.next/rewrite encode forwarded request headers this way.
      const overridden = response.headers.get('x-middleware-override-headers')?.split(',') ?? [];
      expect(overridden).toEqual(expect.arrayContaining(['x-nonce', 'content-security-policy']));
      expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonceIn(policy));
      expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    },
  );

  it('keeps next-intl locale routing working', () => {
    expect(middleware(request('/dashboard')).headers.get('x-middleware-rewrite')).toBe(
      'https://app.agenticpay.test/en/dashboard',
    );
    expect(middleware(request('/es/dashboard')).headers.get('x-middleware-request-x-next-intl-locale')).toBe('es');
  });

  it('issues a fresh nonce for every request', () => {
    const nonces = new Set(
      Array.from({ length: 20 }, () =>
        nonceIn(middleware(request('/en/dashboard')).headers.get('content-security-policy')),
      ),
    );
    expect(nonces.size).toBe(20);
  });

  it('also protects redirects', () => {
    // localePrefix 'as-needed': the default locale's prefix is redirected away.
    const response = middleware(request('/en/dashboard'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://app.agenticpay.test/dashboard');
    expect(response.headers.get('content-security-policy')).toContain("'nonce-");
  });

  it('lets merchants frame the embeddable payment forms, and only those', () => {
    for (const path of ['/forms/embed/form_1', '/en/forms/embed/form_1']) {
      const response = middleware(request(path));
      expect(response.headers.get('content-security-policy'), path).toContain('frame-ancestors *');
      expect(response.headers.get('x-frame-options'), path).toBeNull();
      expect(response.headers.get('content-security-policy'), path).toContain("'strict-dynamic'");
    }
    const form = middleware(request('/en/forms/form_1'));
    expect(form.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('can roll out in report-only mode', () => {
    vi.stubEnv('CSP_REPORT_ONLY', 'true');
    const response = middleware(request('/dashboard'));
    const policy = response.headers.get('content-security-policy-report-only');

    expect(policy).toContain("'nonce-");
    expect(response.headers.get('content-security-policy')).toBeNull();
    // Next.js reads the nonce from the report-only request header too.
    expect(response.headers.get('x-middleware-request-content-security-policy-report-only')).toBe(policy);
  });

  it('reports violations to the configured endpoint', () => {
    vi.stubEnv('CSP_REPORT_URI', 'https://reports.example/csp');
    const response = middleware(request('/en/dashboard'));

    expect(response.headers.get('content-security-policy')).toContain('report-uri https://reports.example/csp');
    expect(response.headers.get('reporting-endpoints')).toBe('csp-endpoint="https://reports.example/csp"');
  });

  it('sends no Reporting-Endpoints header without a report destination', () => {
    vi.stubEnv('CSP_REPORT_URI', '');
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    const response = middleware(request('/en/dashboard'));
    expect(response.headers.get('reporting-endpoints')).toBeNull();
  });
});
