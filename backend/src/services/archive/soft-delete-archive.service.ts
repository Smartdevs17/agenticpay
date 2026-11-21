/**
 * Soft delete with archive strategy — Issue #884
 *
 * Most models already carry a `deletedAt` column that is set instead of
 * hard-deleting a row. This service adds the missing second half of that
 * strategy: sweeping rows that have been soft-deleted past a retention
 * window into a generic `archived_records` cold-storage table, purging
 * them from the primary table, and allowing a specific record to be
 * restored from the archive if needed.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { withTransactionRetry } from '../../db/transaction-retry.js';

/** Models that support soft delete + archival, and how to reach them. */
export const ARCHIVABLE_MODELS = ['Payment', 'Project', 'Milestone', 'Invoice', 'User'] as const;
export type ArchivableModel = (typeof ARCHIVABLE_MODELS)[number];

const DELEGATE_BY_MODEL: Record<ArchivableModel, keyof PrismaClient> = {
  Payment: 'payment',
  Project: 'project',
  Milestone: 'milestone',
  Invoice: 'invoice',
  User: 'user',
};

/** Default retention window before a soft-deleted row is archived. */
export const DEFAULT_RETENTION_DAYS = 30;

export interface ArchiveSweepOptions {
  /** Days since deletedAt after which a row is eligible for archival. */
  retentionDays?: number;
  /** Max rows to archive per model in a single sweep call. */
  batchSize?: number;
  reason?: string;
}

export interface ArchiveSweepResult {
  model: ArchivableModel;
  archivedCount: number;
}

function getDelegate(client: PrismaClient, model: ArchivableModel) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any)[DELEGATE_BY_MODEL[model]];
}

/**
 * Soft-deletes a record by setting `deletedAt` rather than removing the
 * row. No-op (idempotent) if the record is already soft-deleted.
 */
export async function softDelete(model: ArchivableModel, id: string): Promise<void> {
  const delegate = getDelegate(prisma, model);
  await delegate.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

/**
 * Reverses a soft delete performed within the retention window (before
 * the row was swept into the archive table).
 */
export async function restoreSoftDeleted(model: ArchivableModel, id: string): Promise<void> {
  const delegate = getDelegate(prisma, model);
  await delegate.updateMany({
    where: { id, NOT: { deletedAt: null } },
    data: { deletedAt: null },
  });
}

/**
 * Archives soft-deleted rows for a single model that are past the
 * retention window: copies each row to `archived_records` and hard-deletes
 * it from the source table, inside a retried transaction so a deadlock
 * with a concurrent writer doesn't drop the sweep.
 */
export async function archiveExpiredSoftDeletes(
  model: ArchivableModel,
  options: ArchiveSweepOptions = {},
): Promise<ArchiveSweepResult> {
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const batchSize = options.batchSize ?? 500;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const delegate = getDelegate(prisma, model);
  const candidates: Array<{ id: string; tenantId?: string; deletedAt: Date | null } & Record<string, unknown>> =
    await delegate.findMany({
      where: { deletedAt: { not: null, lte: cutoff } },
      take: batchSize,
    });

  if (candidates.length === 0) {
    return { model, archivedCount: 0 };
  }

  await withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      await tx.archivedRecord.createMany({
        data: candidates.map((row) => ({
          modelName: model,
          recordId: String(row.id),
          tenantId: typeof row['tenantId'] === 'string' ? (row['tenantId'] as string) : null,
          payload: row as unknown as Prisma.InputJsonValue,
          deletedAt: row.deletedAt as Date,
          archivedReason: options.reason ?? 'retention_policy',
        })),
        skipDuplicates: true,
      });

      const txDelegate = getDelegate(tx as unknown as PrismaClient, model);
      await txDelegate.deleteMany({
        where: { id: { in: candidates.map((row) => String(row.id)) } },
      });
    }),
  );

  return { model, archivedCount: candidates.length };
}

/** Runs an archive sweep across every archivable model. */
export async function archiveExpiredSoftDeletesForAllModels(
  options: ArchiveSweepOptions = {},
): Promise<ArchiveSweepResult[]> {
  const results: ArchiveSweepResult[] = [];
  for (const model of ARCHIVABLE_MODELS) {
    results.push(await archiveExpiredSoftDeletes(model, options));
  }
  return results;
}

export interface ArchivedRecordSummary {
  id: string;
  modelName: string;
  recordId: string;
  tenantId: string | null;
  deletedAt: Date;
  archivedAt: Date;
  archivedReason: string;
}

export async function listArchivedRecords(params: {
  model?: ArchivableModel;
  tenantId?: string;
  limit?: number;
  cursor?: string;
}): Promise<ArchivedRecordSummary[]> {
  const limit = Math.min(params.limit ?? 50, 200);
  return prisma.archivedRecord.findMany({
    where: {
      modelName: params.model,
      tenantId: params.tenantId,
    },
    select: {
      id: true,
      modelName: true,
      recordId: true,
      tenantId: true,
      deletedAt: true,
      archivedAt: true,
      archivedReason: true,
    },
    orderBy: { archivedAt: 'desc' },
    take: limit,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
}

/**
 * Restores an archived row back into its source table (re-inserted with
 * `deletedAt` cleared) and removes it from the archive.
 */
export async function restoreFromArchive(model: ArchivableModel, recordId: string): Promise<void> {
  const archived = await prisma.archivedRecord.findUnique({
    where: { modelName_recordId: { modelName: model, recordId } },
  });

  if (!archived) {
    throw new Error(`No archived record found for ${model}:${recordId}`);
  }

  const payload = { ...(archived.payload as Record<string, unknown>), deletedAt: null };

  await withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      const txDelegate = getDelegate(tx as unknown as PrismaClient, model);
      await txDelegate.upsert({
        where: { id: recordId },
        create: payload,
        update: payload,
      });
      await tx.archivedRecord.delete({ where: { id: archived.id } });
    }),
  );
}
