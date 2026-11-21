/**
 * backend/src/repositories/__tests__/DisputeEvidenceRepository.test.ts
 *
 * Verifies Issue #1460: Drop N+1 reads in dispute evidence list with include & batched fanout.
 *
 * Proves:
 * 1. Constant query count (<= 3 queries) across N = 0, 1, 5, 50 evidence items.
 * 2. Exact equivalence with the naive N+1 test oracle.
 * 3. Exact preservation of ordering (createdAt asc, id asc tiebreaker).
 * 4. Preservation of cursor pagination semantics.
 * 5. Strict tenant isolation & dispute scoping across evidence and batch-loaded relations.
 * 6. Soft-delete filtering (deletedAt: null).
 * 7. Graceful handling of missing related records (e.g. uploader null).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DisputeEvidenceRepository,
  type ListDisputeEvidenceOptions,
  type DisputeEvidenceResultItem,
} from '../DisputeEvidenceRepository.js';

interface RawEvidence {
  id: string;
  disputeId: string;
  tenantId: string;
  uploaderId: string;
  title: string;
  description: string | null;
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  hash: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface RawUser {
  id: string;
  name: string;
  email: string;
}

interface RawAttachment {
  id: string;
  evidenceId: string;
  tenantId: string;
  url: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  createdAt: string;
  deletedAt: string | null;
}

interface RawComment {
  id: string;
  evidenceId: string;
  tenantId: string;
  authorId: string;
  content: string;
  createdAt: string;
  deletedAt: string | null;
}

class CountingFakePrismaClient {
  public queries: Array<{ model: string; action: string; args: any }> = [];

  constructor(
    public evidenceData: RawEvidence[] = [],
    public userData: RawUser[] = [],
    public attachmentData: RawAttachment[] = [],
    public commentData: RawComment[] = [],
  ) {}

  resetQueryCount() {
    this.queries = [];
  }

  get queryCount() {
    return this.queries.length;
  }

  get disputeEvidence() {
    return {
      findMany: async (args: any) => {
        this.queries.push({ model: 'disputeEvidence', action: 'findMany', args });
        let rows = [...this.evidenceData];

        if (args?.where) {
          if (args.where.disputeId !== undefined) {
            rows = rows.filter((r) => r.disputeId === args.where.disputeId);
          }
          if (args.where.tenantId !== undefined) {
            rows = rows.filter((r) => r.tenantId === args.where.tenantId);
          }
          if (args.where.deletedAt === null) {
            rows = rows.filter((r) => r.deletedAt === null);
          }
        }

        // Sorting: [{ createdAt: 'asc' }, { id: 'asc' }]
        rows.sort((a, b) => {
          const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          if (timeDiff !== 0) return timeDiff;
          return a.id.localeCompare(b.id);
        });

        // Cursor pagination
        if (args?.cursor?.id) {
          const idx = rows.findIndex((r) => r.id === args.cursor.id);
          if (idx !== -1 && args?.skip) {
            rows = rows.slice(idx + args.skip);
          }
        }

        if (args?.take) {
          rows = rows.slice(0, args.take);
        }

        // Handle uploader inclusion/selection
        return rows.map((r) => {
          const uploader = this.userData.find((u) => u.id === r.uploaderId);
          const mapped: any = {
            id: r.id,
            disputeId: r.disputeId,
            tenantId: r.tenantId,
            title: r.title,
            description: r.description,
            fileUrl: r.fileUrl,
            fileName: r.fileName,
            fileType: r.fileType,
            fileSize: r.fileSize,
            hash: r.hash,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            uploader: uploader
              ? { id: uploader.id, name: uploader.name, email: uploader.email }
              : null,
          };
          return mapped;
        });
      },

      findFirst: async (args: any) => {
        this.queries.push({ model: 'disputeEvidence', action: 'findFirst', args });
        const rows = await this.disputeEvidence.findMany({ ...args, take: 1 });
        return rows[0] || null;
      },
    };
  }

  get user() {
    return {
      findUnique: async (args: any) => {
        this.queries.push({ model: 'user', action: 'findUnique', args });
        const user = this.userData.find((u) => u.id === args.where.id);
        if (!user) return null;
        return { id: user.id, name: user.name, email: user.email };
      },
    };
  }

  get evidenceAttachment() {
    return {
      findMany: async (args: any) => {
        this.queries.push({ model: 'evidenceAttachment', action: 'findMany', args });
        let rows = [...this.attachmentData];

        if (args?.where) {
          if (args.where.evidenceId?.in) {
            const set = new Set(args.where.evidenceId.in);
            rows = rows.filter((a) => set.has(a.evidenceId));
          } else if (args.where.evidenceId !== undefined) {
            rows = rows.filter((a) => a.evidenceId === args.where.evidenceId);
          }
          if (args.where.tenantId !== undefined) {
            rows = rows.filter((a) => a.tenantId === args.where.tenantId);
          }
          if (args.where.deletedAt === null) {
            rows = rows.filter((a) => a.deletedAt === null);
          }
        }

        rows.sort((a, b) => {
          const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          if (timeDiff !== 0) return timeDiff;
          return a.id.localeCompare(b.id);
        });

        return rows.map((a) => ({
          id: a.id,
          evidenceId: a.evidenceId,
          tenantId: a.tenantId,
          url: a.url,
          fileName: a.fileName,
          fileSize: a.fileSize,
          fileType: a.fileType,
          createdAt: a.createdAt,
        }));
      },
    };
  }

  get evidenceComment() {
    return {
      findMany: async (args: any) => {
        this.queries.push({ model: 'evidenceComment', action: 'findMany', args });
        let rows = [...this.commentData];

        if (args?.where) {
          if (args.where.evidenceId?.in) {
            const set = new Set(args.where.evidenceId.in);
            rows = rows.filter((c) => set.has(c.evidenceId));
          } else if (args.where.evidenceId !== undefined) {
            rows = rows.filter((c) => c.evidenceId === args.where.evidenceId);
          }
          if (args.where.tenantId !== undefined) {
            rows = rows.filter((c) => c.tenantId === args.where.tenantId);
          }
          if (args.where.deletedAt === null) {
            rows = rows.filter((c) => c.deletedAt === null);
          }
        }

        rows.sort((a, b) => {
          const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          if (timeDiff !== 0) return timeDiff;
          return a.id.localeCompare(b.id);
        });

        return rows.map((c) => ({
          id: c.id,
          evidenceId: c.evidenceId,
          tenantId: c.tenantId,
          authorId: c.authorId,
          content: c.content,
          createdAt: c.createdAt,
        }));
      },
    };
  }
}

/**
 * Test Oracle representing the old naive N+1 implementation:
 * 1 query for evidence list, then for each row:
 * + 1 query for uploader
 * + 1 query for attachments
 * + 1 query for comments
 * Total = 1 + 3N queries
 */
