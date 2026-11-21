/**
 * backend/src/repositories/NotificationRepository.ts
 *
 * Repository encapsulation for PushSubscription, PushPreference, and NotificationLog.
 * Queries moved verbatim under Issue #1404 with transaction support.
 */

import { prisma, PrismaClient } from '../lib/prisma.js';

type DbClient = PrismaClient | any;

export class NotificationRepository {
  constructor(private readonly db: DbClient = prisma) {}

  withTransaction(tx: DbClient): NotificationRepository {
    return new NotificationRepository(tx);
  }

  // ── Push Subscription Queries ──────────────────────────────────────────────

  async findFirstSubscription(where: any) {
    return this.db.pushSubscription.findFirst({ where });
  }

  async findManySubscriptions(where: any) {
    return this.db.pushSubscription.findMany({ where });
  }

  async createSubscription(data: any) {
    return this.db.pushSubscription.create({ data });
  }

  async updateSubscription(where: any, data: any) {
    return this.db.pushSubscription.update({ where, data });
  }

  async updateManySubscriptions(where: any, data: any) {
    return this.db.pushSubscription.updateMany({ where, data });
  }

  // ── Push Preferences Queries ───────────────────────────────────────────────

  async findPreference(where: any) {
    return this.db.pushPreference.findUnique({ where });
  }

  async createPreference(data: any) {
    return this.db.pushPreference.create({ data });
  }

  async updatePreference(where: any, data: any) {
    return this.db.pushPreference.update({ where, data });
  }

  // ── Notification Log Queries ───────────────────────────────────────────────

  async createNotificationLog(data: any) {
    return this.db.notificationLog.create({ data });
  }

  async updateNotificationLog(where: any, data: any) {
    return this.db.notificationLog.update({ where, data });
  }

  async findManyLogs(where: any, limit = 50, orderBy: any = { createdAt: 'desc' }) {
    return this.db.notificationLog.findMany({
      where,
      orderBy,
      take: limit,
    });
  }
}

export const defaultNotificationRepository = new NotificationRepository();
