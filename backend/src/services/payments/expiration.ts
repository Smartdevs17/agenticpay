/**
 * Payment Request Expiration Service — Issue #460
 *
 * Responsibilities:
 *  1. Validate that a request has not expired before relaying to chain.
 *  2. BullMQ cron: sweep pending requests that are past their deadline and
 *     transition them to `expired` in the database.
 *  3. Send notifications to requester and payer on expiration.
 *  4. Provide renewal helpers (calculate new rate + create renewal).
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { Queue, Worker, type Job } from 'bullmq';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreatePaymentRequestInput {
  tenantId:        string;
  requesterId:     string;
  payerAddress?:   string;
  requesterAddress: string;
  amount:          string;          // decimal string
  currency:        string;
  network:         'stellar' | 'evm';
  tokenAddress?:   string;
  /** TTL in seconds. Defaults to 24 h. Min 60 s, Max 90 days. */
  ttlSeconds?:     number;
  memo?:           string;
  metadata?:       Record<string, unknown>;
}

export interface PaymentRequestRecord {
  id:               string;
  tenantId:         string;
  requesterId:      string;
  payerAddress:     string | null;
  requesterAddress: string;
  amount:           string;
  currency:         string;
  network:          string;
  tokenAddress:     string | null;
  status:           PaymentRequestStatus;
  expiresAt:        Date;
  expiredAt:        Date | null;
  paidAt:           Date | null;
  createdAt:        Date;
  updatedAt:        Date;
  memo:             string | null;
  metadata:         Record<string, unknown> | null;
  contractRequestId: string | null;
}

export type PaymentRequestStatus = 'pending' | 'paid' | 'expired' | 'cancelled';

export interface RenewalResult {
  newRequestId:  string;
  newAmount:     string;
  newExpiresAt:  Date;
  rateAdjusted:  boolean;
}

export interface ExpirationSweepResult {
  expiredCount: number;
  notified:     number;
  errors:       string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TTL_SECS   = 24 * 3600;        // 24 hours
const MIN_TTL_SECS       = 60;               // 1 minute
const MAX_TTL_SECS       = 90 * 24 * 3600;  // 90 days
/** Grace period added server-side to match on-chain grace period (60 s). */
const GRACE_PERIOD_MS    = 60_000;
const SWEEP_QUEUE_NAME   = 'payment-request-expiration-sweep';
const SWEEP_CRON         = '*/2 * * * *';   // every 2 minutes
const BATCH_SIZE         = 100;

// ─── Service ──────────────────────────────────────────────────────────────────

export class PaymentRequestExpirationService {
  private prisma: PrismaClient;
  private queue:  Queue | null  = null;
  private worker: Worker | null = null;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  // ─── Request lifecycle ────────────────────────────────────────────────────

  /**
   * Create a new time-bound payment request in the database.
   * Validates TTL bounds before persisting.
   */
  async createRequest(input: CreatePaymentRequestInput): Promise<PaymentRequestRecord> {
    const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECS;
    this.validateTtl(ttl);

    const expiresAt = new Date(Date.now() + ttl * 1000);

    const record = await (this.prisma as any).paymentRequest.create({
      data: {
        tenantId:         input.tenantId,
        requesterId:      input.requesterId,
        payerAddress:     input.payerAddress ?? null,
        requesterAddress: input.requesterAddress,
        amount:           input.amount,
        currency:         input.currency,
        network:          input.network,
        tokenAddress:     input.tokenAddress ?? null,
        status:           'pending' as PaymentRequestStatus,
        expiresAt,
        memo:             input.memo ?? null,
        metadata:         input.metadata ?? Prisma.JsonNull,
      },
    });

    return record as PaymentRequestRecord;
  }

  /**
   * Guard: throws if the request is expired. Called before relaying to chain.
   * Includes a backend grace period that matches the on-chain grace period.
   */
  async assertNotExpired(requestId: string): Promise<PaymentRequestRecord> {
    const req = await this.getRequest(requestId);

    if (req.status === 'expired') {
      throw new PaymentRequestExpiredError(requestId, req.expiresAt);
    }
    if (req.status === 'cancelled') {
      throw new PaymentRequestCancelledError(requestId);
    }
    if (req.status === 'paid') {
      throw new PaymentRequestAlreadyPaidError(requestId);
    }

    const deadline = new Date(req.expiresAt.getTime() + GRACE_PERIOD_MS);
    if (new Date() > deadline) {
      // Lazily expire it now.
      await this.markExpired([requestId]);
      throw new PaymentRequestExpiredError(requestId, req.expiresAt);
    }

    return req;
  }

  /** Fetch a single request, throws if not found. */
  async getRequest(requestId: string): Promise<PaymentRequestRecord> {
    const req = await (this.prisma as any).paymentRequest.findUnique({
      where: { id: requestId },
    });
    if (!req) throw new PaymentRequestNotFoundError(requestId);
    return req as PaymentRequestRecord;
  }

