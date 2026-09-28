import { createHash, randomBytes } from 'node:crypto';

export type OAuthProvider = 'google' | 'github';

export interface OAuthUserProfile {
  provider: OAuthProvider;
  providerUserId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

interface OAuthProviderConfig {
  authorizationUrl: string;
  tokenUrl: string;
  profileUrl: string;
  emailUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scopes: string[];
}

interface StateEntry {
  provider: OAuthProvider;
  expiresAt: number;
  redirectTo?: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256' | 'plain';
}

const stateStore = new Map<string, StateEntry>();
const STATE_TTL_MS = 10 * 60 * 1000;

function getProviderConfig(provider: OAuthProvider): OAuthProviderConfig {
  if (provider === 'google') {
    return {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      profileUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      scopes: ['openid', 'email', 'profile'],
    };
  }

  return {
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    profileUrl: 'https://api.github.com/user',
    emailUrl: 'https://api.github.com/user/emails',
    clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
    clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
    scopes: ['read:user', 'user:email'],
  };
}

function requireConfig(provider: OAuthProvider): OAuthProviderConfig {
  const config = getProviderConfig(provider);
  if (!config.clientId || !config.clientSecret) {
    throw new Error(`${provider} OAuth is not configured`);
  }
  return config;
}

// ---------------------------------------------------------------------------
// PKCE utilities (RFC 7636)
// ---------------------------------------------------------------------------

/**
 * Generates a cryptographically secure code verifier (43-128 URL-safe chars).
 */
export function generateCodeVerifier(): string {
  // 32 random bytes → 43-char base64url string (well within 43–128 range)
  return randomBytes(32).toString('base64url');
}

/**
 * Derives the code challenge from the verifier.
 * - S256: BASE64URL(SHA256(ASCII(code_verifier)))
 * - plain: code_verifier unchanged
 */
export function generateCodeChallenge(verifier: string, method: 'S256' | 'plain'): string {
  if (method === 'plain') {
    return verifier;
  }
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Validates that the supplied verifier matches the stored challenge.
 */
export function validateCodeChallenge(
  verifier: string,
  challenge: string,
  method: 'S256' | 'plain',
): boolean {
  const expected = generateCodeChallenge(verifier, method);
  return expected === challenge;
}

// ---------------------------------------------------------------------------
// Authorization URL creation
// ---------------------------------------------------------------------------

export interface PKCEOptions {
  codeChallenge: string;
  codeChallengeMethod: 'S256' | 'plain';
  codeVerifier: string;
}

export interface CreateAuthUrlResult {
  url: string;
  codeVerifier?: string;
}

/**
 * Creates an OAuth authorization URL.
 * When `pkce` is supplied the PKCE parameters are embedded in the URL and the
 * challenge is persisted in the state store so it can be validated during the
 * token exchange.
 *
 * Returns the URL string for backwards-compatibility.  When PKCE is used the
 * returned value is still a plain string – callers that need the codeVerifier
 * should use `createPKCEAuthorizationUrl` instead.
 */
export function createOAuthAuthorizationUrl(
  provider: OAuthProvider,
  callbackUrl: string,
  redirectTo?: string,
  pkce?: PKCEOptions,
): string {
  const config = requireConfig(provider);
  const state = randomBytes(24).toString('base64url');

  const entry: StateEntry = {
    provider,
    expiresAt: Date.now() + STATE_TTL_MS,
    redirectTo,
  };

  if (pkce) {
    entry.codeChallenge = pkce.codeChallenge;
    entry.codeChallengeMethod = pkce.codeChallengeMethod;
  }

  stateStore.set(state, entry);

  const url = new URL(config.authorizationUrl);
  url.searchParams.set('client_id', config.clientId!);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', state);

  if (provider === 'google') {
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'select_account');
  }

  if (pkce) {
    url.searchParams.set('code_challenge', pkce.codeChallenge);
    url.searchParams.set('code_challenge_method', pkce.codeChallengeMethod);
  }

  return url.toString();
}

/**
 * Convenience function that generates a PKCE verifier + S256 challenge,
 * builds the authorization URL, and returns both so the caller can pass the
 * verifier to the token exchange step.
 */
export function createPKCEAuthorizationUrl(
  provider: OAuthProvider,
  callbackUrl: string,
  redirectTo?: string,
): { url: string; codeVerifier: string } {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier, 'S256');

  const url = createOAuthAuthorizationUrl(provider, callbackUrl, redirectTo, {
    codeChallenge,
    codeChallengeMethod: 'S256',
    codeVerifier,
  });

