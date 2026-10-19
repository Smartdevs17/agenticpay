/**
 * OAuth2 PKCE flow tests (RFC 7636)
 *
 * Covers:
 *  - generateCodeVerifier
 *  - generateCodeChallenge (S256 and plain)
 *  - validateCodeChallenge
 *  - createPKCEAuthorizationUrl
 *  - exchangeOAuthCode PKCE validation
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  validateCodeChallenge,
  createPKCEAuthorizationUrl,
  createOAuthAuthorizationUrl,
  exchangeOAuthCode,
} from '../oauth-service.js';

// ---------------------------------------------------------------------------
// Environment setup — provide minimal OAuth provider credentials so the
// functions that call `requireConfig` don't throw.
// ---------------------------------------------------------------------------
beforeEach(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google-client-id';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-google-client-secret';
  process.env.GITHUB_OAUTH_CLIENT_ID = 'test-github-client-id';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-github-client-secret';
});

// ---------------------------------------------------------------------------
// generateCodeVerifier
// ---------------------------------------------------------------------------
describe('generateCodeVerifier', () => {
  it('returns a string with length between 43 and 128 characters', () => {
    const verifier = generateCodeVerifier();
    expect(typeof verifier).toBe('string');
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('contains only URL-safe base64url characters (A-Z a-z 0-9 - _)', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('generates unique verifiers on each call', () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(v1).not.toBe(v2);
  });
});

// ---------------------------------------------------------------------------
// generateCodeChallenge
// ---------------------------------------------------------------------------
describe('generateCodeChallenge', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

  describe('S256 method', () => {
    it('returns the base64url-encoded SHA-256 hash of the verifier', () => {
      const challenge = generateCodeChallenge(verifier, 'S256');
      const expected = createHash('sha256').update(verifier).digest('base64url');
      expect(challenge).toBe(expected);
    });

    it('contains only URL-safe characters', () => {
      const challenge = generateCodeChallenge(verifier, 'S256');
      expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
    });

    it('does not contain base64 padding characters', () => {
      const challenge = generateCodeChallenge(verifier, 'S256');
      expect(challenge).not.toContain('=');
      expect(challenge).not.toContain('+');
      expect(challenge).not.toContain('/');
    });
  });

  describe('plain method', () => {
    it('returns the verifier unchanged', () => {
      const challenge = generateCodeChallenge(verifier, 'plain');
      expect(challenge).toBe(verifier);
    });
  });
});

// ---------------------------------------------------------------------------
// validateCodeChallenge
// ---------------------------------------------------------------------------
describe('validateCodeChallenge', () => {
  it('returns true when verifier matches challenge via S256', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier, 'S256');
    expect(validateCodeChallenge(verifier, challenge, 'S256')).toBe(true);
  });

  it('returns false when a wrong verifier is supplied (S256)', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier, 'S256');
    const wrongVerifier = generateCodeVerifier();
    expect(validateCodeChallenge(wrongVerifier, challenge, 'S256')).toBe(false);
  });

  it('returns true when verifier matches challenge via plain', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier, 'plain');
    expect(validateCodeChallenge(verifier, challenge, 'plain')).toBe(true);
  });

  it('returns false for plain method when verifiers differ', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier, 'plain');
    expect(validateCodeChallenge('wrong-verifier', challenge, 'plain')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createPKCEAuthorizationUrl
// ---------------------------------------------------------------------------
describe('createPKCEAuthorizationUrl', () => {
  const CALLBACK = 'https://example.com/callback';

  it('returns an object with url and codeVerifier', () => {
    const result = createPKCEAuthorizationUrl('google', CALLBACK);
    expect(result).toHaveProperty('url');
    expect(result).toHaveProperty('codeVerifier');
    expect(typeof result.url).toBe('string');
    expect(typeof result.codeVerifier).toBe('string');
  });

  it('includes code_challenge in the authorization URL', () => {
    const { url } = createPKCEAuthorizationUrl('google', CALLBACK);
    const parsed = new URL(url);
    expect(parsed.searchParams.has('code_challenge')).toBe(true);
    expect(parsed.searchParams.get('code_challenge')).not.toBe('');
  });

  it('includes code_challenge_method=S256 in the authorization URL', () => {
    const { url } = createPKCEAuthorizationUrl('google', CALLBACK);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('the code_challenge is the S256 hash of the returned codeVerifier', () => {
    const { url, codeVerifier } = createPKCEAuthorizationUrl('google', CALLBACK);
    const parsed = new URL(url);
    const challenge = parsed.searchParams.get('code_challenge')!;
    const expected = createHash('sha256').update(codeVerifier).digest('base64url');
    expect(challenge).toBe(expected);
  });

  it('codeVerifier is URL-safe with length 43-128', () => {
    const { codeVerifier } = createPKCEAuthorizationUrl('google', CALLBACK);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
  });

  it('works for github provider', () => {
    const { url } = createPKCEAuthorizationUrl('github', CALLBACK);
    expect(url).toContain('github.com');
    expect(url).toContain('code_challenge');
  });
});

// ---------------------------------------------------------------------------
// createOAuthAuthorizationUrl with PKCE options (state store persistence)
// ---------------------------------------------------------------------------
describe('createOAuthAuthorizationUrl with PKCE options', () => {
  const CALLBACK = 'https://example.com/callback';

  it('embeds code_challenge and code_challenge_method when pkce is supplied', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier, 'S256');
    const url = createOAuthAuthorizationUrl('google', CALLBACK, undefined, {
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
      codeVerifier: verifier,
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('code_challenge')).toBe(challenge);
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('does NOT add code_challenge when pkce is omitted', () => {
    const url = createOAuthAuthorizationUrl('google', CALLBACK);
    const parsed = new URL(url);
    expect(parsed.searchParams.has('code_challenge')).toBe(false);
    expect(parsed.searchParams.has('code_challenge_method')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// exchangeOAuthCode PKCE validation
// ---------------------------------------------------------------------------
describe('exchangeOAuthCode PKCE validation', () => {
  it('throws when codeChallenge was stored but codeVerifier is not supplied', async () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier, 'S256');

    await expect(
      exchangeOAuthCode('google', 'auth-code', 'https://example.com/cb', {
        // codeVerifier intentionally omitted
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
      }),
    ).rejects.toThrow('PKCE code_verifier is required');
  });

  it('throws when the supplied codeVerifier does not match the stored challenge', async () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier, 'S256');
    const wrongVerifier = generateCodeVerifier();

    await expect(
      exchangeOAuthCode('google', 'auth-code', 'https://example.com/cb', {
        codeVerifier: wrongVerifier, // intentionally wrong
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
      }),
    ).rejects.toThrow('PKCE code_verifier does not match stored code_challenge');
  });

  it('proceeds to the network call when verifier matches (fetch is not available in test env — expect network error, not PKCE error)', async () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier, 'S256');

    // PKCE validation itself should pass; the rejection comes from the network
    // (no real provider reachable in tests), not from our PKCE check.
    const result = exchangeOAuthCode('google', 'auth-code', 'https://example.com/cb', {
      codeVerifier: verifier,
      codeChallenge: challenge,
      codeChallengeMethod: 'S256',
    });

    await expect(result).rejects.not.toThrow('PKCE code_verifier does not match');
  });
});
