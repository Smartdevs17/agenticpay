/**
 * backend/src/repositories/AuditLogRepository.ts
 *
 * Repository encapsulation for AuditLog entity queries.
 * Queries moved verbatim under Issue #1404 with transaction support.
 */

import { prisma, PrismaClient } from '../lib/prisma.js';

type DbClient = PrismaClient | any;

export interface AuditLogCreateInput {
  id?: string;
  action: string;
  entityType: string;
  entityId: string;
  userId?: string;
  actor?: string;
  details?: any;
  ipAddress?: string;
  createdAt?: Date;
}

export class AuditLogRepository {
  constructor(private readonly db: DbClient = prisma) {}

  withTransaction(tx: DbClient): AuditLogRepository {
    return new AuditLogRepository(tx);
  }

  async create(data: AuditLogCreateInput) {
    return this.db.auditLog.create({
      data,
    });
  }

  async listByEntity(entityType: string, entityId: string, limit = 50) {
    return this.db.auditLog.findMany({
      where: { entityType, entityId },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async listByUser(userId: string, limit = 50) {
    return this.db.auditLog.findMany({
      where: { userId },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async count(entityType?: string): Promise<number> {
    return this.db.auditLog.count({
      where: entityType ? { entityType } : undefined,
    });
  }
}

export const defaultAuditLogRepository = new AuditLogRepository();