  return { url, codeVerifier };
}

// ---------------------------------------------------------------------------
// State consumption
// ---------------------------------------------------------------------------

export function consumeOAuthState(
  provider: OAuthProvider,
  state: string,
): { redirectTo?: string; codeChallenge?: string; codeChallengeMethod?: 'S256' | 'plain' } {
  const stored = stateStore.get(state);
  stateStore.delete(state);

  if (!stored || stored.provider !== provider || stored.expiresAt < Date.now()) {
    throw new Error('Invalid or expired OAuth state');
  }

  return {
    redirectTo: stored.redirectTo,
    codeChallenge: stored.codeChallenge,
    codeChallengeMethod: stored.codeChallengeMethod,
  };
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export async function exchangeOAuthCode(
  provider: OAuthProvider,
  code: string,
  callbackUrl: string,
  options?: {
    codeVerifier?: string;
    codeChallenge?: string;
    codeChallengeMethod?: 'S256' | 'plain';
  },
): Promise<OAuthUserProfile> {
  const config = requireConfig(provider);

  // PKCE validation: if a challenge was stored for this flow, the verifier
  // must be supplied and must match.
  if (options?.codeChallenge) {
    if (!options.codeVerifier) {
      throw new Error('PKCE code_verifier is required when a code_challenge was registered');
    }
    const method = options.codeChallengeMethod ?? 'S256';
    const valid = validateCodeChallenge(options.codeVerifier, options.codeChallenge, method);
    if (!valid) {
      throw new Error('PKCE code_verifier does not match stored code_challenge');
    }
  }

  const bodyParams: Record<string, string> = {
    client_id: config.clientId!,
    client_secret: config.clientSecret!,
    code,
    redirect_uri: callbackUrl,
    grant_type: 'authorization_code',
  };

  // Pass code_verifier to the provider if this is a PKCE flow.
  if (options?.codeVerifier) {
    bodyParams.code_verifier = options.codeVerifier;
  }

  const tokenResponse = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(bodyParams),
  });

  if (!tokenResponse.ok) {
    throw new Error(`OAuth token exchange failed with ${tokenResponse.status}`);
  }

  const tokenBody = await tokenResponse.json() as { access_token?: string };
  if (!tokenBody.access_token) {
    throw new Error('OAuth provider did not return an access token');
  }

  return provider === 'google'
    ? fetchGoogleProfile(config.profileUrl, tokenBody.access_token)
    : fetchGitHubProfile(config.profileUrl, config.emailUrl!, tokenBody.access_token);
}

// ---------------------------------------------------------------------------
// Profile fetchers (internal)
// ---------------------------------------------------------------------------

async function fetchGoogleProfile(profileUrl: string, accessToken: string): Promise<OAuthUserProfile> {
  const response = await fetch(profileUrl, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Google profile request failed with ${response.status}`);
  const profile = await response.json() as { id: string; email?: string; name?: string; picture?: string };
  return {
    provider: 'google',
    providerUserId: profile.id,
    email: profile.email ?? null,
    name: profile.name ?? null,
    avatarUrl: profile.picture ?? null,
  };
}

async function fetchGitHubProfile(
  profileUrl: string,
  emailUrl: string,
  accessToken: string,
): Promise<OAuthUserProfile> {
  const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json' };
  const [profileResponse, emailResponse] = await Promise.all([
    fetch(profileUrl, { headers }),
    fetch(emailUrl, { headers }),
  ]);

  if (!profileResponse.ok) throw new Error(`GitHub profile request failed with ${profileResponse.status}`);
  const profile = await profileResponse.json() as { id: number; email?: string | null; name?: string | null; avatar_url?: string };
  let email = profile.email ?? null;

  if (emailResponse.ok) {
    const emails = await emailResponse.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
    email = emails.find((item) => item.primary && item.verified)?.email ?? email;
  }

  return {
    provider: 'github',
    providerUserId: String(profile.id),
    email,
    name: profile.name ?? null,
    avatarUrl: profile.avatar_url ?? null,
  };
}

// ---------------------------------------------------------------------------
// Session token
// ---------------------------------------------------------------------------

export function createOAuthSessionToken(profile: OAuthUserProfile): string {
  const payload = JSON.stringify({
    provider: profile.provider,
    providerUserId: profile.providerUserId,
    email: profile.email,
    issuedAt: Date.now(),
  });
  return createHash('sha256').update(payload).digest('hex');
}
