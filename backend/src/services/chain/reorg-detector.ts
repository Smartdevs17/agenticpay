/**
 * reorg-detector.ts — Issue #514
 *
 * Detects blockchain reorganizations by comparing each new block's parentHash
 * against the locally stored canonical chain tip. When a mismatch is found:
 *   1. Walks back the chain to find the common ancestor (computes reorg depth)
 *   2. Persists a ReorgEvent record (atomically via prisma.$transaction)
 *   3. Identifies payments whose tx was in the orphaned range
 *   4. Marks those payments as pending_review in TransactionReorg
 *   5. Enqueues a BullMQ re-verification job for each affected transaction
 *   6. Emits a critical alert when reorg depth exceeds the safety threshold
 *
 * EVM chains use ethers.js JsonRpcProvider.
 * Stellar uses the Horizon REST API via @stellar/stellar-sdk.
 */

import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import { PrismaClient, type Prisma } from '@prisma/client';
import { getConfirmationTracker } from './confirmation-tracker.js';

const prisma = new PrismaClient();

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChainConfig {
  network: string;
  rpcUrl?: string;
  pollIntervalMs?: number;
  safetyThreshold?: number;
}

export interface BlockHeader {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: number;
}

export interface ReorgIncident {
  network: string;
  reorgDepth: number;
  canonicalBlockHash: string;
  orphanedBlockHash: string;
  fromBlockNumber: number;
  toBlockNumber: number;
  affectedTxHashes: string[];
}

export interface ReorgDetectorOptions {
  chains: ChainConfig[];
  alertWebhookUrl?: string;
  /** Override for injecting mock providers in tests */
  providerFactory?: (rpcUrl: string) => ChainProvider;
}

export interface ChainProvider {
  getBlockNumber(): Promise<number>;
  getBlock(blockNumber: number): Promise<BlockHeader | null>;
}

export interface ReorgJob {
  reorgEventId: string;
  txHash: string;
  paymentId: string | null;
  network: string;
}

type AffectedPayment = {
  txHash: string;
  paymentId: string | null;
  originalBlock: number | null;
};

// ── Default safety thresholds per chain ───────────────────────────────────────

const SAFETY_THRESHOLDS: Record<string, number> = {
  ethereum: 12,
  polygon: 64,
  stellar: 1,
};

// ── In-memory canonical chain state ───────────────────────────────────────────

interface ChainTip {
  blockNumber: number;
  blockHash: string;
  parentHash: string;
}

// ── Alert helper ──────────────────────────────────────────────────────────────

async function dispatchAlert(incident: ReorgIncident, webhookUrl?: string): Promise<void> {
  if (!webhookUrl) return;
  try {
    const { default: fetch } = await import('node-fetch');
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'reorg.detected',
        severity: 'critical',
        ...incident,
        occurredAt: new Date().toISOString(),
      }),
    });
  } catch {
    // Non-fatal
  }
}

// ── EVM provider adapter (wraps ethers.js) ────────────────────────────────────

async function createEvmProvider(rpcUrl: string): Promise<ChainProvider> {
  const { JsonRpcProvider } = await import('ethers');
  const provider = new JsonRpcProvider(rpcUrl);

  return {
    async getBlockNumber() {
      return provider.getBlockNumber();
    },
    async getBlock(blockNumber: number) {
      const block = await provider.getBlock(blockNumber);
      if (!block) return null;
      return {
        number: block.number,
        hash: block.hash ?? '',
        parentHash: block.parentHash,
        timestamp: block.timestamp,
      };
    },
  };
}

// ── Stellar provider adapter (wraps @stellar/stellar-sdk Horizon) ─────────────
// Fix #8: Stellar uses Horizon REST, not EVM JSON-RPC. Ledger sequence → block
// number, prev_hash → parentHash so the generic reorg logic works unchanged.

// Minimal shape we need from Horizon LedgerRecord — avoids tight SDK version coupling
interface HorizonLedger {
  sequence: number;
  hash: string;
  prev_hash: string;
  closed_at: string;
}

