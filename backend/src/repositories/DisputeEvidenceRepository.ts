/**
 * backend/src/repositories/DisputeEvidenceRepository.ts
 *
 * Repository encapsulation for DisputeEvidence queries with optimized batching
 * to eliminate N+1 query fanout (Issue #1460).
 *
 * Replaces per-row reads (uploader to-one, attachments to-many, comments to-many)
 * with a bounded query design:
 * 1. Single query for evidence items with to-one uploader projection (select only needed fields).
 * 2. Batched query with `in` for attachments scoped to the same tenant and dispute.
 * 3. Batched query with `in` for comments scoped to the same tenant and dispute.
 * Followed by in-memory grouping, keeping total database queries constant at <= 3.
 */

import { prisma, PrismaClient } from '../lib/prisma.js';

type DbClient = PrismaClient | any;

export interface EvidenceUploaderProjection {
  id: string;
  name: string;
  email: string;
}

export interface EvidenceAttachmentItem {
  id: string;
  evidenceId: string;
  tenantId: string;
  url: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  createdAt: Date | string;
  deletedAt?: Date | string | null;
}

export interface EvidenceCommentItem {
  id: string;
  evidenceId: string;
  tenantId: string;
  authorId: string;
  content: string;
  createdAt: Date | string;
  deletedAt?: Date | string | null;
}

export interface DisputeEvidenceRecord {
  id: string;
  disputeId: string;
  tenantId: string;
  uploaderId: string;
  title: string;
  description?: string | null;
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  hash: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt?: Date | string | null;
  uploader?: EvidenceUploaderProjection | null;
  attachments?: EvidenceAttachmentItem[];
  comments?: EvidenceCommentItem[];
}

export interface ListDisputeEvidenceOptions {
  disputeId: string;
  tenantId: string;
  limit?: number;
  cursor?: string;
}

export interface DisputeEvidenceResultItem {
  id: string;
  disputeId: string;
  tenantId: string;
  title: string;
  description: string | null;
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  hash: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  uploader: EvidenceUploaderProjection | null;
  attachments: EvidenceAttachmentItem[];
  comments: EvidenceCommentItem[];
}

export class DisputeEvidenceRepository {
  constructor(private readonly db: DbClient = prisma) {}

  /** Create a scoped repository instance bound to an active transaction */
  withTransaction(tx: DbClient): DisputeEvidenceRepository {
    return new DisputeEvidenceRepository(tx);
  }

  /**
   * List dispute evidence items with bounded queries (O(1) queries instead of O(N)).
   *
   * Query 1: Fetch evidence rows with to-one uploader inclusion (scoped by disputeId, tenantId, soft-deleted=null).
   * Query 2: If rows > 0, batch fetch attachments where evidenceId IN (ids) with tenantId & deletedAt scoping.
   * Query 3: If rows > 0, batch fetch comments where evidenceId IN (ids) with tenantId & deletedAt scoping.
   */
  async listEvidence(options: ListDisputeEvidenceOptions): Promise<DisputeEvidenceResultItem[]> {
    const { disputeId, tenantId, limit = 50, cursor } = options;

    const findManyArgs: any = {
      where: {
        disputeId,
        tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        disputeId: true,
        tenantId: true,
        title: true,
        description: true,
        fileUrl: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        hash: true,
        createdAt: true,
        updatedAt: true,
        uploader: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      take: limit,
    };

    if (cursor) {
      findManyArgs.cursor = { id: cursor };
      findManyArgs.skip = 1;
    }

    // Query 1: fetch evidence rows and to-one uploader
    const evidenceRows = await this.db.disputeEvidence.findMany(findManyArgs);

    if (!evidenceRows || evidenceRows.length === 0) {
      return [];
    }

    const evidenceIds = evidenceRows.map((r: any) => r.id);

    // Queries 2 & 3: separate batched queries with IN to prevent cartesian row blowup
    const [attachments, comments] = await Promise.all([
      this.db.evidenceAttachment.findMany({
        where: {
          evidenceId: { in: evidenceIds },
          tenantId,
          deletedAt: null,
        },
        select: {
          id: true,
          evidenceId: true,
          tenantId: true,
          url: true,
          fileName: true,
          fileSize: true,
          fileType: true,
          createdAt: true,
        },
        orderBy: [
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
      }),
      this.db.evidenceComment.findMany({
        where: {
          evidenceId: { in: evidenceIds },
          tenantId,
          deletedAt: null,
        },
        select: {
          id: true,
          evidenceId: true,
          tenantId: true,
          authorId: true,
          content: true,
          createdAt: true,
        },
        orderBy: [
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
      }),
    ]);

    // In-memory grouping
    const attachmentsByEvidenceId = new Map<string, EvidenceAttachmentItem[]>();
    for (const att of attachments) {
      const existing = attachmentsByEvidenceId.get(att.evidenceId);
      if (existing) {
        existing.push(att);
      } else {
        attachmentsByEvidenceId.set(att.evidenceId, [att]);
      }
    }

    const commentsByEvidenceId = new Map<string, EvidenceCommentItem[]>();
    for (const comment of comments) {
      const existing = commentsByEvidenceId.get(comment.evidenceId);
      if (existing) {
        existing.push(comment);
      } else {
        commentsByEvidenceId.set(comment.evidenceId, [comment]);
      }
    }

    return evidenceRows.map((row: any) => ({
      id: row.id,
      disputeId: row.disputeId,
      tenantId: row.tenantId,
      title: row.title,
      description: row.description ?? null,
      fileUrl: row.fileUrl,
      fileName: row.fileName,
      fileType: row.fileType,
      fileSize: row.fileSize,
      hash: row.hash,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      uploader: row.uploader ?? null,
      attachments: attachmentsByEvidenceId.get(row.id) ?? [],
      comments: commentsByEvidenceId.get(row.id) ?? [],
    }));
  }

  async findById(id: string, tenantId: string): Promise<DisputeEvidenceResultItem | null> {
    const row = await this.db.disputeEvidence.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        disputeId: true,
        tenantId: true,
        title: true,
        description: true,
        fileUrl: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        hash: true,
        createdAt: true,
        updatedAt: true,
        uploader: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!row) return null;

    const [attachments, comments] = await Promise.all([
      this.db.evidenceAttachment.findMany({
        where: { evidenceId: row.id, tenantId, deletedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.db.evidenceComment.findMany({
        where: { evidenceId: row.id, tenantId, deletedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    return {
      id: row.id,
      disputeId: row.disputeId,
      tenantId: row.tenantId,
      title: row.title,
      description: row.description ?? null,
      fileUrl: row.fileUrl,
      fileName: row.fileName,
      fileType: row.fileType,
      fileSize: row.fileSize,
      hash: row.hash,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      uploader: row.uploader ?? null,
      attachments: attachments ?? [],
      comments: comments ?? [],
    };
  }
}

export const disputeEvidenceRepository = new DisputeEvidenceRepository();