  /** Mark a request as paid. Called after on-chain confirmation. */
  async markPaid(requestId: string, txHash?: string): Promise<void> {
    await (this.prisma as any).paymentRequest.update({
      where: { id: requestId },
      data: {
        status:   'paid',
        paidAt:   new Date(),
        metadata: txHash ? { txHash } : undefined,
      },
    });
  }

  /** Cancel a request (requester only — auth handled in controller). */
  async cancelRequest(requestId: string): Promise<void> {
    const req = await this.getRequest(requestId);
    if (req.status !== 'pending') {
      throw new Error(`Cannot cancel request with status '${req.status}'`);
    }
    await (this.prisma as any).paymentRequest.update({
      where: { id: requestId },
      data:  { status: 'cancelled' },
    });
  }

  /**
   * Renew an expired or cancelled request.
   * Optionally applies a rate adjustment (e.g. new FX quote).
   */
  async renewRequest(params: {
    requestId: string;
    newAmount?: string;
    ttlSeconds?: number;
    rateMultiplier?: number;   // e.g. 1.02 = 2 % higher rate
  }): Promise<RenewalResult> {
    const old = await this.getRequest(params.requestId);

    if (old.status !== 'expired' && old.status !== 'cancelled') {
      throw new Error('Only expired or cancelled requests can be renewed');
    }

    const ttl = params.ttlSeconds ?? DEFAULT_TTL_SECS;
    this.validateTtl(ttl);

    let newAmount = params.newAmount ?? old.amount;
    let rateAdjusted = false;

    if (params.rateMultiplier && params.rateMultiplier !== 1) {
      const oldAmt = parseFloat(old.amount);
      newAmount    = (oldAmt * params.rateMultiplier).toFixed(8);
      rateAdjusted = true;
    }

    const newExpiresAt = new Date(Date.now() + ttl * 1000);

    const newRecord = await (this.prisma as any).paymentRequest.create({
      data: {
        tenantId:          old.tenantId,
        requesterId:       old.requesterId,
        payerAddress:      old.payerAddress,
        requesterAddress:  old.requesterAddress,
        amount:            newAmount,
        currency:          old.currency,
        network:           old.network,
        tokenAddress:      old.tokenAddress,
        status:            'pending',
        expiresAt:         newExpiresAt,
        memo:              old.memo,
        metadata:          { renewedFrom: old.id },
      },
    });

    return {
      newRequestId: newRecord.id,
      newAmount,
      newExpiresAt,
      rateAdjusted,
    };
  }

  // ─── Dashboard filtering ──────────────────────────────────────────────────

  /**
   * List requests with optional status filter.
   * Supports filtering for expired requests on the dashboard.
   */
  async listRequests(params: {
    tenantId:   string;
    status?:    PaymentRequestStatus | 'all';
    page?:      number;
    pageSize?:  number;
  }): Promise<{ data: PaymentRequestRecord[]; total: number }> {
    const page     = params.page     ?? 1;
    const pageSize = params.pageSize ?? 20;
    const skip     = (page - 1) * pageSize;

    const where: Record<string, unknown> = { tenantId: params.tenantId };
    if (params.status && params.status !== 'all') {
      where['status'] = params.status;
    }

    const [data, total] = await Promise.all([
      (this.prisma as any).paymentRequest.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      (this.prisma as any).paymentRequest.count({ where }),
    ]);

    return { data: data as PaymentRequestRecord[], total };
  }

  // ─── BullMQ sweep cron ────────────────────────────────────────────────────

