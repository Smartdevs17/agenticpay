/**
 * Issue #1161: Strengthen payment security (iteration 6)
 * 
 * Enhanced security middleware for payout operations
 * Implements additional validation, fraud detection, and audit logging
 */

import type { Request, Response, NextFunction } from 'express';
import { createHash, randomBytes } from 'node:crypto';

export interface SecurityConfig {
  /** Maximum payout amount before additional verification */
  maxAmountWithoutReview: number;
  /** Enable velocity checks */
  enableVelocityChecks: boolean;
  /** Maximum payouts per merchant per day */
  maxPayoutsPerDay: number;
  /** Maximum total payout amount per merchant per day */
  maxDailyAmount: number;
  /** Enable IP geolocation checks */
  enableGeoChecks: boolean;
  /** Require 2FA for large payouts */
  require2FAThreshold: number;
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  maxAmountWithoutReview: 10000,
  enableVelocityChecks: true,
  maxPayoutsPerDay: 100,
  maxDailyAmount: 100000,
  enableGeoChecks: true,
  require2FAThreshold: 25000,
};

interface PayoutAttempt {
  merchantId: string;
  amount: number;
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
}

interface SecurityViolation {
  type: 'velocity' | 'amount' | 'geo' | 'pattern' | '2fa';
  severity: 'low' | 'medium' | 'high';
  message: string;
  details?: Record<string, unknown>;
}

/**
 * In-memory store for payout attempts (would use Redis in production)
 */
class PayoutAttemptStore {
  private attempts: Map<string, PayoutAttempt[]> = new Map();

  add(attempt: PayoutAttempt): void {
    const key = `${attempt.merchantId}:${this.getDayKey(attempt.timestamp)}`;
    const existing = this.attempts.get(key) || [];
    existing.push(attempt);
    this.attempts.set(key, existing);
  }

  getForMerchantToday(merchantId: string): PayoutAttempt[] {
    const key = `${merchantId}:${this.getDayKey(new Date())}`;
    return this.attempts.get(key) || [];
  }

  getTotalAmountToday(merchantId: string): number {
    const attempts = this.getForMerchantToday(merchantId);
    return attempts.reduce((sum, attempt) => sum + attempt.amount, 0);
  }

  getCountToday(merchantId: string): number {
    return this.getForMerchantToday(merchantId).length;
  }

  private getDayKey(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  cleanup(): void {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const cutoffKey = this.getDayKey(yesterday);

    for (const [key] of this.attempts) {
      const dayKey = key.split(':')[1];
      if (dayKey < cutoffKey) {
        this.attempts.delete(key);
      }
    }
  }
}

const attemptStore = new PayoutAttemptStore();

/**
 * Security middleware for payout requests
 */
export function payoutSecurityMiddleware(config: SecurityConfig = DEFAULT_SECURITY_CONFIG) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { merchantId, amount, asset } = req.body;
      const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';

      // Record attempt
      const attempt: PayoutAttempt = {
        merchantId,
        amount: Number(amount),
        timestamp: new Date(),
        ipAddress,
        userAgent,
      };
      attemptStore.add(attempt);

      // Run security checks
      const violations = await runSecurityChecks(attempt, config, req);

