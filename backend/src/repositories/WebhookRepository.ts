/**
 * backend/src/repositories/WebhookRepository.ts
 *
 * Repository encapsulation for Webhook entity queries.
 * Queries moved verbatim under Issue #1404 with transaction support.
 */

import { prisma, PrismaClient } from '../lib/prisma.js';

type DbClient = PrismaClient | any;

export interface WebhookCreateInput {
  id?: string;
  url: string;
  events: string[];
  secret?: string;
  merchantId?: string;
  active?: boolean;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface WebhookUpdateInput {
  url?: string;
  events?: string[];
  active?: boolean;
  secret?: string;
  metadata?: Record<string, unknown>;
  updatedAt?: Date;
}

export class WebhookRepository {
  constructor(private readonly db: DbClient = prisma) {}

  withTransaction(tx: DbClient): WebhookRepository {
    return new WebhookRepository(tx);
  }

  async findById(id: string) {
    return this.db.webhook.findUnique({
      where: { id },
    });
  }

  async listByMerchant(merchantId: string) {
    return this.db.webhook.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listActive() {
    return this.db.webhook.findMany({
      where: { active: true },
    });
  }

  async create(data: WebhookCreateInput) {
    return this.db.webhook.create({
      data,
    });
  }

  async update(id: string, data: WebhookUpdateInput) {
    return this.db.webhook.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return this.db.webhook.delete({
      where: { id },
    });
  }
}

export const defaultWebhookRepository = new WebhookRepository();
