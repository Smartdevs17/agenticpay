import { db } from '../db';
import { logger } from '../utils/logger';
import { Queue } from 'bullmq';

export interface PayoutTranche {
  id: string;
  batchId: string;
  recipientId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'approved' | 'scheduled' | 'executed' | 'failed';
  requiredApprovals: number;
  currentApprovals: number;
  approvers: string[];
  scheduledFor: number;
  executedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface PayoutBatch {
  id: string;
  totalAmount: number;
  currency: string;
  totalTranches: number;
  status: 'draft' | 'pending_approval' | 'scheduled' | 'executing' | 'completed' | 'failed';
  createdAt: number;
  createdBy: string;
}

export class PayoutSchedulerService {
  private queue: Queue;

  constructor(queue?: Queue) {
    this.queue = queue || new Queue('payout-scheduler');
  }

  async createBatch(totalAmount: number, currency: string, createdBy: string): Promise<PayoutBatch> {
    try {
      const id = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = Math.floor(Date.now() / 1000);

      const batch: PayoutBatch = {
        id,
        totalAmount,
        currency,
        totalTranches: 0,
        status: 'draft',
        createdAt: now,
        createdBy,
      };

      await db.query(
        `INSERT INTO payout_batches (id, total_amount, currency, total_tranches, status, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, totalAmount, currency, 0, 'draft', now, createdBy]
      );

      logger.info(`Payout batch created: ${id}`, { totalAmount, currency });
      return batch;
    } catch (error) {
      logger.error('Failed to create payout batch', error);
      throw error;
    }
  }

  async addTranche(
    batchId: string,
    recipientId: string,
    amount: number,
    requiredApprovals: number,
    scheduledFor: number
  ): Promise<PayoutTranche> {
    try {
      const id = `tranche_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const tranche: PayoutTranche = {
        id,
        batchId,
        recipientId,
        amount,
        currency: 'XLM',
        status: 'pending',
        requiredApprovals,
        currentApprovals: 0,
        approvers: [],
        scheduledFor,
      };

      await db.query(
        `INSERT INTO payout_tranches (id, batch_id, recipient_id, amount, currency, status, required_approvals, current_approvals, scheduled_for)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, batchId, recipientId, amount, 'XLM', 'pending', requiredApprovals, 0, scheduledFor]
      );

      await db.query(
        `UPDATE payout_batches SET total_tranches = total_tranches + 1 WHERE id = $1`,
        [batchId]
      );

      logger.info(`Tranche added to batch ${batchId}: ${id}`, { amount, recipientId });
      return tranche;
    } catch (error) {
      logger.error('Failed to add payout tranche', error);
      throw error;
    }
  }

  async approveTranche(trancheId: string, approverId: string): Promise<PayoutTranche> {
    try {
      const result = await db.query(
        `SELECT * FROM payout_tranches WHERE id = $1`,
        [trancheId]
      );

      const tranche = result.rows?.[0];
      if (!tranche) throw new Error('Tranche not found');

      if (tranche.approvers.includes(approverId)) {
        throw new Error('Already approved by this user');
      }

      const approvers = [...(tranche.approvers || []), approverId];
      const currentApprovals = approvers.length;

      let status = 'pending';
      if (currentApprovals >= tranche.required_approvals) {
        status = 'approved';
      }

      await db.query(
        `UPDATE payout_tranches SET current_approvals = $1, approvers = $2, status = $3 WHERE id = $4`,
        [currentApprovals, JSON.stringify(approvers), status, trancheId]
      );

      if (status === 'approved') {
        const batch = await db.query(
          `SELECT batch_id FROM payout_tranches WHERE id = $1`,
          [trancheId]
        );
        const batchId = batch.rows?.[0]?.batch_id;
        await this.queue.add('schedule-payout', { trancheId, batchId });
      }

      logger.info(`Tranche ${trancheId} approved by ${approverId}`, { currentApprovals: currentApprovals, required: tranche.required_approvals });

      return { ...tranche, currentApprovals, approvers, status };
    } catch (error) {
      logger.error('Failed to approve tranche', error);
      throw error;
    }
  }

  async scheduleBatch(batchId: string): Promise<PayoutBatch> {
    try {
      const result = await db.query(
        `SELECT * FROM payout_batches WHERE id = $1`,
        [batchId]
      );

      const batch = result.rows?.[0];
      if (!batch) throw new Error('Batch not found');

      await db.query(
        `UPDATE payout_batches SET status = 'scheduled' WHERE id = $1`,
        [batchId]
      );

      await db.query(
        `UPDATE payout_tranches SET status = 'scheduled' WHERE batch_id = $1 AND status = 'approved'`,
        [batchId]
      );

      await this.queue.add('execute-batch', { batchId });

      logger.info(`Batch ${batchId} scheduled for execution`);

      return { ...batch, status: 'scheduled' };
    } catch (error) {
      logger.error('Failed to schedule batch', error);
      throw error;
    }
  }

  async executeTranche(trancheId: string): Promise<PayoutTranche> {
    try {
      const result = await db.query(
        `SELECT * FROM payout_tranches WHERE id = $1`,
        [trancheId]
      );

      const tranche = result.rows?.[0];
      if (!tranche) throw new Error('Tranche not found');

      const now = Math.floor(Date.now() / 1000);

      await db.query(
        `UPDATE payout_tranches SET status = 'executed', executed_at = $1 WHERE id = $2`,
        [now, trancheId]
      );

      logger.info(`Tranche ${trancheId} executed successfully`);

      return { ...tranche, status: 'executed', executedAt: now };
    } catch (error) {
      logger.error('Failed to execute tranche', error);
      throw error;
    }
  }

  async getBatch(batchId: string): Promise<PayoutBatch> {
    try {
      const result = await db.query(
        `SELECT * FROM payout_batches WHERE id = $1`,
        [batchId]
      );

      if (!result.rows?.[0]) throw new Error('Batch not found');

      const batch = result.rows[0];
      return {
        id: batch.id,
        totalAmount: batch.total_amount,
        currency: batch.currency,
        totalTranches: batch.total_tranches,
        status: batch.status,
        createdAt: batch.created_at,
        createdBy: batch.created_by,
      };
    } catch (error) {
      logger.error('Failed to get batch', error);
      throw error;
    }
  }

  async getBatchTranches(batchId: string): Promise<PayoutTranche[]> {
    try {
      const result = await db.query(
        `SELECT * FROM payout_tranches WHERE batch_id = $1 ORDER BY created_at ASC`,
        [batchId]
      );

      return (result.rows || []).map((row: any) => ({
        id: row.id,
        batchId: row.batch_id,
        recipientId: row.recipient_id,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
        requiredApprovals: row.required_approvals,
        currentApprovals: row.current_approvals,
        approvers: row.approvers || [],
        scheduledFor: row.scheduled_for,
        executedAt: row.executed_at,
      }));
    } catch (error) {
      logger.error('Failed to get batch tranches', error);
      throw error;
    }
  }
}

export const payoutSchedulerService = new PayoutSchedulerService();