async function naiveOldImplementationOracle(
  db: CountingFakePrismaClient,
  options: ListDisputeEvidenceOptions,
): Promise<DisputeEvidenceResultItem[]> {
  const { disputeId, tenantId, limit = 50, cursor } = options;

  const findManyArgs: any = {
    where: { disputeId, tenantId, deletedAt: null },
    take: limit,
  };
  if (cursor) {
    findManyArgs.cursor = { id: cursor };
    findManyArgs.skip = 1;
  }

  // 1 query for evidence items (without include)
  const rows = await db.disputeEvidence.findMany(findManyArgs);

  const results: DisputeEvidenceResultItem[] = [];
  for (const row of rows) {
    // N queries for uploader
    const uploader = row.uploaderId
      ? await db.user.findUnique({ where: { id: row.uploaderId } })
      : null;

    // N queries for attachments
    const attachments = await db.evidenceAttachment.findMany({
      where: { evidenceId: row.id, tenantId, deletedAt: null },
    });

    // N queries for comments
    const comments = await db.evidenceComment.findMany({
      where: { evidenceId: row.id, tenantId, deletedAt: null },
    });

    results.push({
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
      uploader,
      attachments,
      comments,
    });
  }

  return results;
}

function generateFixtures(n: number, disputeId = 'disp_1', tenantId = 'tenant_1') {
  const users: RawUser[] = [];
  const evidence: RawEvidence[] = [];
  const attachments: RawAttachment[] = [];
  const comments: RawComment[] = [];

  for (let i = 0; i < n; i++) {
    const userId = `usr_${i}`;
    users.push({
      id: userId,
      name: `User ${i}`,
      email: `user${i}@example.com`,
    });

    const evId = `ev_${i.toString().padStart(3, '0')}`;
    evidence.push({
      id: evId,
      disputeId,
      tenantId,
      uploaderId: userId,
      title: `Evidence ${i}`,
      description: `Description for evidence ${i}`,
      fileUrl: `https://storage.example.com/files/${evId}.pdf`,
      fileName: `evidence_${i}.pdf`,
      fileType: 'application/pdf',
      fileSize: 1024 * (i + 1),
      hash: `hash_${i}_sha256`,
      createdAt: new Date(1700000000000 + i * 60000).toISOString(),
      updatedAt: new Date(1700000000000 + i * 60000).toISOString(),
      deletedAt: null,
    });

    // Add 2 attachments per evidence item
    for (let a = 0; a < 2; a++) {
      attachments.push({
        id: `att_${evId}_${a}`,
        evidenceId: evId,
        tenantId,
        url: `https://storage.example.com/att/${evId}_${a}.png`,
        fileName: `att_${a}.png`,
        fileSize: 512,
        fileType: 'image/png',
        createdAt: new Date(1700000000000 + i * 60000 + a * 1000).toISOString(),
        deletedAt: null,
      });
    }

    // Add 2 comments per evidence item
    for (let c = 0; c < 2; c++) {
      comments.push({
        id: `cmt_${evId}_${c}`,
        evidenceId: evId,
        tenantId,
        authorId: `usr_arbiter_${c}`,
        content: `Review note ${c} for ${evId}`,
        createdAt: new Date(1700000000000 + i * 60000 + c * 2000).toISOString(),
        deletedAt: null,
      });
    }
  }

  return { users, evidence, attachments, comments };
}

