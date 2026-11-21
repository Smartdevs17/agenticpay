import { Queue, Worker } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { publish } from '../events/event-bus.js';
import {
  recordOutboxCleanup,
  recordOutboxDeadLetter,
  recordOutboxFailure,
  recordOutboxPublished,
  setOutboxQueueDepth,
} from './metrics.js';
import { getStoredEventFromOutbox } from './writer.js';
import type { OutboxEventRecord, OutboxPrismaClient, OutboxPublisherOptions } from './types.js';

const DEFAULT_OPTIONS: Required<OutboxPublisherOptions> = {
  pollIntervalMs: 100,
  batchSize: 25,
  maxAttempts: 5,
  cleanupOlderThanDays: 7,
  useBullMQ: false,
};

export class OutboxPublisher {
  private readonly options: Required<OutboxPublisherOptions>;
  private readonly db: OutboxPrismaClient;
  private interval: NodeJS.Timeout | undefined;
  private running = false;
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(options: OutboxPublisherOptions = {}, db = prisma as unknown as OutboxPrismaClient) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.db = db;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    if (this.options.useBullMQ && process.env.REDIS_URL) {
      const connection = { url: process.env.REDIS_URL };
      this.queue = new Queue('outbox-publisher', { connection });
      this.worker = new Worker('outbox-publisher', () => this.publishDueBatch(), { connection });
      this.interval = setInterval(() => {
        void this.queue?.add('publish-due-batch', {}, { removeOnComplete: true, removeOnFail: 100 });
      }, this.options.pollIntervalMs);
      return;
    }

    this.interval = setInterval(() => {
      void this.publishDueBatch();
    }, this.options.pollIntervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.interval) clearInterval(this.interval);
    await this.worker?.close();
    await this.queue?.close();
  }

  async publishDueBatch(): Promise<void> {
    const depth = await this.db.outboxEvent.count({ where: { status: 'pending' } });
    setOutboxQueueDepth(depth);

    const events = await this.db.outboxEvent.findMany({
      where: { status: 'pending', attempts: { lt: this.options.maxAttempts } },
      orderBy: { createdAt: 'asc' },
      take: this.options.batchSize,
    });

    await Promise.allSettled(events.map((event) => this.publishOne(event)));
    await this.moveExhaustedEventsToDeadLetter();
  }

  async cleanupPublishedEvents(): Promise<number> {
    const cutoff = new Date(Date.now() - this.options.cleanupOlderThanDays * 24 * 60 * 60 * 1000);
    const result = await this.db.outboxEvent.deleteMany({
      where: { status: 'published', publishedAt: { lt: cutoff } },
    });
    recordOutboxCleanup(result.count);
    return result.count;
  }

  private async publishOne(record: OutboxEventRecord): Promise<void> {
    const claimed = await this.db.outboxEvent.updateMany({
      where: { id: record.id, status: 'pending' },
      data: { status: 'publishing', attempts: { increment: 1 }, lastError: null },
    });

    if (claimed.count !== 1) return;

    const startedAt = Date.now();
    try {
      await publish(getStoredEventFromOutbox(record));
      await this.db.outboxEvent.update({
        where: { id: record.id },
        data: { status: 'published', publishedAt: new Date(), lastError: null },
      });
      recordOutboxPublished(Date.now() - startedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown outbox publish error';
      recordOutboxFailure();
      const nextAttempts = record.attempts + 1;
      const nextStatus = nextAttempts >= this.options.maxAttempts ? 'dead_letter' : 'pending';
      if (nextStatus === 'dead_letter') recordOutboxDeadLetter();
      await this.db.outboxEvent.update({
        where: { id: record.id },
        data: { status: nextStatus, lastError: message },
      });
    }
  }

  private async moveExhaustedEventsToDeadLetter(): Promise<void> {
    const result = await this.db.outboxEvent.updateMany({
      where: { status: 'pending', attempts: { gte: this.options.maxAttempts } },
      data: { status: 'dead_letter' },
    });
    for (let i = 0; i < result.count; i += 1) recordOutboxDeadLetter();
  }
}

let singleton: OutboxPublisher | undefined;

export function startOutboxPublisher(options?: OutboxPublisherOptions): OutboxPublisher {
  singleton ??= new OutboxPublisher(options);
  void singleton.start();
  return singleton;
}

export async function stopOutboxPublisher(): Promise<void> {
  await singleton?.stop();
  singleton = undefined;
}
