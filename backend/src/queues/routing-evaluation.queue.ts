/**
 * Routing evaluation queue (#446)
 *
 * Periodically samples chain performance (gas prices, latency, success rate)
 * and writes them to:
 *  1. Redis sorted sets – for sub-millisecond read by the AI router
 *  2. ChainPerformanceMetric Prisma model – for historical analysis
 */
import { Queue, Worker, type Job } from 'bullmq';
import { prisma } from '../../lib/prisma.js';
import type { ChainFeatures } from '../routing/ai-router.js';

const QUEUE_NAME = 'routing-evaluation';
const REDIS_KEY_PREFIX = 'chain:perf:';

// ─── Mock collectors – replace with real RPC/API calls in production ──────────

async function collectStellarMetrics(): Promise<ChainFeatures> {
  // TODO: query Stellar Horizon / Soroban RPC for real fee stats
  return {
    chain: 'stellar',
    avgGasPrice: 0.00001,
    avgConfirmTimeMs: 5_000,
    successRate: 0.98,
    p99LatencyMs: 6_000,
  };
}

async function collectEvmMetrics(): Promise<ChainFeatures> {
  // TODO: query EVM node eth_gasPrice + filter recent txs for success rate
  return {
    chain: 'evm',
    avgGasPrice: 30,
    avgConfirmTimeMs: 15_000,
    successRate: 0.94,
    p99LatencyMs: 20_000,
  };
}

// ─── Queue & Worker ───────────────────────────────────────────────────────────

export interface RoutingEvalJobData {
  sampleId: string;
}

let _queue: Queue<RoutingEvalJobData> | null = null;
let _worker: Worker<RoutingEvalJobData> | null = null;

type RedisClient = {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown>;
};

export function startRoutingEvalQueue(
  connection: { host: string; port: number },
  redisClient?: RedisClient,
): void {
  _queue = new Queue<RoutingEvalJobData>(QUEUE_NAME, { connection });

  _worker = new Worker<RoutingEvalJobData>(
    QUEUE_NAME,
    async (_job: Job<RoutingEvalJobData>) => {
      const collectors = [collectStellarMetrics, collectEvmMetrics];
      const results = await Promise.allSettled(collectors.map((fn) => fn()));

      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const metrics = result.value;
        const now = new Date();

        // Persist to DB
        await prisma.chainPerformanceMetric.create({
          data: {
            chain: metrics.chain,
            sampleAt: now,
            avgGasPrice: metrics.avgGasPrice,
            avgConfirmTimeMs: metrics.avgConfirmTimeMs,
            successRate: metrics.successRate,
            p99LatencyMs: metrics.p99LatencyMs,
            sampleSize: 1,
          },
        }).catch(() => { /* non-fatal */ });

        // Write to Redis sorted set (score = timestamp for TTL pruning)
        if (redisClient) {
          const key = `${REDIS_KEY_PREFIX}${metrics.chain}`;
          const member = JSON.stringify(metrics);
          const nowMs = now.getTime();
          await redisClient.zadd(key, nowMs, member).catch(() => {});
          // Prune samples older than 1 hour
          await redisClient.zremrangebyscore(key, '-inf', nowMs - 3_600_000).catch(() => {});
        }
      }
    },
    { connection, concurrency: 1 },
  );

  _worker.on('failed', (job, err) => {
    console.error(`[routing-eval] job ${job?.id} failed:`, err);
  });
}

/** Schedule recurring eval jobs (call once on server startup) */
export async function scheduleRoutingEvalJobs(intervalMs = 60_000): Promise<void> {
  if (!_queue) throw new Error('startRoutingEvalQueue must be called first');
  await _queue.upsertJobScheduler(
    'routing-eval-periodic',
    { every: intervalMs },
    { name: 'routing-eval', data: { sampleId: 'periodic' } },
  );
}

export function stopRoutingEvalQueue(): Promise<void> {
  return Promise.all([
    _worker?.close(),
    _queue?.close(),
  ]).then(() => {
    _queue = null;
    _worker = null;
  });
}