describe('DisputeEvidenceRepository (Issue #1460: Drop N+1 reads)', () => {
  it('proves constant query count (<= 3 queries) for N = 0, 1, 5, 50', async () => {
    const testCases = [
      { n: 0, expectedNew: 1, expectedOld: 1 },
      { n: 1, expectedNew: 3, expectedOld: 4 },
      { n: 5, expectedNew: 3, expectedOld: 16 },
      { n: 50, expectedNew: 3, expectedOld: 151 },
    ];

    for (const { n, expectedNew, expectedOld } of testCases) {
      const fixture = generateFixtures(n);
      const fakeDb = new CountingFakePrismaClient(
        fixture.evidence,
        fixture.users,
        fixture.attachments,
        fixture.comments,
      );
      const repo = new DisputeEvidenceRepository(fakeDb);

      // Measure New Implementation
      fakeDb.resetQueryCount();
      const newResult = await repo.listEvidence({
        disputeId: 'disp_1',
        tenantId: 'tenant_1',
        limit: 100,
      });
      const newQueryCount = fakeDb.queryCount;

      expect(newResult).toHaveLength(n);
      expect(newQueryCount).toBe(expectedNew);

      // Measure Old Naive Implementation (test oracle)
      fakeDb.resetQueryCount();
      const oldResult = await naiveOldImplementationOracle(fakeDb, {
        disputeId: 'disp_1',
        tenantId: 'tenant_1',
        limit: 100,
      });
      const oldQueryCount = fakeDb.queryCount;

      expect(oldResult).toHaveLength(n);
      expect(oldQueryCount).toBe(expectedOld);

      // Verify that New Result deeply equals Old Result
      expect(newResult).toEqual(oldResult);
    }
  });

  it('preserves exact result equivalence on realistic multi-relational fixtures', async () => {
    const fixture = generateFixtures(5);
    const fakeDb = new CountingFakePrismaClient(
      fixture.evidence,
      fixture.users,
      fixture.attachments,
      fixture.comments,
    );
    const repo = new DisputeEvidenceRepository(fakeDb);

    const optimized = await repo.listEvidence({ disputeId: 'disp_1', tenantId: 'tenant_1' });
    const oracle = await naiveOldImplementationOracle(fakeDb, { disputeId: 'disp_1', tenantId: 'tenant_1' });

    expect(optimized).toEqual(oracle);
  });

  it('preserves ordering with deterministic tiebreaker (createdAt asc, id asc)', async () => {
    // Create items with identical createdAt to exercise the id tiebreaker
    const sameTimestamp = new Date(1700000000000).toISOString();
    const fixture = generateFixtures(3);
    fixture.evidence[0].createdAt = sameTimestamp;
    fixture.evidence[1].createdAt = sameTimestamp;
    fixture.evidence[2].createdAt = sameTimestamp;
    // Scramble order
    fixture.evidence[0].id = 'ev_c';
    fixture.evidence[1].id = 'ev_a';
    fixture.evidence[2].id = 'ev_b';

    const fakeDb = new CountingFakePrismaClient(
      fixture.evidence,
      fixture.users,
      fixture.attachments,
      fixture.comments,
    );
    const repo = new DisputeEvidenceRepository(fakeDb);

    const res = await repo.listEvidence({ disputeId: 'disp_1', tenantId: 'tenant_1' });
    expect(res.map((r) => r.id)).toEqual(['ev_a', 'ev_b', 'ev_c']);
  });

  it('preserves cursor pagination semantics', async () => {
    const fixture = generateFixtures(10);
    const fakeDb = new CountingFakePrismaClient(
      fixture.evidence,
      fixture.users,
      fixture.attachments,
      fixture.comments,
    );
    const repo = new DisputeEvidenceRepository(fakeDb);

    const page1 = await repo.listEvidence({
      disputeId: 'disp_1',
      tenantId: 'tenant_1',
      limit: 3,
    });
    expect(page1).toHaveLength(3);
    expect(page1.map((r) => r.id)).toEqual(['ev_000', 'ev_001', 'ev_002']);

    const lastId = page1[page1.length - 1].id;
    const page2 = await repo.listEvidence({
      disputeId: 'disp_1',
      tenantId: 'tenant_1',
      limit: 3,
      cursor: lastId,
    });
    expect(page2).toHaveLength(3);
    expect(page2.map((r) => r.id)).toEqual(['ev_003', 'ev_004', 'ev_005']);
  });

  it('enforces tenant isolation and dispute scoping: foreign records never leak', async () => {
    const fixture = generateFixtures(2, 'disp_1', 'tenant_1');

    // Add row belonging to another tenant
    fixture.evidence.push({
      id: 'ev_foreign_tenant',
      disputeId: 'disp_1',
      tenantId: 'tenant_other',
      uploaderId: 'usr_foreign',
      title: 'Hacked',
      description: null,
      fileUrl: 'http://evil.com/leak.pdf',
      fileName: 'leak.pdf',
      fileType: 'application/pdf',
      fileSize: 100,
      hash: 'leak',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    });

    // Add row belonging to another dispute
    fixture.evidence.push({
      id: 'ev_foreign_dispute',
      disputeId: 'disp_other',
      tenantId: 'tenant_1',
      uploaderId: 'usr_foreign2',
      title: 'Dispute 2',
      description: null,
      fileUrl: 'http://evil.com/leak2.pdf',
      fileName: 'leak2.pdf',
      fileType: 'application/pdf',
      fileSize: 100,
      hash: 'leak2',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    });

    // Add foreign attachment pointing to ev_000 but from another tenant
    fixture.attachments.push({
      id: 'att_leak',
      evidenceId: 'ev_000',
      tenantId: 'tenant_other',
      url: 'http://leak.com',
      fileName: 'leak.png',
      fileSize: 10,
      fileType: 'image/png',
      createdAt: new Date().toISOString(),
      deletedAt: null,
    });

    const fakeDb = new CountingFakePrismaClient(
      fixture.evidence,
      fixture.users,
      fixture.attachments,
      fixture.comments,
    );
    const repo = new DisputeEvidenceRepository(fakeDb);

    const res = await repo.listEvidence({ disputeId: 'disp_1', tenantId: 'tenant_1' });
    expect(res).toHaveLength(2);
    expect(res.map((r) => r.id)).toEqual(['ev_000', 'ev_001']);

    // Check that foreign attachment did not leak into ev_000
    const ev0 = res.find((r) => r.id === 'ev_000')!;
    expect(ev0.attachments.some((a) => a.id === 'att_leak')).toBe(false);
  });

  it('filters soft-deleted records (deletedAt != null)', async () => {
    const fixture = generateFixtures(3);
    fixture.evidence[1].deletedAt = new Date().toISOString();
    // Soft delete one attachment of ev_000
    fixture.attachments[0].deletedAt = new Date().toISOString();

    const fakeDb = new CountingFakePrismaClient(
      fixture.evidence,
      fixture.users,
      fixture.attachments,
      fixture.comments,
    );
    const repo = new DisputeEvidenceRepository(fakeDb);

    const res = await repo.listEvidence({ disputeId: 'disp_1', tenantId: 'tenant_1' });
    expect(res).toHaveLength(2);
    expect(res.map((r) => r.id)).toEqual(['ev_000', 'ev_002']);

    const ev0 = res.find((r) => r.id === 'ev_000')!;
    expect(ev0.attachments).toHaveLength(1);
    expect(ev0.attachments[0].id).toBe('att_ev_000_1');
  });

  it('handles missing related records gracefully (e.g. uploader null)', async () => {
    const fixture = generateFixtures(1);
    // User deleted or missing from user table
    fixture.users = [];

    const fakeDb = new CountingFakePrismaClient(
      fixture.evidence,
      fixture.users,
      fixture.attachments,
      fixture.comments,
    );
    const repo = new DisputeEvidenceRepository(fakeDb);

    const res = await repo.listEvidence({ disputeId: 'disp_1', tenantId: 'tenant_1' });
    expect(res).toHaveLength(1);
    expect(res[0].uploader).toBeNull();
    expect(res[0].attachments).toHaveLength(2);
    expect(res[0].comments).toHaveLength(2);
  });
});