  /**
   * Start the BullMQ cron worker that sweeps expired requests every 2 minutes.
   * Pass `redisUrl` or set REDIS_URL env var.
   */
  startExpirationCron(redisUrl?: string): void {
    const url = redisUrl ?? process.env['REDIS_URL'];
    if (!url) {
      console.warn('[expiration] REDIS_URL not set — expiration cron disabled');
      return;
    }

    const connection = this.parseRedisUrl(url);

    this.queue = new Queue(SWEEP_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 10 },
        removeOnFail:     { count: 50 },
      },
    });

    // Register the repeating cron.
    this.queue.add(
      'sweep',
      {},
      { repeat: { pattern: SWEEP_CRON, tz: 'UTC' }, jobId: 'expiration-sweep' },
    ).catch(console.error);

    this.worker = new Worker(
      SWEEP_QUEUE_NAME,
      async (_job: Job) => {
        const result = await this.sweepExpired();
        if (result.expiredCount > 0) {
          console.log(`[expiration] Swept ${result.expiredCount} expired requests, notified ${result.notified}`);
        }
        if (result.errors.length > 0) {
          console.error('[expiration] Sweep errors:', result.errors);
        }
      },
      { connection, concurrency: 1 },
    );

    this.worker.on('failed', (_job, err) => {
      console.error('[expiration] Sweep job failed:', err.message);
    });

    console.log('[expiration] Expiration cron started (every 2 minutes)');
  }

  async stopExpirationCron(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * Sweep all pending requests whose `expiresAt` is in the past (+ grace).
   * Updates status to `expired` and sends notifications.
   */
  async sweepExpired(): Promise<ExpirationSweepResult> {
    const cutoff = new Date(Date.now() - GRACE_PERIOD_MS);
    const errors: string[] = [];
    let expiredCount = 0;
    let notified = 0;

    // Process in batches to avoid large DB transactions.
    let cursor: string | undefined;

    for (;;) {
      const batch: PaymentRequestRecord[] = await (this.prisma as any).paymentRequest.findMany({
        where: {
          status:    'pending',
          expiresAt: { lt: cutoff },
        },
        take:    BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { createdAt: 'asc' },
      });

      if (batch.length === 0) break;

      const ids = batch.map((r) => r.id);
      try {
        await this.markExpired(ids);
        expiredCount += ids.length;
      } catch (err) {
        errors.push(`markExpired batch failed: ${(err as Error).message}`);
      }

      // Send notifications for each expired request.
      for (const req of batch) {
        try {
          await this.sendExpirationNotifications(req);
          notified++;
        } catch (err) {
          errors.push(`notify ${req.id}: ${(err as Error).message}`);
        }
      }

      cursor = batch[batch.length - 1]?.id;
      if (batch.length < BATCH_SIZE) break;
    }

    return { expiredCount, notified, errors };
  }

  // ─── Notifications ────────────────────────────────────────────────────────

  private async sendExpirationNotifications(req: PaymentRequestRecord): Promise<void> {
    // Emit to any registered notification channel.
    // In production this would call notificationService.sendNotification().
    const payload = {
      event:       'payment_request.expired',
      requestId:   req.id,
      amount:      req.amount,
      currency:    req.currency,
      expiredAt:   new Date().toISOString(),
      requesterAddress: req.requesterAddress,
      payerAddress: req.payerAddress,
    };

    // Requester notification.
    console.log(`[expiration] notify requester ${req.requesterId} — request ${req.id} expired`, payload);

    // Payer notification (if payer is known).
    if (req.payerAddress) {
      console.log(`[expiration] notify payer ${req.payerAddress} — request ${req.id} expired`, payload);
    }
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async markExpired(ids: string[]): Promise<void> {
    await (this.prisma as any).paymentRequest.updateMany({
      where: { id: { in: ids }, status: 'pending' },
      data:  { status: 'expired', expiredAt: new Date() },
    });
  }

  private validateTtl(ttl: number): void {
    if (ttl < MIN_TTL_SECS || ttl > MAX_TTL_SECS) {
      throw new Error(`TTL must be between ${MIN_TTL_SECS}s and ${MAX_TTL_SECS}s, got ${ttl}s`);
    }
  }

  private parseRedisUrl(url: string): { host: string; port: number; password?: string; tls?: object } {
    try {
      const parsed = new URL(url);
      return {
        host:     parsed.hostname || 'localhost',
        port:     parseInt(parsed.port || '6379', 10),
        password: parsed.password || undefined,
        tls:      parsed.protocol === 'rediss:' ? {} : undefined,
      };
    } catch {
      const [host, port] = url.split(':');
      return { host: host ?? 'localhost', port: parseInt(port ?? '6379', 10) };
    }
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class PaymentRequestExpiredError extends Error {
  constructor(public readonly requestId: string, public readonly expiresAt: Date) {
    super(`Payment request ${requestId} expired at ${expiresAt.toISOString()}`);
    this.name = 'PaymentRequestExpiredError';
  }
}

export class PaymentRequestNotFoundError extends Error {
  constructor(public readonly requestId: string) {
    super(`Payment request ${requestId} not found`);
    this.name = 'PaymentRequestNotFoundError';
  }
}

export class PaymentRequestAlreadyPaidError extends Error {
  constructor(public readonly requestId: string) {
    super(`Payment request ${requestId} has already been paid`);
    this.name = 'PaymentRequestAlreadyPaidError';
  }
}

export class PaymentRequestCancelledError extends Error {
  constructor(public readonly requestId: string) {
    super(`Payment request ${requestId} has been cancelled`);
    this.name = 'PaymentRequestCancelledError';
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _instance: PaymentRequestExpirationService | null = null;

export function getPaymentRequestExpirationService(prisma: PrismaClient): PaymentRequestExpirationService {
  if (!_instance) {
    _instance = new PaymentRequestExpirationService(prisma);
  }
  return _instance;
}
