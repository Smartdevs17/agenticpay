/**
 * archival-service.ts — Issue #473
 *
 * Orchestrates daily on-chain data archival to IPFS with integrity
 * verification and restore capability.
 */

import { randomUUID } from 'node:crypto';
import type { ArchivalBatchStatus, ArchivalChain } from '@prisma/client';
import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { prisma } from '../../lib/prisma.js';
import { collectChainData, SUPPORTED_CHAINS } from './data-collector.js';
import { uploadToIpfs, verifyIntegrity, downloadFromIpfs } from './ipfs-uploader.js';

const RETENTION_YEARS = 7;

export interface ArchivalDashboard {
  lastArchiveAt: string | null;
  lastCid: string | null;
  lastSizeBytes: number;
  totalBatches: number;
  completedBatches: number;
  failedBatches: number;
  chains: Array<{
    chain: ArchivalChain;
    lastBatchDate: string | null;
    lastCid: string | null;
    recordCount: number;
    status: ArchivalBatchStatus;
  }>;
}

export interface RestoreResult {
  batchId: string;
  recordsRestored: number;
  recordsIndexed: number;
  verified: boolean;
}

class ArchivalService extends BaseService {
  private usePrisma(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  async runDailyArchival(batchDate = new Date()): Promise<Result<{ batchesProcessed: number }>> {
    const dateOnly = new Date(batchDate.toISOString().slice(0, 10));
    const retentionUntil = new Date(dateOnly);
    retentionUntil.setFullYear(retentionUntil.getFullYear() + RETENTION_YEARS);

    let batchesProcessed = 0;

    for (const chain of SUPPORTED_CHAINS) {
      try {
        await this.archiveChain(chain, dateOnly, retentionUntil);
        batchesProcessed++;
      } catch (err) {
        console.error(`[archival] Daily batch failed for ${chain}:`, err);
      }
    }

    return this.ok({ batchesProcessed });
  }

  private async archiveChain(
    chain: ArchivalChain,
    batchDate: Date,
    retentionUntil: Date,
  ): Promise<void> {
    const batchId = randomUUID();

    if (this.usePrisma()) {
      const existing = await prisma.archivalBatch.findUnique({
        where: { batchDate_chain: { batchDate, chain } },
      });
      if (existing?.status === 'completed') {
        console.log(`[archival] Batch already completed for ${chain} on ${batchDate.toISOString()}`);
        return;
      }
    }

    const batch = this.usePrisma()
      ? await prisma.archivalBatch.upsert({
          where: { batchDate_chain: { batchDate, chain } },
          create: {
            id: batchId,
            batchDate,
            chain,
            status: 'collecting',
            retentionUntil,
            startedAt: new Date(),
          },
          update: { status: 'collecting', startedAt: new Date(), errorMessage: null },
        })
      : { id: batchId, chain, batchDate };

    try {
      const collection = await collectChainData(chain);
      const archivePayload = {
        version: 1,
        chain,
        batchDate: batchDate.toISOString(),
        recordCount: collection.records.length,
        fromBlock: collection.fromBlock.toString(),
        toBlock: collection.toBlock.toString(),
        collectedAt: collection.collectedAt,
        records: collection.records,
      };

      if (this.usePrisma()) {
        await prisma.archivalBatch.update({
          where: { id: batch.id },
          data: { status: 'compressing', recordCount: collection.records.length },
        });
      }

      const upload = await uploadToIpfs(archivePayload, `${chain}-${batchDate.toISOString().slice(0, 10)}.json.gz`);

      if (this.usePrisma()) {
        await prisma.archivalBatch.update({
          where: { id: batch.id },
          data: {
            status: 'uploading',
            contentHash: upload.contentHash,
            compressedBytes: BigInt(upload.compressedBytes),
            uncompressedBytes: BigInt(upload.uncompressedBytes),
          },
        });

        const verified = await verifyIntegrity(upload.contentHash, upload.cid);

        await prisma.dataArchive.createMany({
          data: collection.records.map((r) => ({
            batchId: batch.id,
            chain: r.chain,
            txHash: r.txHash,
            blockNumber: r.blockNumber,
            blockHash: r.blockHash,
            payload: r.payload,
            payloadHash: r.payloadHash,
            proofOfInclusion: r.proofOfInclusion,
          })),
        });

        await prisma.archivalBatch.update({
          where: { id: batch.id },
          data: {
            status: verified ? 'completed' : 'failed',
            ipfsCid: upload.cid,
            ipfsUrl: upload.url,
            verifiedHash: verified ? upload.contentHash : null,
            completedAt: new Date(),
            errorMessage: verified ? null : 'Post-upload integrity verification failed',
          },
        });

        if (verified) {
          await prisma.auditAnchor.create({
            data: {
              latestHash: upload.cid,
              chain: `ipfs:${chain}`,
              status: 'confirmed',
            },
          });
        }
      }

      console.log(
        `[archival] ✔ ${chain} batch archived: CID=${upload.cid}, records=${collection.records.length}, ` +
          `compressed=${upload.compressedBytes}B`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.usePrisma()) {
        await prisma.archivalBatch.update({
          where: { id: batch.id },
          data: { status: 'failed', errorMessage: message, completedAt: new Date() },
        });
      }
      throw err;
    }
  }

  async getDashboard(): Promise<Result<ArchivalDashboard>> {
    if (!this.usePrisma()) {
      return this.ok({
        lastArchiveAt: null,
        lastCid: null,
        lastSizeBytes: 0,
        totalBatches: 0,
        completedBatches: 0,
        failedBatches: 0,
        chains: SUPPORTED_CHAINS.map((chain) => ({
          chain,
          lastBatchDate: null,
          lastCid: null,
          recordCount: 0,
          status: 'pending' as ArchivalBatchStatus,
        })),
      });
    }

    const [latest, total, completed, failed, perChain] = await Promise.all([
      prisma.archivalBatch.findFirst({
        where: { status: 'completed' },
        orderBy: { completedAt: 'desc' },
      }),
      prisma.archivalBatch.count(),
      prisma.archivalBatch.count({ where: { status: 'completed' } }),
      prisma.archivalBatch.count({ where: { status: 'failed' } }),
      Promise.all(
        SUPPORTED_CHAINS.map(async (chain) => {
          const batch = await prisma.archivalBatch.findFirst({
            where: { chain },
            orderBy: { batchDate: 'desc' },
          });
          return {
            chain,
            lastBatchDate: batch?.batchDate.toISOString() ?? null,
            lastCid: batch?.ipfsCid ?? null,
            recordCount: batch?.recordCount ?? 0,
            status: batch?.status ?? ('pending' as ArchivalBatchStatus),
          };
        }),
      ),
    ]);

    return this.ok({
      lastArchiveAt: latest?.completedAt?.toISOString() ?? null,
      lastCid: latest?.ipfsCid ?? null,
      lastSizeBytes: latest ? Number(latest.compressedBytes) : 0,
      totalBatches: total,
      completedBatches: completed,
      failedBatches: failed,
      chains: perChain,
    });
  }

  async restoreBatch(batchId: string): Promise<Result<RestoreResult>> {
    if (!this.usePrisma()) {
      return this.fail('Database required for restore workflow', 503, 'DB_UNAVAILABLE');
    }

    const batch = await prisma.archivalBatch.findUnique({ where: { id: batchId } });
    if (!batch) return this.notFoundFailure('ArchivalBatch', batchId);
    if (!batch.ipfsCid) return this.validationFailure('Batch has no IPFS CID');

    await prisma.archivalBatch.update({
      where: { id: batchId },
      data: { status: 'restoring' },
    });

    try {
      const { data } = await downloadFromIpfs(batch.ipfsCid, batch.contentHash ?? undefined);
      const { createGunzip } = await import('node:zlib');
      const { promisify } = await import('node:util');
      const gunzip = promisify(createGunzip);
      const decompressed = await gunzip(data);
      const payload = JSON.parse(decompressed.toString('utf-8')) as {
        records?: Array<{
          chain: ArchivalChain;
          txHash: string;
          blockNumber: bigint | string;
          blockHash?: string;
          payload: Record<string, unknown>;
          payloadHash: string;
          proofOfInclusion: Record<string, unknown>;
        }>;
      };

      let recordsIndexed = 0;
      const records = payload.records ?? [];

      for (const record of records) {
        const existing = await prisma.dataArchive.findFirst({
          where: { chain: record.chain, txHash: record.txHash },
        });
        if (!existing) {
          await prisma.dataArchive.create({
            data: {
              batchId,
              chain: record.chain,
              txHash: record.txHash,
              blockNumber: BigInt(record.blockNumber),
              blockHash: record.blockHash,
              payload: record.payload,
              payloadHash: record.payloadHash,
              proofOfInclusion: record.proofOfInclusion,
              indexedAt: new Date(),
            },
          });
          recordsIndexed++;
        } else {
          await prisma.dataArchive.update({
            where: { id: existing.id },
            data: { indexedAt: new Date() },
          });
        }
      }

      const verified = batch.contentHash
        ? await verifyIntegrity(batch.contentHash, batch.ipfsCid)
        : true;

      await prisma.archivalBatch.update({
        where: { id: batchId },
        data: { status: 'completed' },
      });

      return this.ok({
        batchId,
        recordsRestored: records.length,
        recordsIndexed,
        verified,
      });
    } catch (err) {
      await prisma.archivalBatch.update({
        where: { id: batchId },
        data: {
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
      return this.unexpectedFailure(err);
    }
  }

  async listBatches(limit = 20) {
    if (!this.usePrisma()) return this.ok({ batches: [] });

    const batches = await prisma.archivalBatch.findMany({
      orderBy: { batchDate: 'desc' },
      take: limit,
      select: {
        id: true,
        batchDate: true,
        chain: true,
        status: true,
        recordCount: true,
        ipfsCid: true,
        compressedBytes: true,
        completedAt: true,
        retentionUntil: true,
      },
    });

    return this.ok({
      batches: batches.map((b) => ({
        ...b,
        batchDate: b.batchDate.toISOString(),
        compressedBytes: Number(b.compressedBytes),
        completedAt: b.completedAt?.toISOString() ?? null,
        retentionUntil: b.retentionUntil.toISOString(),
      })),
    });
  }
}

let instance: ArchivalService | null = null;

export function getArchivalService(): ArchivalService {
  if (!instance) instance = new ArchivalService();
  return instance;
}