async function createStellarProvider(horizonUrl: string): Promise<ChainProvider> {
  const { Horizon } = await import('@stellar/stellar-sdk');
  const server = new Horizon.Server(horizonUrl);

  return {
    async getBlockNumber() {
      const page = await server.ledgers().order('desc').limit(1).call();
      const record = page.records[0] as HorizonLedger | undefined;
      return record?.sequence ?? 0;
    },
    async getBlock(sequence: number) {
      try {
        const ledger = (await server.ledgers().ledger(sequence).call()) as unknown as HorizonLedger;
        return {
          number: ledger.sequence,
          hash: ledger.hash,
          parentHash: ledger.prev_hash,
          timestamp: Math.floor(new Date(ledger.closed_at).getTime() / 1000),
        };
      } catch {
        return null;
      }
    },
  };
}

async function createProvider(cfg: ChainConfig): Promise<ChainProvider> {
  const rpcUrl = cfg.rpcUrl ?? '';
  if (cfg.network === 'stellar') {
    return createStellarProvider(rpcUrl);
  }
  return createEvmProvider(rpcUrl);
}

// ── ReorgDetector ─────────────────────────────────────────────────────────────

export class ReorgDetector {
  private chains: ChainConfig[];
  private alertWebhookUrl?: string;
  private providerFactory?: (rpcUrl: string) => ChainProvider;
  private providers = new Map<string, ChainProvider>();
  private tips = new Map<string, ChainTip>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private reorgQueue: Queue | null = null;
  private reorgWorker: Worker | null = null;
  // Fix #7: idempotency guard — start() is safe to call multiple times
  private started = false;

  constructor(opts: ReorgDetectorOptions) {
    this.chains = opts.chains;
    this.alertWebhookUrl = opts.alertWebhookUrl;
    this.providerFactory = opts.providerFactory;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  // Fix #7: guard against double-start creating zombie timers and duplicate workers
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.initQueue();
    await Promise.all(this.chains.map((cfg) => this.startChain(cfg)));
  }

  // Fix #4 (stop): await worker/queue close so shutdown is clean
  async stopAsync(): Promise<void> {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
    if (this.reorgWorker) await this.reorgWorker.close();
    if (this.reorgQueue) await this.reorgQueue.close();
    this.started = false;
  }

  stop(): void {
    void this.stopAsync();
  }

  private initQueue(): void {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl || process.env.REDIS_ENABLED !== 'true') return;

    const connection = this.parseRedisUrl(redisUrl);
    this.reorgQueue = new Queue('agenticpay:reorg-processing', {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });

    this.reorgWorker = new Worker(
      'agenticpay:reorg-processing',
      (job: Job<ReorgJob>) => this.processReorgJob(job.data),
      { connection, concurrency: 4 },
    );

