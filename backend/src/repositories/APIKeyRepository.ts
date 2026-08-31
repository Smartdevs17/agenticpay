/**
 * APIKeyRepository.ts — Issue #728
 *
 * Repository for API key data access using Prisma
 */

import { PrismaRepository } from './implementations/PrismaRepository.js';
import { QueryBuilder } from './QueryBuilder.js';
import { prisma } from '../lib/prisma.js';

export interface APIKey {
  id: string;
  keyId: string;
  tenantId: string;
  description?: string;
  expiresAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date;
  rotatedAt?: Date;
  gracePeriodEndsAt?: Date;
  predecessorKeyId?: string;
  successorKeyId?: string;
}

export class APIKeyRepository extends PrismaRepository<APIKey> {
  constructor() {
    super(prisma.apiKey as any);
  }

  async findByKeyId(keyId: string): Promise<APIKey | null> {
    return (prisma.apiKey.findUnique({
      where: { keyId },
      include: { quota: true },
    }) as unknown) as APIKey | null;
  }

  async findByTenant(tenantId: string, options?: { orderBy?: string; limit?: number }) {
    const qb = new QueryBuilder<APIKey>().where({ tenantId } as any);
    if (options?.limit) qb.limit(options.limit);
    if (options?.orderBy) qb.orderBy('createdAt' as any, 'desc');
    const built = qb.build();
    return (prisma.apiKey.findMany({
      where: built.where,
      take: built.limit,
      orderBy: built.orderBy || { createdAt: 'desc' },
      include: {
        _count: { select: { usage: true } },
        quota: true,
      },
    }) as unknown) as APIKey[];
  }

  async deactivate(keyId: string): Promise<boolean> {
    try {
      await (prisma.apiKey.update({
        where: { keyId },
        data: { isActive: false, revokedAt: new Date() },
      }) as unknown);
      return true;
    } catch {
      return false;
    }
  }
}
