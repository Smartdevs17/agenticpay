/**
 * Sensitive-operation audit logging — Issue #793
 *
 * Records every request that touches a sensitive area (authentication,
 * payments, administration, identity, compliance) to the tamper-evident
 * {@link auditService}. Each entry captures the timestamp, acting user,
 * action, IP address, and outcome required by the issue.
 *
 * Unlike the generic `auditMiddleware`, this middleware only logs a curated
 * set of sensitive route prefixes so the audit log stays focused and cheap.
 */

import type { NextFunction, Request, Response } from 'express';
import { auditService, type AuditOutcome } from '../services/auditService.js';

export type SensitiveCategory = 'auth' | 'payments' | 'admin' | 'identity' | 'compliance';

/** Route fragments that identify a sensitive operation. */
const SENSITIVE_PATTERNS: Array<{ category: SensitiveCategory; pattern: RegExp }> = [
  {
    category: 'auth',
    pattern: /(^|\/)(auth|login|logout|register|signup|sign-up|password|reset|2fa|mfa|otp|sessions?|token|oauth)(\/|$)/i,
  },
  {
    category: 'payments',
    pattern:
      /(^|\/)(payments?|transfers?|payouts?|withdrawals?|refunds?|invoices?|escrow|subscriptions?|fiat-payments|payment-links|splits|allowances)(\/|$)/i,
  },
  {
    category: 'admin',
    pattern: /(^|\/)(admin|users?|roles?|permissions?|api-keys?|secrets?|merchants?|flags?|config|impersonate)(\/|$)/i,
  },
  {
    category: 'identity',
    pattern: /(^|\/)(kyb|kyc|verification|zk-identity|reputation)(\/|$)/i,
  },
  {
    category: 'compliance',
    pattern: /(^|\/)(audit|compliance|security|gdpr|sanctions)(\/|$)/i,
  },
];

const DEFAULT_EXCLUDE_PATHS = ['/health', '/metrics', '/docs', '/api/v1/cold-start'];

/** Classify a request path into a sensitive category, or `undefined` if it is not sensitive. */
export function classifySensitivePath(path: string): SensitiveCategory | undefined {
  for (const { category, pattern } of SENSITIVE_PATTERNS) {
    if (pattern.test(path)) return category;
  }
  return undefined;
}

/** True when the request path touches a sensitive area. */
export function isSensitiveOperation(path: string): boolean {
  return classifySensitivePath(path) !== undefined;
}

export interface SensitiveAuditOptions {
  /** Extra path prefixes to skip (in addition to the built-in defaults). */
  excludePaths?: string[];
  /** Override how the action label is derived. */
  actionMapper?: (req: Request, category: SensitiveCategory) => string;
  /** Override how the acting user is resolved. */
  userIdResolver?: (req: Request) => string | undefined;
}

function defaultUserResolver(req: Request): string | undefined {
  const user = (req as Request & { user?: { id?: string; email?: string } }).user;
  if (user?.id) return user.id;
  if (user?.email) return user.email;
  const header = req.headers['x-user-id'];
  if (typeof header === 'string' && header) return header;
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey) return `api-key:${apiKey.slice(0, 8)}`;
  return undefined;
}

function defaultActionMapper(req: Request, category: SensitiveCategory): string {
  return `${category}.${req.method.toLowerCase()}`;
}

/**
 * Express middleware factory that writes an audit entry once the response
 * finishes (or the connection closes) for sensitive requests only.
 */
export function sensitiveAuditMiddleware(options: SensitiveAuditOptions = {}) {
  const excludePaths = [...DEFAULT_EXCLUDE_PATHS, ...(options.excludePaths ?? [])];

  return (req: Request, res: Response, next: NextFunction): void => {
    const category = classifySensitivePath(req.path);
    if (!category || excludePaths.some((prefix) => req.path.startsWith(prefix))) {
      next();
      return;
    }

    const startedAt = Date.now();
    let recorded = false;

    const record = (forcedOutcome?: AuditOutcome) => {
      if (recorded) return;
      recorded = true;

      const status = res.statusCode;
      const outcome: AuditOutcome = forcedOutcome ?? (status >= 400 ? 'failure' : 'success');

      void auditService
        .logAction({
          userId: (options.userIdResolver ?? defaultUserResolver)(req),
          action: (options.actionMapper ?? defaultActionMapper)(req, category),
          resource: category,
          resourceId: typeof req.params?.id === 'string' ? req.params.id : undefined,
          outcome,
          ipAddress: req.ip || req.socket?.remoteAddress,
          userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
          details: {
            category,
            outcome,
            method: req.method,
            path: req.path,
            statusCode: status,
            durationMs: Date.now() - startedAt,
          },
          request: {
            method: req.method,
            path: req.path,
            body: req.body,
          },
          response: {
            status,
          },
        })
        .catch((error: unknown) => {
          console.error('[sensitive-audit] Failed to write audit entry', error);
        });
    };

    res.on('finish', () => record());
    res.on('close', () => {
      // Aborted responses never emit `finish`; treat them as failures.
      if (!res.writableFinished) record('failure');
    });

    next();
  };
}

export const auditSensitiveOperations = sensitiveAuditMiddleware;
export default sensitiveAuditMiddleware;
