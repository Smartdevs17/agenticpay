import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from './errorHandler.js';
import {
  getWebhookJwtConfig,
  isWebhookJwtToken,
  verifyWebhookJwt,
  type WebhookJwtClaims,
  type WebhookJwtConfig,
} from '../webhooks/jwt.js';

type WebhookJwtRequest = Request & { webhookJwt?: WebhookJwtClaims };

export interface WebhookJwtAuthOptions {
  config?: WebhookJwtConfig;
  required?: boolean;
}

export function extractWebhookJwt(req: Request): string | undefined {
  const dedicated = req.headers['x-webhook-jwt'];
  if (typeof dedicated === 'string' && dedicated.trim()) return dedicated.trim();
  if (Array.isArray(dedicated) && dedicated[0]?.trim()) return dedicated[0].trim();

  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return undefined;
  const bearer = authorization.slice('Bearer '.length).trim();
  return bearer && isWebhookJwtToken(bearer) ? bearer : undefined;
}

export function webhookJwtAuth(options: WebhookJwtAuthOptions = {}): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = extractWebhookJwt(req);
    if (!token) {
      if (options.required) {
        next(new AppError(401, 'Webhook JWT required', 'WEBHOOK_JWT_REQUIRED'));
        return;
      }
      next();
      return;
    }

    let config: WebhookJwtConfig;
    try {
      config = options.config ?? getWebhookJwtConfig();
    } catch (error) {
      next(new AppError(503, 'Webhook JWT verification is not configured', 'WEBHOOK_JWT_CONFIG_MISSING'));
      return;
    }

    const result = verifyWebhookJwt(token, config);
    if (!result.valid) {
      next(new AppError(401, `Webhook JWT rejected: ${result.reason}`, 'WEBHOOK_JWT_INVALID'));
      return;
    }

    (req as WebhookJwtRequest).webhookJwt = result.claims;
    next();
  };
}

export const requireWebhookJwt = webhookJwtAuth({ required: true });
export default webhookJwtAuth;