      if (violations.length > 0) {
        // Check for high severity violations
        const highSeverity = violations.filter((v) => v.severity === 'high');
        
        if (highSeverity.length > 0) {
          // Block request
          res.status(403).json({
            error: {
              code: 'SECURITY_VIOLATION',
              message: 'Payout request blocked due to security concerns',
              violations: highSeverity.map((v) => ({
                type: v.type,
                message: v.message,
              })),
            },
          });
          return;
        }

        // Medium/low severity: flag for review
        req.body._securityFlags = violations;
        req.body._requiresReview = true;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Run all security checks
 */
async function runSecurityChecks(
  attempt: PayoutAttempt,
  config: SecurityConfig,
  req: Request
): Promise<SecurityViolation[]> {
  const violations: SecurityViolation[] = [];

  // 1. Amount threshold check
  if (attempt.amount > config.maxAmountWithoutReview) {
    violations.push({
      type: 'amount',
      severity: 'medium',
      message: `Payout amount ${attempt.amount} exceeds review threshold`,
      details: { amount: attempt.amount, threshold: config.maxAmountWithoutReview },
    });
  }

  // 2. Velocity checks
  if (config.enableVelocityChecks) {
    const todayCount = attemptStore.getCountToday(attempt.merchantId);
    const todayAmount = attemptStore.getTotalAmountToday(attempt.merchantId);

    if (todayCount >= config.maxPayoutsPerDay) {
      violations.push({
        type: 'velocity',
        severity: 'high',
        message: 'Daily payout count limit exceeded',
        details: { count: todayCount, limit: config.maxPayoutsPerDay },
      });
    }

    if (todayAmount >= config.maxDailyAmount) {
      violations.push({
        type: 'velocity',
        severity: 'high',
        message: 'Daily payout amount limit exceeded',
        details: { amount: todayAmount, limit: config.maxDailyAmount },
      });
    }
  }

  // 3. 2FA check
  if (attempt.amount >= config.require2FAThreshold) {
    const has2FA = req.headers['x-2fa-token'] !== undefined;
    if (!has2FA) {
      violations.push({
        type: '2fa',
        severity: 'high',
        message: '2FA required for large payouts',
        details: { amount: attempt.amount, threshold: config.require2FAThreshold },
      });
    }
  }

  // 4. Pattern detection (simple example)
  const recentAttempts = attemptStore.getForMerchantToday(attempt.merchantId);
  const rapidAttempts = recentAttempts.filter(
    (a) => a.timestamp.getTime() > Date.now() - 60000 // Last minute
  );

  if (rapidAttempts.length > 5) {
    violations.push({
      type: 'pattern',
      severity: 'medium',
      message: 'Unusual payout frequency detected',
      details: { recentCount: rapidAttempts.length },
    });
  }

  // 5. Geo checks (simplified - would use real IP geolocation service)
  if (config.enableGeoChecks) {
    const isSuspiciousIP = await checkIPReputation(attempt.ipAddress);
    if (isSuspiciousIP) {
      violations.push({
        type: 'geo',
        severity: 'medium',
        message: 'Request from suspicious IP address',
        details: { ip: attempt.ipAddress },
      });
    }
  }

  return violations;
}

/**
 * Check IP reputation (placeholder - would integrate with actual service)
 */
async function checkIPReputation(ipAddress: string): Promise<boolean> {
  // Placeholder: In production, integrate with IP reputation services
  // like MaxMind, IPQualityScore, etc.
  const suspiciousIPs = new Set(['0.0.0.0', '127.0.0.1']);
  return suspiciousIPs.has(ipAddress);
}

/**
 * Generate secure idempotency key
 */
export function generateSecureIdempotencyKey(merchantId: string, nonce?: string): string {
  const data = `${merchantId}:${nonce || randomBytes(16).toString('hex')}:${Date.now()}`;
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Verify request signature (webhook/API signature verification)
 */
export function verifyRequestSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = createHash('sha256')
    .update(payload + secret)
    .digest('hex');
  
  return signature === expectedSignature;
}

/**
 * Rate limiting by merchant ID
 */
export function merchantRateLimiter(
  windowMs: number = 60000,
  maxRequests: number = 10
) {
  const requests = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const merchantId = req.body.merchantId || req.params.merchantId;
    if (!merchantId) {
      next();
      return;
    }

    const now = Date.now();
    const windowStart = now - windowMs;
    
    let timestamps = requests.get(merchantId) || [];
    timestamps = timestamps.filter((ts) => ts > windowStart);

    if (timestamps.length >= maxRequests) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests. Maximum ${maxRequests} per ${windowMs / 1000} seconds`,
          retryAfter: Math.ceil((timestamps[0] + windowMs - now) / 1000),
        },
      });
      return;
    }

    timestamps.push(now);
    requests.set(merchantId, timestamps);
    next();
  };
}

/**
 * Audit logger for security events
 */
export class SecurityAuditLogger {
  private logs: Array<{
    timestamp: Date;
    event: string;
    merchantId: string;
    details: Record<string, unknown>;
  }> = [];

  log(event: string, merchantId: string, details: Record<string, unknown>): void {
    this.logs.push({
      timestamp: new Date(),
      event,
      merchantId,
      details,
    });

    // In production, send to logging service (e.g., CloudWatch, Datadog)
    console.log('[SECURITY AUDIT]', { event, merchantId, details });
  }

  getLogs(merchantId?: string): Array<typeof this.logs[0]> {
    if (merchantId) {
      return this.logs.filter((log) => log.merchantId === merchantId);
    }
    return this.logs;
  }
}

export const securityAuditLogger = new SecurityAuditLogger();

// Cleanup old attempts daily
setInterval(() => {
  attemptStore.cleanup();
}, 24 * 60 * 60 * 1000);
