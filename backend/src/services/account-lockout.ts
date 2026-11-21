import { Redis } from "ioredis";

export interface LockoutConfig {
  maxAttempts: number;
  baseDelaySeconds: number;
  maxDelaySeconds: number;
  lockoutDurationSeconds: number;
  progressiveMultiplier: number;
}

const defaultConfig: LockoutConfig = {
  maxAttempts: 5,
  baseDelaySeconds: 1,
  maxDelaySeconds: 300,
  lockoutDurationSeconds: 900,
  progressiveMultiplier: 2,
};

export interface LockoutStatus {
  isLocked: boolean;
  attemptsRemaining: number;
  lockoutEndsAt?: Date;
  nextAttemptAllowedAt?: Date;
  requiredDelaySeconds?: number;
}

export class AccountLockoutService {
  private redis: Redis;
  private config: LockoutConfig;
  private keyPrefix = "lockout";

  constructor(redis: Redis, config: Partial<LockoutConfig> = {}) {
    this.redis = redis;
    this.config = { ...defaultConfig, ...config };
  }

  private getKey(identifier: string, suffix: string): string {
    return `${this.keyPrefix}:${identifier}:${suffix}`;
  }

  private calculateDelay(attemptCount: number): number {
    const delay =
      this.config.baseDelaySeconds *
      Math.pow(this.config.progressiveMultiplier, attemptCount - 1);
    return Math.min(delay, this.config.maxDelaySeconds);
  }

  async recordFailedAttempt(identifier: string): Promise<LockoutStatus> {
    const attemptsKey = this.getKey(identifier, "attempts");
    const lockoutKey = this.getKey(identifier, "locked");
    const lastAttemptKey = this.getKey(identifier, "lastAttempt");

    const pipeline = this.redis.pipeline();
    pipeline.incr(attemptsKey);
    pipeline.get(lockoutKey);
    pipeline.get(lastAttemptKey);
    const results = await pipeline.exec();

    if (!results) {
      throw new Error("Redis pipeline failed");
    }

    const attemptCount = results[0][1] as number;
    const lockoutUntil = results[1][1] as string | null;
    const lastAttempt = results[2][1] as string | null;

    const now = Date.now();
    await this.redis.setex(
      lastAttemptKey,
      this.config.lockoutDurationSeconds,
      now.toString(),
    );

    if (attemptCount === 1) {
      await this.redis.expire(attemptsKey, this.config.lockoutDurationSeconds);
    }

    if (attemptCount >= this.config.maxAttempts) {
      const lockoutUntilTime = now + this.config.lockoutDurationSeconds * 1000;
      await this.redis.setex(
        lockoutKey,
        this.config.lockoutDurationSeconds,
        lockoutUntilTime.toString(),
      );

      return {
        isLocked: true,
        attemptsRemaining: 0,
        lockoutEndsAt: new Date(lockoutUntilTime),
      };
    }

    const delay = this.calculateDelay(attemptCount);
    const nextAttemptAllowed = now + delay * 1000;

    return {
      isLocked: false,
      attemptsRemaining: this.config.maxAttempts - attemptCount,
      nextAttemptAllowedAt: new Date(nextAttemptAllowed),
      requiredDelaySeconds: delay,
    };
  }

  async checkLockoutStatus(identifier: string): Promise<LockoutStatus> {
    const attemptsKey = this.getKey(identifier, "attempts");
    const lockoutKey = this.getKey(identifier, "locked");
    const lastAttemptKey = this.getKey(identifier, "lastAttempt");

    const pipeline = this.redis.pipeline();
    pipeline.get(attemptsKey);
    pipeline.get(lockoutKey);
    pipeline.get(lastAttemptKey);
    const results = await pipeline.exec();

    if (!results) {
      throw new Error("Redis pipeline failed");
    }

    const attemptCount = parseInt((results[0][1] as string) || "0", 10);
    const lockoutUntil = results[1][1] as string | null;
    const lastAttempt = results[2][1] as string | null;

    const now = Date.now();

    if (lockoutUntil) {
      const lockoutTime = parseInt(lockoutUntil, 10);
      if (lockoutTime > now) {
        return {
          isLocked: true,
          attemptsRemaining: 0,
          lockoutEndsAt: new Date(lockoutTime),
        };
      }
    }

    if (attemptCount > 0 && lastAttempt) {
      const lastAttemptTime = parseInt(lastAttempt, 10);
      const delay = this.calculateDelay(attemptCount);
      const nextAttemptAllowed = lastAttemptTime + delay * 1000;

      if (nextAttemptAllowed > now) {
        return {
          isLocked: false,
          attemptsRemaining: this.config.maxAttempts - attemptCount,
          nextAttemptAllowedAt: new Date(nextAttemptAllowed),
          requiredDelaySeconds: Math.ceil((nextAttemptAllowed - now) / 1000),
        };
      }
    }

    return {
      isLocked: false,
      attemptsRemaining: this.config.maxAttempts - attemptCount,
    };
  }

  async clearLockout(identifier: string): Promise<void> {
    const attemptsKey = this.getKey(identifier, "attempts");
    const lockoutKey = this.getKey(identifier, "locked");
    const lastAttemptKey = this.getKey(identifier, "lastAttempt");

    await this.redis.del(attemptsKey, lockoutKey, lastAttemptKey);
  }

  async isAllowedToAttempt(
    identifier: string,
  ): Promise<{ allowed: boolean; status: LockoutStatus }> {
    const status = await this.checkLockoutStatus(identifier);

    if (status.isLocked) {
      return { allowed: false, status };
    }

    if (
      status.nextAttemptAllowedAt &&
      status.nextAttemptAllowedAt > new Date()
    ) {
      return { allowed: false, status };
    }

    return { allowed: true, status };
  }
}
