import { prisma } from '../lib/prisma.js';
import { AuditAnchorRecord } from './anchor-service.js';
import { ImmutableAuditLogEntry, ImmutableAuditStore } from './immutable-logger.js';

export class PrismaAuditStore implements ImmutableAuditStore {
  private readonly client = prisma as any;

  async getLatestAuditHash(): Promise<string | undefined> {
    const latest = await this.client.auditLog.findFirst({
      orderBy: [{ timestamp: 'desc' }, { createdAt: 'desc' }],
      select: { hash: true },
    });
    return latest?.hash;
  }

  async appendAuditEntry(entry: ImmutableAuditLogEntry): Promise<void> {
    await this.client.auditLog.create({
      data: {
        id: entry.id,
        timestamp: new Date(entry.timestamp),
        actor: entry.actor,
        action: entry.action,
        resource: entry.resource,
        details: entry.details,
        previousHash: entry.previousHash,
        hash: entry.hash,
        entityId: entry.resource,
        entityType: entry.resource,
        userId: entry.actor === 'system' ? undefined : entry.actor,
        metadata: entry.details,
      },
    });
  }

  async listAuditEntriesAscending(): Promise<ImmutableAuditLogEntry[]> {
    const rows = await this.client.auditLog.findMany({
      orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        timestamp: true,
        actor: true,
        action: true,
        resource: true,
        details: true,
        previousHash: true,
        hash: true,
      },
    });

    return rows.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp.toISOString(),
      actor: row.actor,
      action: row.action,
      resource: row.resource,
      details: row.details ?? {},
      previousHash: row.previousHash,
      hash: row.hash,
    }));
  }

  async appendAnchor(anchor: AuditAnchorRecord): Promise<void> {
    await this.client.auditAnchor.create({
      data: {
        id: anchor.id,
        latestHash: anchor.latestHash,
        chain: anchor.chain,
        transactionHash: anchor.transactionHash,
        blockNumber: anchor.blockNumber,
        status: anchor.status,
        error: anchor.error,
        createdAt: new Date(anchor.createdAt),
      },
    });
  }
}