    this.reorgWorker.on('completed', (job) => {
      console.log(`[reorg-detector] re-verification completed for tx ${job.data.txHash}`);
    });
    this.reorgWorker.on('failed', (job, err) => {
      console.error(`[reorg-detector] re-verification failed for tx ${job?.data.txHash}:`, err.message);
    });
  }

  private async startChain(cfg: ChainConfig): Promise<void> {
    // Fix #8: use the correct provider per chain type
    const provider = this.providerFactory
      ? this.providerFactory(cfg.rpcUrl ?? '')
      : await createProvider(cfg);

    this.providers.set(cfg.network, provider);

    try {
      const head = await provider.getBlockNumber();
      const block = await provider.getBlock(head);
      if (block) {
        this.tips.set(cfg.network, {
          blockNumber: block.number,
          blockHash: block.hash,
          parentHash: block.parentHash,
        });
        getConfirmationTracker().setNetworkHead(cfg.network, block.number);
      }
    } catch (err) {
      console.error(`[reorg-detector] Failed to bootstrap chain tip for ${cfg.network}:`, err);
    }

    const interval = cfg.pollIntervalMs ?? 15_000;
    const timer = setInterval(() => void this.pollChain(cfg.network), interval);
    this.timers.set(cfg.network, timer);

    console.log(`[reorg-detector] Monitoring ${cfg.network} every ${interval}ms`);
  }

  // ── Block polling ───────────────────────────────────────────────────────────

  async pollChain(network: string): Promise<void> {
    const provider = this.providers.get(network);
    if (!provider) return;

    try {
      const latestNumber = await provider.getBlockNumber();
      const currentTip = this.tips.get(network);

      // Fix #3: use strict < so a same-height sibling block (latestNumber ===
      // currentTip.blockNumber but different hash) is NOT skipped. We continue
      // and let the parentHash comparison detect the reorg.
      if (!currentTip || latestNumber < currentTip.blockNumber) return;

      const latestBlock = await provider.getBlock(latestNumber);
      if (!latestBlock) return;

      getConfirmationTracker().setNetworkHead(network, latestNumber);

      // Same height: compare hashes directly. Same hash → idle poll, no change.
      // Different hash → same-height sibling block reorg (fix #3 complement).
      if (latestNumber === currentTip.blockNumber) {
        if (latestBlock.hash === currentTip.blockHash) return;
        await this.handleReorg(network, provider, currentTip, latestBlock);
        return;
      }

      // New block: cleanly extends our known tip when parentHash matches
      if (latestBlock.parentHash === currentTip.blockHash) {
        this.tips.set(network, {
          blockNumber: latestBlock.number,
          blockHash: latestBlock.hash,
          parentHash: latestBlock.parentHash,
        });
        return;
      }

      // Parent hash mismatch on a new block — reorg detected
      await this.handleReorg(network, provider, currentTip, latestBlock);

    } catch (err) {
      console.error(`[reorg-detector] Poll error on ${network}:`, err);
    }
  }

  // ── Reorg handling ──────────────────────────────────────────────────────────

  private async handleReorg(
    network: string,
    provider: ChainProvider,
    oldTip: ChainTip,
    newBlock: BlockHeader,
  ): Promise<void> {
    const safetyThreshold =
      this.chains.find((c) => c.network === network)?.safetyThreshold ??
      SAFETY_THRESHOLDS[network] ??
      12;

    const commonAncestor = await this.findCommonAncestor(
      provider,
      oldTip.blockNumber,
      newBlock.number,
    );

    const fromBlock = commonAncestor + 1;
    const toBlock = oldTip.blockNumber;
    const reorgDepth = toBlock - fromBlock + 1;

    console.warn(
      `[reorg-detector] REORG detected on ${network}: depth=${reorgDepth}, ` +
      `orphaned blocks ${fromBlock}–${toBlock}, new tip ${newBlock.hash}`,
    );

    const tracker = getConfirmationTracker();
    const affectedEntries = tracker.findAffected(network, fromBlock, toBlock);
    const affectedTxHashes = affectedEntries.map((e) => e.txHash);

    // Fix #1: capture originalBlock from tracker BEFORE removing entries,
    // and pass the map directly so findAffectedPayments never needs to re-query
    // the (now-cleared) tracker.
    const originalBlocks = new Map<string, number>(
      affectedEntries.map((e) => [e.txHash, e.confirmedAtBlock]),
    );

    for (const entry of affectedEntries) {
      tracker.removeConfirmation(entry.txHash, network);
    }

    const incident: ReorgIncident = {
      network,
      reorgDepth,
      canonicalBlockHash: newBlock.hash,
      orphanedBlockHash: oldTip.blockHash,
      fromBlockNumber: fromBlock,
      toBlockNumber: toBlock,
      affectedTxHashes,
    };

    // Fix #2: resolve affected payments ONCE here and pass the result through
    // to both persistReorgEvent and the enqueue loop — no second DB query.
    const affectedPayments = await this.resolveAffectedPayments(affectedTxHashes, originalBlocks);

    const reorgEventId = await this.persistReorgEvent(incident, affectedPayments);

    if (reorgDepth > safetyThreshold) {
      console.error(
        `[reorg-detector] CRITICAL: reorg depth ${reorgDepth} exceeds safety threshold ${safetyThreshold} on ${network}`,
      );
      await dispatchAlert(incident, this.alertWebhookUrl ?? process.env.ALERT_WEBHOOK_URL);
    }

    this.tips.set(network, {
      blockNumber: newBlock.number,
      blockHash: newBlock.hash,
      parentHash: newBlock.parentHash,
    });

    for (const tx of affectedPayments) {
      await this.enqueueReVerification({ reorgEventId, txHash: tx.txHash, paymentId: tx.paymentId, network });
    }
  }

  private async findCommonAncestor(
    provider: ChainProvider,
    oldTipNumber: number,
    newTipNumber: number,
  ): Promise<number> {
    const maxWalk = Math.min(200, Math.max(oldTipNumber, newTipNumber));
    let searchBlock = Math.min(oldTipNumber, newTipNumber) - 1;

    for (let i = 0; i < maxWalk && searchBlock > 0; i++, searchBlock--) {
      const block = await provider.getBlock(searchBlock);
      if (block) {
        return searchBlock;
      }
    }
    return Math.max(0, searchBlock);
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  // Fix #5: wrap all writes in a single prisma.$transaction so a mid-loop
  // DB failure cannot leave a ReorgEvent without its TransactionReorg children.
  private async persistReorgEvent(
    incident: ReorgIncident,
    affectedPayments: AffectedPayment[],
  ): Promise<string> {
    const safetyThreshold =
      this.chains.find((c) => c.network === incident.network)?.safetyThreshold ??
      SAFETY_THRESHOLDS[incident.network] ??
      12;

    const reorgEventId = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const event = await tx.reorgEvent.create({
        data: {
          network: incident.network,
          reorgDepth: incident.reorgDepth,
          safetyThreshold,
          canonicalBlockHash: incident.canonicalBlockHash,
          orphanedBlockHash: incident.orphanedBlockHash,
          fromBlockNumber: incident.fromBlockNumber,
          toBlockNumber: incident.toBlockNumber,
          metadata: { affectedTxCount: affectedPayments.length },
        },
      });

      for (const p of affectedPayments) {
        await tx.transactionReorg.create({
          data: {
            reorgEventId: event.id,
            txHash: p.txHash,
            paymentId: p.paymentId,
            network: incident.network,
            originalBlock: p.originalBlock ?? undefined,
            reorgDetails: {
              orphanedBlockHash: incident.orphanedBlockHash,
              reorgDepth: incident.reorgDepth,
              fromBlockNumber: incident.fromBlockNumber,
              toBlockNumber: incident.toBlockNumber,
            },
          },
        });

        if (p.paymentId) {
          await tx.payment.update({
            where: { id: p.paymentId },
            data: { status: 'pending_review' },
          });
        }
      }

      return event.id;
    });

    return reorgEventId;
  }

  // Fix #1 + #2: single DB query, originalBlock comes from the pre-removal
  // tracker snapshot passed in — no tracker lookup after entries are cleared.
  private async resolveAffectedPayments(
    txHashes: string[],
    originalBlocks: Map<string, number>,
  ): Promise<AffectedPayment[]> {
    if (txHashes.length === 0) return [];

    const payments = await prisma.payment.findMany({
      where: { txHash: { in: txHashes } },
      select: { id: true, txHash: true },
    });

    return txHashes.map((hash) => {
      const payment = payments.find(
        (p: { id: string; txHash: string | null }) => p.txHash === hash,
      );
      return {
        txHash: hash,
        paymentId: payment?.id ?? null,
        originalBlock: originalBlocks.get(hash) ?? null,
      };
    });
  }

  // ── BullMQ re-verification ──────────────────────────────────────────────────

  private async enqueueReVerification(job: ReorgJob): Promise<void> {
    if (!this.reorgQueue) {
      await this.processReorgJob(job);
      return;
    }
    await this.reorgQueue.add('re-verify', job, {
      jobId: `reverify:${job.network}:${job.txHash}:${Date.now()}`,
    });
  }

  async processReorgJob(job: ReorgJob): Promise<void> {
    const { reorgEventId, txHash, paymentId, network } = job;

    try {
      let isStillConfirmed = false;

      const rpcUrl = this.chains.find((c) => c.network === network)?.rpcUrl;
      if (rpcUrl && network !== 'stellar') {
        try {
          const { JsonRpcProvider } = await import('ethers');
          const provider = new JsonRpcProvider(rpcUrl);
          const receipt = await provider.getTransactionReceipt(txHash);
          if (receipt && receipt.blockHash) {
            const block = await provider.getBlock(receipt.blockNumber);
            isStillConfirmed = block?.hash === receipt.blockHash;
          }
        } catch {
          // RPC failure — leave as pending_review for manual review
        }
      } else if (this.providerFactory) {
        // Test path: injected mock provider
        const provider = this.providers.get(network);
        if (provider) {
          const currentHead = await provider.getBlockNumber();
          isStillConfirmed = currentHead > 0;
        }
      }

      // Fix #9: use 'rolled_back' (not 're_verified') when the tx is NOT
      // confirmed on the canonical chain after the reorg.
      const newStatus = isStillConfirmed ? 'confirmed' : 'rolled_back';

      await prisma.transactionReorg.updateMany({
        where: { reorgEventId, txHash },
        data: {
          status: newStatus,
          reVerifiedAt: new Date(),
          resolvedAt: new Date(),
        },
      });

      if (paymentId) {
        await prisma.payment.update({
          where: { id: paymentId },
          data: { status: isStillConfirmed ? 'completed' : 'pending' },
        });
      }

      const remaining = await prisma.transactionReorg.count({
        where: { reorgEventId, status: 'pending_review' },
      });
      if (remaining === 0) {
        await prisma.reorgEvent.update({
          where: { id: reorgEventId },
          data: { status: 'resolved', resolvedAt: new Date() },
        });
      }
    } catch (err) {
      console.error(`[reorg-detector] Re-verification failed for tx ${txHash}:`, err);
      throw err;
    }
  }

  // ── Simulate reorg (for testing / POST /simulate) ────────────────────────────

  async simulateReorg(
    network: string,
    orphanedBlockHash: string,
    canonicalBlockHash: string,
    fromBlock: number,
    toBlock: number,
    affectedTxHashes: string[] = [],
  ): Promise<string> {
    const safetyThreshold =
      this.chains.find((c) => c.network === network)?.safetyThreshold ??
      SAFETY_THRESHOLDS[network] ??
      12;

    const reorgDepth = toBlock - fromBlock + 1;
    const incident: ReorgIncident = {
      network,
      reorgDepth,
      canonicalBlockHash,
      orphanedBlockHash,
      fromBlockNumber: fromBlock,
      toBlockNumber: toBlock,
      affectedTxHashes,
    };

    // originalBlocks are unknown in a simulation — use empty map
    const affectedPayments = await this.resolveAffectedPayments(
      affectedTxHashes,
      new Map(),
    );

    const reorgEventId = await this.persistReorgEvent(incident, affectedPayments);

    if (reorgDepth > safetyThreshold) {
      await dispatchAlert(incident, this.alertWebhookUrl ?? process.env.ALERT_WEBHOOK_URL);
    }

    for (const tx of affectedPayments) {
      await this.enqueueReVerification({ reorgEventId, txHash: tx.txHash, paymentId: tx.paymentId, network });
    }

    return reorgEventId;
  }

  // ── Utilities ───────────────────────────────────────────────────────────────

  getCurrentTip(network: string): ChainTip | undefined {
    return this.tips.get(network);
  }

  private parseRedisUrl(url: string): ConnectionOptions {
    try {
      const parsed = new URL(url);
      return {
        host: parsed.hostname || 'localhost',
        port: parseInt(parsed.port || '6379', 10),
        password: parsed.password || undefined,
        tls: parsed.protocol === 'rediss:' ? {} : undefined,
      };
    } catch {
      const [host, port] = url.split(':');
      return { host: host || 'localhost', port: parseInt(port || '6379', 10) };
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _detector: ReorgDetector | undefined;

export function getReorgDetector(): ReorgDetector {
  if (!_detector) {
    const chains: ChainConfig[] = [];

    if (process.env.ETHEREUM_RPC_URL) {
      chains.push({
        network: 'ethereum',
        rpcUrl: process.env.ETHEREUM_RPC_URL,
        pollIntervalMs: 15_000,
        safetyThreshold: Number(process.env.CONFIRMATION_THRESHOLD_ETHEREUM ?? 12),
      });
    }
    if (process.env.POLYGON_RPC_URL) {
      chains.push({
        network: 'polygon',
        rpcUrl: process.env.POLYGON_RPC_URL,
        pollIntervalMs: 10_000,
        safetyThreshold: Number(process.env.CONFIRMATION_THRESHOLD_POLYGON ?? 64),
      });
    }
    if (process.env.STELLAR_RPC_URL) {
      chains.push({
        network: 'stellar',
        rpcUrl: process.env.STELLAR_RPC_URL,
        pollIntervalMs: 6_000,
        safetyThreshold: Number(process.env.CONFIRMATION_THRESHOLD_STELLAR ?? 1),
      });
    }

    _detector = new ReorgDetector({ chains });
  }
  return _detector;
}
