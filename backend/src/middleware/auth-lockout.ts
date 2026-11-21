import { Request, Response, NextFunction } from "express";
import {
  AccountLockoutService,
  LockoutStatus,
} from "../services/account-lockout";
import { Redis } from "ioredis";

let lockoutService: AccountLockoutService | null = null;

export function initializeAuthLockout(redis: Redis): void {
  lockoutService = new AccountLockoutService(redis, {
    maxAttempts: 5,
    baseDelaySeconds: 2,
    maxDelaySeconds: 300,
    lockoutDurationSeconds: 900,
    progressiveMultiplier: 2,
  });
}

function getIdentifier(req: Request): string {
  const email = req.body?.email || req.body?.username;
  const ip = req.ip || req.connection.remoteAddress;
  return email ? `email:${email}` : `ip:${ip}`;
}

export function checkAuthLockout() {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (!lockoutService) {
      return next();
    }

    const identifier = getIdentifier(req);
    const { allowed, status } =
      await lockoutService.isAllowedToAttempt(identifier);

    if (!allowed) {
      if (status.isLocked) {
        res.status(429).json({
          error: "Account locked",
          message:
            "Too many failed authentication attempts. Please try again later.",
          lockoutEndsAt: status.lockoutEndsAt,
          retryAfter: status.lockoutEndsAt
            ? Math.ceil((status.lockoutEndsAt.getTime() - Date.now()) / 1000)
            : undefined,
        });
        return;
      }

      if (status.requiredDelaySeconds) {
        res.status(429).json({
          error: "Rate limited",
          message: "Please wait before attempting again",
          nextAttemptAllowedAt: status.nextAttemptAllowedAt,
          requiredDelaySeconds: status.requiredDelaySeconds,
        });
        return;
      }
    }

    req.lockoutIdentifier = identifier;
    next();
  };
}

export function recordAuthFailure() {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (!lockoutService || !req.lockoutIdentifier) {
      return next();
    }

    const originalJson = res.json.bind(res);

    res.json = function (data: any) {
      if (res.statusCode === 401 || res.statusCode === 403) {
        lockoutService!
          .recordFailedAttempt(req.lockoutIdentifier!)
          .then((status) => {
            res.setHeader(
              "X-RateLimit-Remaining",
              status.attemptsRemaining.toString(),
            );

            if (status.requiredDelaySeconds) {
              res.setHeader(
                "X-RateLimit-Retry-After",
                status.requiredDelaySeconds.toString(),
              );
            }

            if (status.isLocked) {
              res.setHeader(
                "Retry-After",
                Math.ceil(
                  (status.lockoutEndsAt!.getTime() - Date.now()) / 1000,
                ).toString(),
              );
            }
          })
          .catch((error) => {
            console.error("Error recording auth failure:", error);
          });
      }

      return originalJson(data);
    };

    next();
  };
}

export async function clearAuthLockout(identifier: string): Promise<void> {
  if (lockoutService) {
    await lockoutService.clearLockout(identifier);
  }
}

declare global {
  namespace Express {
    interface Request {
      lockoutIdentifier?: string;
    }
  }
}
