import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { prisma } from '../../lib/prisma.js';
import type {
  WebhookSubscription,
  WebhookSubscriptionDelivery,
  SubscriptionStatus,
  DeliveryStatus,
} from '@prisma/client';

export type {
  WebhookSubscription,
  WebhookSubscriptionDelivery,
  SubscriptionStatus,
  DeliveryStatus,
};

export interface CreateSubscriptionInput {
  tenantId: string;
  eventTypes: string[];
  targetUrl: string;
  filterExpr?: string;
  description?: string;
}

export interface UpdateSubscriptionInput {
  eventTypes?: string[];
  targetUrl?: string;
  filterExpr?: string | null;
  description?: string;
}

export interface SubscriptionFilter {
  tenantId?: string;
  status?: SubscriptionStatus;
  eventType?: string;
}

export interface SubscriptionMetrics {
  totalCount: number;
  activeCount: number;
  pausedCount: number;
  disabledCount: number;
  avgSuccessRate: number;
  totalDeliveriesAll: number;
}

export interface SubscriptionVersion {
  version: number;
  eventTypes: string[];
  filterExpr: string | null;
  targetUrl: string;
  createdAt: Date;
}

export interface DeliveryStats {
  deliveryCount: number;
  successCount: number;
  failCount: number;
  avgLatency: number | null;
  successRate: number;
}

