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

const stateStore = new Map<string, { provider: OAuthProvider; expiresAt: number; redirectTo?: string }>();
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

export function createOAuthAuthorizationUrl(provider: OAuthProvider, callbackUrl: string, redirectTo?: string): string {
  const config = requireConfig(provider);
  const state = randomBytes(24).toString('base64url');
  stateStore.set(state, { provider, expiresAt: Date.now() + STATE_TTL_MS, redirectTo });

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
  return url.toString();
}

export function consumeOAuthState(provider: OAuthProvider, state: string): { redirectTo?: string } {
  const stored = stateStore.get(state);
  stateStore.delete(state);

  if (!stored || stored.provider !== provider || stored.expiresAt < Date.now()) {
    throw new Error('Invalid or expired OAuth state');
  }

  return { redirectTo: stored.redirectTo };
}

export async function exchangeOAuthCode(
  provider: OAuthProvider,
  code: string,
  callbackUrl: string,
): Promise<OAuthUserProfile> {
  const config = requireConfig(provider);
  const tokenResponse = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: config.clientId!,
      client_secret: config.clientSecret!,
      code,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    }),
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

export function createOAuthSessionToken(profile: OAuthUserProfile): string {
  const payload = JSON.stringify({
    provider: profile.provider,
    providerUserId: profile.providerUserId,
    email: profile.email,
    issuedAt: Date.now(),
  });
  return createHash('sha256').update(payload).digest('hex');
}
