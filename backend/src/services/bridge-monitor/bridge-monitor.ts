/**
 * bridge-monitor.ts — Issue #475
 *
 * Tracks cross-chain bridge messages from source to destination,
 * detects delays/failures, and provides health analytics.
 */

import { randomUUID } from 'node:crypto';
import type { BridgeMessageStatus, BridgeProvider } from '@prisma/client';
import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { prisma } from '../../lib/prisma.js';
import { evaluateMessage, dispatchBridgeAlert, getExpectedDeliveryMs } from './alert-engine.js';
import { pollAllBridgeEvents, type BridgeEvent } from './listeners/index.js';

export interface BridgeHealthSummary {
  totalMessages: number;
  byStatus: Record<string, number>;
  byProvider: Record<string, number>;
  successRate: number;
  averageLatencyMs: number;
  stuckCount: number;
  pendingAlerts: number;
}

export interface BridgeAnalytics {
  period: string;
  volume: number;
  successRate: number;
  averageLatencyMs: number;
  failureTrend: Array<{ date: string; failures: number; total: number }>;
  byProvider: Array<{
    provider: BridgeProvider;
    volume: number;
    successRate: number;
    averageLatencyMs: number;
  }>;
}

const inMemoryMessages = new Map<string, BridgeEvent & { id: string; initiatedAt: Date }>();

