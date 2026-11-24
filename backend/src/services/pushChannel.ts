/**
 * Push-first notification delivery with a silent-retry policy.
 *
 * Push is tried first for a user's registered devices. Transient transport failures are
 * retried in the background with capped exponential backoff, and the user sees nothing
 * until the final outcome is known. Permanent and unregistered failures are never retried.
 * A token the provider reports as unregistered is removed from the device registry. A
 * permanent failure keeps the token, because it may be a bug on our side rather than a dead device.
 *
 * The caller decides what happens after a failed push, for example falling back to email.
 * This module reports `no_devices` separately from `failed` so that a user with no devices
 * is not treated as a delivery error.
 */

import { logger } from '../utils/logger.js';

export interface PushMessage {
  title: string;
  body: string;
  /** Extra string data delivered with the push. Must be JSON-serialisable strings. */
  data?: Record<string, string>;
}

export type PushFailureKind = 'transient' | 'permanent' | 'unregistered';

/** Thrown by a `PushTransport` to classify a failed attempt. */
export class PushTransportError extends Error {
  constructor(
    readonly kind: PushFailureKind,
    message: string,
    /** Server-requested wait before the next attempt, in milliseconds. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'PushTransportError';
  }
}

/** Sends one message to one device token. Implementations throw `PushTransportError`. */
export interface PushTransport {
  send(token: string, message: PushMessage): Promise<void>;
}

export interface PushDeviceRegistry {
  tokensFor(userId: string): Promise<string[]>;
  removeToken(userId: string, token: string): Promise<void>;
}

export interface PushRetryPolicy {
  /** Total attempts per device token, including the first. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_PUSH_RETRY_POLICY: PushRetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
};

/** Observability events. Tokens are never included; only a short fingerprint is. */
export type PushEvent =
  | { type: 'attempt_failed'; userId: string; tokenHint: string; attempt: number; kind: PushFailureKind; delayMs?: number }
  | { type: 'token_removed'; userId: string; tokenHint: string; reason: PushFailureKind }
  | { type: 'delivered'; userId: string; devices: number; attemptsTotal: number }
  | { type: 'failed'; userId: string; devices: number; attemptsTotal: number };

export interface PushChannelOptions {
  transport: PushTransport;
  devices: PushDeviceRegistry;
  policy?: Partial<PushRetryPolicy>;
  /** Injectable for tests. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests. Defaults to Math.random. */
  random?: () => number;
  /** Metrics and log hook. Defaults to structured logs through the shared logger. */
  observe?: (event: PushEvent) => void;
}

export type PushResult =
  | { status: 'delivered'; devices: number; deliveredTo: number; attemptsTotal: number }
  | { status: 'no_devices'; devices: 0; deliveredTo: 0; attemptsTotal: 0 }
  | { status: 'failed'; devices: number; deliveredTo: 0; attemptsTotal: number };

/** A short, non-reversible hint for logs. Never the token itself. */
export function tokenHint(token: string): string {
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
  }
  return `tok_${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Delay before retry number `attempt` (1 for the first retry). Exponential, capped, with
 * "equal" jitter so devices do not retry in lockstep. A server-supplied wait is honoured but
 * still capped.
 */
export function pushRetryDelayMs(
  attempt: number,
  policy: PushRetryPolicy,
  retryAfterMs: number | undefined,
  random: () => number = Math.random,
): number {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, policy.maxDelayMs);
  }
  const exponent = Math.min(Math.max(attempt - 1, 0), 30);
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** exponent);
  const half = ceiling / 2;
  return Math.floor(half + random() * half);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultObserve(event: PushEvent): void {
  if (event.type === 'failed') {
    logger.warn({ ...event }, 'push notification failed for all devices');
  } else if (event.type === 'token_removed') {
    logger.info({ ...event }, 'push device token removed');
  }
}

export class PushChannel {
  private readonly transport: PushTransport;
  private readonly devices: PushDeviceRegistry;
  private readonly policy: PushRetryPolicy;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly observe: (event: PushEvent) => void;

  constructor(options: PushChannelOptions) {
    this.transport = options.transport;
    this.devices = options.devices;
    this.policy = { ...DEFAULT_PUSH_RETRY_POLICY, ...options.policy };
    if (!Number.isInteger(this.policy.maxAttempts) || this.policy.maxAttempts < 1) {
      throw new RangeError('maxAttempts must be a positive integer');
    }
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.observe = options.observe ?? defaultObserve;
  }

  /**
   * Pushes to every registered device of a user. Devices are tried independently, so one
   * dead token does not stop delivery to the others. Never throws for transport failures.
   */
  async send(userId: string, message: PushMessage): Promise<PushResult> {
    const tokens = await this.devices.tokensFor(userId);
    if (tokens.length === 0) {
      return { status: 'no_devices', devices: 0, deliveredTo: 0, attemptsTotal: 0 };
    }

    let deliveredTo = 0;
    let attemptsTotal = 0;
    for (const token of tokens) {
      const outcome = await this.deliverToDevice(userId, token, message);
      attemptsTotal += outcome.attempts;
      if (outcome.delivered) deliveredTo += 1;
    }

    if (deliveredTo > 0) {
      this.observe({ type: 'delivered', userId, devices: tokens.length, attemptsTotal });
      return { status: 'delivered', devices: tokens.length, deliveredTo, attemptsTotal };
    }
    this.observe({ type: 'failed', userId, devices: tokens.length, attemptsTotal });
    return { status: 'failed', devices: tokens.length, deliveredTo: 0, attemptsTotal };
  }

  private async deliverToDevice(
    userId: string,
    token: string,
    message: PushMessage,
  ): Promise<{ delivered: boolean; attempts: number }> {
    const hint = tokenHint(token);
    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt += 1) {
      try {
        await this.transport.send(token, message);
        return { delivered: true, attempts: attempt };
      } catch (error) {
        const failure = this.classify(error);
        if (failure.kind !== 'transient') {
          this.observe({ type: 'attempt_failed', userId, tokenHint: hint, attempt, kind: failure.kind });
          await this.removeDeadToken(userId, token, hint, failure.kind);
          return { delivered: false, attempts: attempt };
        }
        if (attempt >= this.policy.maxAttempts) {
          this.observe({ type: 'attempt_failed', userId, tokenHint: hint, attempt, kind: 'transient' });
          return { delivered: false, attempts: attempt };
        }
        // Silent retry: the user is not told about this attempt.
        const delayMs = pushRetryDelayMs(attempt, this.policy, failure.retryAfterMs, this.random);
        this.observe({ type: 'attempt_failed', userId, tokenHint: hint, attempt, kind: 'transient', delayMs });
        await this.sleep(delayMs);
      }
    }
    return { delivered: false, attempts: this.policy.maxAttempts };
  }

  private classify(error: unknown): { kind: PushFailureKind; retryAfterMs?: number } {
    if (error instanceof PushTransportError) {
      return { kind: error.kind, retryAfterMs: error.retryAfterMs };
    }
    // Anything the transport did not classify is treated as permanent, so unknown bugs are
    // not retried blindly and tokens are not deleted for them.
    return { kind: 'permanent' };
  }

  private async removeDeadToken(
    userId: string,
    token: string,
    hint: string,
    reason: PushFailureKind,
  ): Promise<void> {
    if (reason !== 'unregistered') return;
    await this.devices.removeToken(userId, token);
    this.observe({ type: 'token_removed', userId, tokenHint: hint, reason });
  }
}