export class SubscriptionManager extends BaseService {
  async create(input: CreateSubscriptionInput): Promise<Result<WebhookSubscription>> {
    try {
      const subscription = await prisma.webhookSubscription.create({
        data: {
          tenantId: input.tenantId,
          eventTypes: input.eventTypes,
          filterExpr: input.filterExpr ?? null,
          targetUrl: input.targetUrl,
          description: input.description ?? null,
        },
      });
      return this.ok(subscription);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async get(id: string, tenantId: string): Promise<Result<WebhookSubscription>> {
    try {
      const sub = await prisma.webhookSubscription.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!sub) return this.notFoundFailure('WebhookSubscription', id);
      return this.ok(sub);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async list(tenantId: string, filter?: SubscriptionFilter): Promise<Result<WebhookSubscription[]>> {
    try {
      const subs = await prisma.webhookSubscription.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...(filter?.status ? { status: filter.status } : {}),
          ...(filter?.eventType ? { eventTypes: { has: filter.eventType } } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
      return this.ok(subs);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async update(
    id: string,
    tenantId: string,
    input: UpdateSubscriptionInput,
  ): Promise<Result<WebhookSubscription>> {
    try {
      const existing = await prisma.webhookSubscription.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!existing) return this.notFoundFailure('WebhookSubscription', id);

      const subscription = await prisma.webhookSubscription.update({
        where: { id },
        data: {
          ...(input.eventTypes !== undefined ? { eventTypes: input.eventTypes } : {}),
          ...(input.targetUrl !== undefined ? { targetUrl: input.targetUrl } : {}),
          ...(input.filterExpr !== undefined ? { filterExpr: input.filterExpr } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          version: { increment: 1 },
        },
      });
      return this.ok(subscription);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async delete(id: string, tenantId: string): Promise<Result<void>> {
    try {
      const existing = await prisma.webhookSubscription.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!existing) return this.notFoundFailure('WebhookSubscription', id);

      await prisma.webhookSubscription.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'disabled' },
      });
      return this.ok(undefined as void);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async pause(id: string, tenantId: string): Promise<Result<WebhookSubscription>> {
    try {
      const existing = await prisma.webhookSubscription.findFirst({
        where: { id, tenantId, deletedAt: null, status: 'active' },
      });
      if (!existing) return this.notFoundFailure('WebhookSubscription', id);

      const sub = await prisma.webhookSubscription.update({
        where: { id },
        data: { status: 'paused', pausedAt: new Date(), version: { increment: 1 } },
      });
      return this.ok(sub);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async resume(id: string, tenantId: string): Promise<Result<WebhookSubscription>> {
    try {
      const existing = await prisma.webhookSubscription.findFirst({
        where: { id, tenantId, deletedAt: null, status: 'paused' },
      });
      if (!existing) return this.notFoundFailure('WebhookSubscription', id);

      const sub = await prisma.webhookSubscription.update({
        where: { id },
        data: { status: 'active', pausedAt: null, version: { increment: 1 } },
      });
      return this.ok(sub);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async testSubscription(
    id: string,
    tenantId: string,
    samplePayload: Record<string, unknown>,
    eventType?: string,
  ): Promise<Result<WebhookSubscriptionDelivery>> {
    try {
      const sub = await prisma.webhookSubscription.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!sub) return this.notFoundFailure('WebhookSubscription', id);
      if (sub.status !== 'active') {
        return this.conflictFailure('Cannot test a non-active subscription');
      }

      const eventTypeToUse = eventType ?? 'test.ping';

      const delivery = await prisma.webhookSubscriptionDelivery.create({
        data: {
          subscriptionId: id,
          eventType: eventTypeToUse,
          payload: samplePayload,
          status: 'pending',
        },
      });

      const startMs = Date.now();
      let statusCode: number | undefined;
      let errorMessage: string | undefined;
      let finalStatus: DeliveryStatus = 'delivered';

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8_000);
        const response = await fetch(sub.targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Test-Webhook': 'true',
            'X-Subscription-Id': sub.id,
            'X-Event-Type': eventTypeToUse,
          },
          body: JSON.stringify(samplePayload),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        statusCode = response.status;
        if (!response.ok) {
          finalStatus = 'failed';
          errorMessage = `HTTP ${response.status}`;
        }
      } catch (error) {
        finalStatus = 'failed';
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      const latencyMs = Date.now() - startMs;

      const updated = await prisma.webhookSubscriptionDelivery.update({
        where: { id: delivery.id },
        data: {
          status: finalStatus,
          statusCode,
          latencyMs,
          errorMessage,
          attemptCount: { increment: 1 },
          completedAt: new Date(),
        },
      });

      return this.ok(updated);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async getMetrics(tenantId: string): Promise<Result<SubscriptionMetrics>> {
    try {
      const subs = await prisma.webhookSubscription.findMany({
        where: { tenantId, deletedAt: null },
      });

      const totalCount = subs.length;
      const activeCount = subs.filter((s) => s.status === 'active').length;
      const pausedCount = subs.filter((s) => s.status === 'paused').length;
      const disabledCount = subs.filter((s) => s.status === 'disabled').length;

      const deliveredSubs = subs.filter((s) => s.deliveryCount > 0);
      const totalSuccessRate =
        deliveredSubs.length > 0
          ? deliveredSubs.reduce((sum, s) => {
              const rate = s.deliveryCount > 0 ? s.successCount / s.deliveryCount : 0;
              return sum + rate;
            }, 0) / deliveredSubs.length
          : 0;

      const totalDeliveriesAll = subs.reduce((sum, s) => sum + s.deliveryCount, 0);

      return this.ok({
        totalCount,
        activeCount,
        pausedCount,
        disabledCount,
        avgSuccessRate: Math.round(totalSuccessRate * 10000) / 100,
        totalDeliveriesAll,
      });
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async getDeliveryStats(id: string, tenantId: string): Promise<Result<DeliveryStats>> {
    try {
      const sub = await prisma.webhookSubscription.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!sub) return this.notFoundFailure('WebhookSubscription', id);

      const successRate =
        sub.deliveryCount > 0
          ? Math.round((sub.successCount / sub.deliveryCount) * 10000) / 100
          : 0;

      return this.ok({
        deliveryCount: sub.deliveryCount,
        successCount: sub.successCount,
        failCount: sub.failCount,
        avgLatency: sub.avgLatency,
        successRate,
      });
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async getVersionHistory(id: string, tenantId: string): Promise<Result<SubscriptionVersion[]>> {
    try {
      const sub = await prisma.webhookSubscription.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!sub) return this.notFoundFailure('WebhookSubscription', id);

      const deliveries = await prisma.webhookSubscriptionDelivery.findMany({
        where: { subscriptionId: id },
        orderBy: { createdAt: 'asc' },
        take: 1,
      });

      const history: SubscriptionVersion[] = [
        {
          version: sub.version,
          eventTypes: sub.eventTypes,
          filterExpr: sub.filterExpr,
          targetUrl: sub.targetUrl,
          createdAt: sub.updatedAt,
        },
      ];

      return this.ok(history);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async listDeliveries(
    subscriptionId: string,
    tenantId: string,
    limit = 50,
    offset = 0,
  ): Promise<Result<WebhookSubscriptionDelivery[]>> {
    try {
      const sub = await prisma.webhookSubscription.findFirst({
        where: { id: subscriptionId, tenantId, deletedAt: null },
      });
      if (!sub) return this.notFoundFailure('WebhookSubscription', subscriptionId);

      const deliveries = await prisma.webhookSubscriptionDelivery.findMany({
        where: { subscriptionId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      });

      return this.ok(deliveries);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }
}

export const subscriptionManager = new SubscriptionManager();