class BridgeMonitorService extends BaseService {
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private usePrisma(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  start(pollIntervalMs = 30_000): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.pollAndReconcile().catch((err) =>
        console.error('[bridge-monitor] Poll failed:', err),
      );
    }, pollIntervalMs);
    console.log(`[bridge-monitor] Started (interval=${pollIntervalMs}ms)`);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async trackMessage(event: BridgeEvent): Promise<Result<{ id: string }>> {
    const expectedDeliveryMs = getExpectedDeliveryMs(event.provider);

    if (this.usePrisma()) {
      const msg = await prisma.bridgeMessage.upsert({
        where: {
          provider_messageId: { provider: event.provider, messageId: event.messageId },
        },
        create: {
          provider: event.provider,
          messageId: event.messageId,
          sourceChain: event.sourceChain,
          destinationChain: event.destinationChain,
          status: event.status,
          txHashSource: event.txHashSource,
          txHashDestination: event.txHashDestination,
          amount: event.amount,
          tokenAddress: event.tokenAddress,
          sender: event.sender,
          recipient: event.recipient,
          gasCostSource: event.gasCostSource,
          gasCostDestination: event.gasCostDestination,
          expectedDeliveryMs,
          metadata: event.metadata,
          ...(event.status === 'source_confirmed' ? { sourceConfirmedAt: new Date() } : {}),
          ...(event.status === 'relayed' ? { relayedAt: new Date() } : {}),
          ...(event.status === 'destination_executed' ? { executedAt: new Date() } : {}),
        },
        update: {
          status: event.status,
          txHashSource: event.txHashSource ?? undefined,
          txHashDestination: event.txHashDestination ?? undefined,
          ...(event.status === 'source_confirmed' ? { sourceConfirmedAt: new Date() } : {}),
          ...(event.status === 'relayed' ? { relayedAt: new Date() } : {}),
          ...(event.status === 'destination_executed' ? { executedAt: new Date() } : {}),
        },
      });

      await this.evaluateAndAlert(msg.id);
      return this.ok({ id: msg.id });
    }

    const id = randomUUID();
    inMemoryMessages.set(id, { ...event, id, initiatedAt: new Date() });
    return this.ok({ id });
  }

  private async evaluateAndAlert(messageDbId: string): Promise<void> {
    if (!this.usePrisma()) return;

    const msg = await prisma.bridgeMessage.findUnique({ where: { id: messageDbId } });
    if (!msg) return;

    const alerts = evaluateMessage({
      id: msg.id,
      provider: msg.provider,
      sourceChain: msg.sourceChain,
      destinationChain: msg.destinationChain,
      messageId: msg.messageId,
      status: msg.status,
      initiatedAt: msg.initiatedAt,
      sourceConfirmedAt: msg.sourceConfirmedAt,
      relayedAt: msg.relayedAt,
      executedAt: msg.executedAt,
      expectedDeliveryMs: msg.expectedDeliveryMs,
    });

    for (const alert of alerts) {
      const existing = await prisma.bridgeAlert.findFirst({
        where: { messageId: messageDbId, alertType: alert.alertType, acknowledged: false },
      });
      if (existing) continue;

      await prisma.bridgeAlert.create({ data: alert });
      void dispatchBridgeAlert(alert);
    }

    if (['initiated', 'source_confirmed', 'relayed'].includes(msg.status)) {
      const age = Date.now() - msg.initiatedAt.getTime();
      if (age > msg.expectedDeliveryMs * 3) {
        await prisma.bridgeMessage.update({
          where: { id: messageDbId },
          data: { status: 'stuck' },
        });
      }
    }
  }

  async pollAndReconcile(): Promise<void> {
    const events = await pollAllBridgeEvents();
    for (const event of events) {
      await this.trackMessage(event);
    }

    if (this.usePrisma()) {
      const pending = await prisma.bridgeMessage.findMany({
        where: { status: { in: ['initiated', 'source_confirmed', 'relayed'] } },
      });
      for (const msg of pending) {
        await this.evaluateAndAlert(msg.id);
      }
    }
  }

  async retryMessage(messageId: string, initiatedBy?: string): Promise<Result<{ retryId: string }>> {
    if (!this.usePrisma()) {
      return this.fail('Database required for retry', 503, 'DB_UNAVAILABLE');
    }

    const msg = await prisma.bridgeMessage.findUnique({ where: { id: messageId } });
    if (!msg) return this.notFoundFailure('BridgeMessage', messageId);

    const attemptCount = await prisma.bridgeRetry.count({ where: { messageId } });

    const retry = await prisma.bridgeRetry.create({
      data: {
        messageId,
        attempt: attemptCount + 1,
        status: 'pending',
        initiatedBy,
      },
    });

    await prisma.bridgeMessage.update({
      where: { id: messageId },
      data: { status: 'initiated' },
    });

    return this.ok({ retryId: retry.id });
  }

  async getHealth(): Promise<Result<BridgeHealthSummary>> {
    if (!this.usePrisma()) {
      const msgs = Array.from(inMemoryMessages.values());
      return this.ok({
        totalMessages: msgs.length,
        byStatus: {},
        byProvider: {},
        successRate: 0,
        averageLatencyMs: 0,
        stuckCount: 0,
        pendingAlerts: 0,
      });
    }

    const [total, byStatus, byProvider, completed, stuck, pendingAlerts, latencyAgg] =
      await Promise.all([
        prisma.bridgeMessage.count(),
        prisma.bridgeMessage.groupBy({ by: ['status'], _count: true }),
        prisma.bridgeMessage.groupBy({ by: ['provider'], _count: true }),
        prisma.bridgeMessage.count({ where: { status: 'destination_executed' } }),
        prisma.bridgeMessage.count({ where: { status: 'stuck' } }),
        prisma.bridgeAlert.count({ where: { acknowledged: false } }),
        prisma.bridgeMessage.findMany({
          where: { status: 'destination_executed', executedAt: { not: null } },
          select: { initiatedAt: true, executedAt: true },
          take: 500,
        }),
      ]);

    const statusMap: Record<string, number> = {};
    for (const s of byStatus) statusMap[s.status] = s._count;

    const providerMap: Record<string, number> = {};
    for (const p of byProvider) providerMap[p.provider] = p._count;

    const latencies = latencyAgg
      .filter((m) => m.executedAt)
      .map((m) => m.executedAt!.getTime() - m.initiatedAt.getTime());
    const averageLatencyMs =
      latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

    return this.ok({
      totalMessages: total,
      byStatus: statusMap,
      byProvider: providerMap,
      successRate: total > 0 ? completed / total : 0,
      averageLatencyMs,
      stuckCount: stuck,
      pendingAlerts,
    });
  }

  async getAnalytics(days = 30): Promise<Result<BridgeAnalytics>> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    if (!this.usePrisma()) {
      return this.ok({
        period: `${days}d`,
        volume: 0,
        successRate: 0,
        averageLatencyMs: 0,
        failureTrend: [],
        byProvider: [],
      });
    }

    const messages = await prisma.bridgeMessage.findMany({
      where: { initiatedAt: { gte: since } },
    });

    const completed = messages.filter((m) => m.status === 'destination_executed');
    const failed = messages.filter((m) => ['failed', 'stuck', 'expired'].includes(m.status));

    const latencies = completed
      .filter((m) => m.executedAt)
      .map((m) => m.executedAt!.getTime() - m.initiatedAt.getTime());

    const trendMap = new Map<string, { failures: number; total: number }>();
    for (const msg of messages) {
      const date = msg.initiatedAt.toISOString().slice(0, 10);
      const entry = trendMap.get(date) ?? { failures: 0, total: 0 };
      entry.total++;
      if (['failed', 'stuck', 'expired'].includes(msg.status)) entry.failures++;
      trendMap.set(date, entry);
    }

    const providers: BridgeProvider[] = ['wormhole', 'layerzero', 'axelar', 'custom'];
    const byProvider = providers.map((provider) => {
      const providerMsgs = messages.filter((m) => m.provider === provider);
      const providerCompleted = providerMsgs.filter((m) => m.status === 'destination_executed');
      const providerLatencies = providerCompleted
        .filter((m) => m.executedAt)
        .map((m) => m.executedAt!.getTime() - m.initiatedAt.getTime());

      return {
        provider,
        volume: providerMsgs.length,
        successRate: providerMsgs.length > 0 ? providerCompleted.length / providerMsgs.length : 0,
        averageLatencyMs:
          providerLatencies.length > 0
            ? providerLatencies.reduce((a, b) => a + b, 0) / providerLatencies.length
            : 0,
      };
    });

    return this.ok({
      period: `${days}d`,
      volume: messages.length,
      successRate: messages.length > 0 ? completed.length / messages.length : 0,
      averageLatencyMs:
        latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      failureTrend: Array.from(trendMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, ...v })),
      byProvider,
    });
  }

  async listMessages(filters?: {
    provider?: BridgeProvider;
    status?: BridgeMessageStatus;
    limit?: number;
  }) {
    const limit = filters?.limit ?? 50;

    if (!this.usePrisma()) {
      return this.ok({
        messages: Array.from(inMemoryMessages.values()).slice(0, limit),
      });
    }

    const messages = await prisma.bridgeMessage.findMany({
      where: {
        ...(filters?.provider ? { provider: filters.provider } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      orderBy: { initiatedAt: 'desc' },
      take: limit,
      include: { alerts: { where: { acknowledged: false }, take: 5 } },
    });

    return this.ok({ messages });
  }
}

let instance: BridgeMonitorService | null = null;

export function getBridgeMonitorService(): BridgeMonitorService {
  if (!instance) instance = new BridgeMonitorService();
  return instance;
}
