/**
 * credential-validation.ts — Issue #395
 *
 * Express middleware that validates API keys against the rotation service,
 * supporting the dual-key overlap window so in-flight requests are not
 * rejected during a rotation event.
 */

import type { Request, Response, NextFunction } from 'express';
import { getRotationService } from '../config/credential-rotation.js';

export interface CredentialValidationOptions {
  /** Header containing the API key. Default 'x-api-key'. */
  header?: string;
  /** Label of the credential to validate against. */
  credentialLabel: string;
  /** HTTP status for invalid keys. Default 401. */
  failStatus?: number;
}

export function validateApiKey(opts: CredentialValidationOptions) {
  const header = opts.header ?? 'x-api-key';
  const failStatus = opts.failStatus ?? 401;

  return function apiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
    const raw = req.headers[header];
    const key = Array.isArray(raw) ? raw[0] : raw;

    if (!key) {
      res.status(failStatus).json({
        error: { code: 'MISSING_API_KEY', message: 'API key is required' },
      });
      return;
    }

    const valid = getRotationService().validate(opts.credentialLabel, key);
    if (!valid) {
      res.status(failStatus).json({
        error: { code: 'INVALID_API_KEY', message: 'API key is invalid or has been revoked' },
      });
      return;
    }

    next();
  };
}
