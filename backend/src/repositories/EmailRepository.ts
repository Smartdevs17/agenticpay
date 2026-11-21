/**
 * backend/src/repositories/EmailRepository.ts
 *
 * Repository encapsulation for EmailTemplate, EmailDelivery, EmailPreference,
 * and EmailAnalytics entities.
 * Queries moved verbatim under Issue #1404 with transaction support.
 */

import { prisma, PrismaClient } from '../lib/prisma.js';

type DbClient = PrismaClient | any;

export class EmailRepository {
  constructor(private readonly db: DbClient = prisma) {}

  withTransaction(tx: DbClient): EmailRepository {
    return new EmailRepository(tx);
  }

  // ── Template queries ─────────────────────────────────────────────────────────

  async findTemplateByName(name: string) {
    return this.db.emailTemplate.findUnique({
      where: { name },
    });
  }

  async createTemplate(data: any) {
    return this.db.emailTemplate.create({ data });
  }

  async updateTemplate(name: string, data: any) {
    return this.db.emailTemplate.update({
      where: { name },
      data,
    });
  }

  // ── Delivery queries ─────────────────────────────────────────────────────────

  async createDelivery(data: any) {
    return this.db.emailDelivery.create({ data });
  }

  async updateDeliveryStatus(id: string, status: string, error?: string) {
    return this.db.emailDelivery.update({
      where: { id },
      data: { status, error, updatedAt: new Date() },
    });
  }

  async listDeliveriesByUser(userId: string, limit = 50) {
    return this.db.emailDelivery.findMany({
      where: { userId },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Preference queries ───────────────────────────────────────────────────────

  async findPreference(userId: string) {
    return this.db.emailPreference.findUnique({
      where: { userId },
    });
  }

  async upsertPreference(userId: string, data: any) {
    return this.db.emailPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  // ── Analytics queries ────────────────────────────────────────────────────────

  async logEvent(data: any) {
    return this.db.emailAnalytics.create({ data });
  }
}

export const defaultEmailRepository = new EmailRepository();
