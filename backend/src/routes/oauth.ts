import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  OAuthProvider,
  consumeOAuthState,
  createOAuthAuthorizationUrl,
  createOAuthSessionToken,
  exchangeOAuthCode,
} from '../services/oauth-service.js';

export const oauthRouter = Router();

const providerSchema = z.enum(['google', 'github']);

function callbackUrl(req: Request, provider: OAuthProvider): string {
  const configured = process.env.OAUTH_CALLBACK_BASE_URL;
  if (configured) return `${configured.replace(/\/$/, '')}/api/v1/auth/oauth/${provider}/callback`;
  return `${req.protocol}://${req.get('host')}/api/v1/auth/oauth/${provider}/callback`;
}

oauthRouter.get('/:provider', (req: Request, res: Response) => {
  try {
    const provider = providerSchema.parse(req.params.provider);
    const redirectTo = typeof req.query.redirectTo === 'string' ? req.query.redirectTo : undefined;
    res.redirect(createOAuthAuthorizationUrl(provider, callbackUrl(req, provider), redirectTo));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid OAuth request' });
  }
});

oauthRouter.get('/:provider/callback', async (req: Request, res: Response) => {
  try {
    const provider = providerSchema.parse(req.params.provider);
    const code = z.string().min(1).parse(req.query.code);
    const state = z.string().min(1).parse(req.query.state);
    const { redirectTo } = consumeOAuthState(provider, state);
    const profile = await exchangeOAuthCode(provider, code, callbackUrl(req, provider));
    const token = createOAuthSessionToken(profile);

    const frontendCallback = new URL(
      redirectTo || process.env.OAUTH_FRONTEND_CALLBACK_URL || '/auth/oauth/callback',
      process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`,
    );
    frontendCallback.searchParams.set('provider', profile.provider);
    frontendCallback.searchParams.set('token', token);
    if (profile.email) frontendCallback.searchParams.set('email', profile.email);
    if (profile.name) frontendCallback.searchParams.set('name', profile.name);
    if (profile.avatarUrl) frontendCallback.searchParams.set('avatarUrl', profile.avatarUrl);

    res.redirect(frontendCallback.toString());
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'OAuth callback failed' });
  }
});
