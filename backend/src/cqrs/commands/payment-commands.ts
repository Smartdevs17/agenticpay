/**
 * Write-side command handlers for high-volume tables.
 * All commands use the primary Prisma client via `prisma` (write model).
 */

import { registerCommandHandler, type Command } from '../command-bus.js';
import { prisma } from '../../lib/prisma.js';
import { publish } from '../../events/event-bus.js';
import type { StoredEvent } from '../../events/event-types.js';
import { randomUUID } from 'node:crypto';

// ── Record a payment (write) ─────────────────────────────────────────────────

export interface RecordPaymentCommand extends Command<string> {
  readonly _type: 'RecordPayment';
  tenantId: string;
  amount: number;
  currency: string;
  network: string;
  fromAddress?: string;
  toAddress?: string;
  projectId?: string;
  milestoneId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

registerCommandHandler<RecordPaymentCommand, string>(
  'RecordPayment',
  async (cmd): Promise<string> => {
    const payment = await prisma.payment.create({
      data: {
        tenantId: cmd.tenantId,
        amount: cmd.amount,
        currency: cmd.currency,
        network: cmd.network,
        fromAddress: cmd.fromAddress,
        toAddress: cmd.toAddress,
        projectId: cmd.projectId,
        milestoneId: cmd.milestoneId,
        userId: cmd.userId,
        metadata: cmd.metadata,
        status: 'pending',
      },
    });

    const event: StoredEvent = {
      id: randomUUID(),
      type: 'payment.created',
      aggregateId: payment.id,
      aggregateType: 'Payment',
      version: 1,
      payload: {
        from: cmd.fromAddress ?? '',
        to: cmd.toAddress ?? '',
        amount: Number(cmd.amount),
        asset: cmd.currency,
        trigger: { type: 'manual' },
      },
      metadata: {},
      occurredAt: new Date().toISOString(),
      sequenceNumber: 1,
      streamId: `Payment-${payment.id}`,
    };
    await publish(event);
    return payment.id;
  }
);

// ── Update payment status (write) ────────────────────────────────────────────

export interface UpdatePaymentStatusCommand extends Command<void> {
  readonly _type: 'UpdatePaymentStatus';
  paymentId: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled' | 'refunded';
  txHash?: string;
}

registerCommandHandler<UpdatePaymentStatusCommand, void>(
  'UpdatePaymentStatus',
  async (cmd): Promise<void> => {
    await prisma.payment.update({
      where: { id: cmd.paymentId },
      data: { status: cmd.status, txHash: cmd.txHash },
    });
    const eventType =
      cmd.status === 'completed'
        ? ('payment.executed' as const)
        : cmd.status === 'failed'
          ? ('payment.failed' as const)
          : cmd.status === 'cancelled'
            ? ('payment.cancelled' as const)
            : null;
    if (eventType) {
      await publish({
        id: randomUUID(),
        type: eventType,
        aggregateId: cmd.paymentId,
        aggregateType: 'Payment',
        version: 2,
        payload: {},
        metadata: {},
        occurredAt: new Date().toISOString(),
        sequenceNumber: 2,
        streamId: `Payment-${cmd.paymentId}`,
      });
    }
  }
);


