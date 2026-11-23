import { db } from '../db';
import { logger } from '../utils/logger';

export interface RevenueRecord {
  id: string;
  campaignId: string;
  partnerId: string;
  amount: number;
  currency: string;
  transactionId: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AttributionResult {
  campaignId: string;
  totalRevenue: number;
  attributions: {
    partnerId: string;
    amount: number;
    percentage: number;
  }[];
}

export class RevenueAttributionService {
  async recordRevenue(record: Omit<RevenueRecord, 'id' | 'timestamp'>): Promise<RevenueRecord> {
    try {
      const id = `rev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = Math.floor(Date.now() / 1000);

      const result: RevenueRecord = {
        id,
        timestamp: now,
        ...record,
      };

      await db.query(
        `INSERT INTO revenue_records (id, campaign_id, partner_id, amount, currency, transaction_id, timestamp, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, record.campaignId, record.partnerId, record.amount, record.currency, record.transactionId, now, JSON.stringify(record.metadata || {})]
      );

      logger.info(`Revenue recorded: ${id}`, { campaignId: record.campaignId, amount: record.amount });
      return result;
    } catch (error) {
      logger.error('Failed to record revenue', error);
      throw error;
    }
  }

  async getAttributionByCampaign(campaignId: string): Promise<AttributionResult> {
    try {
      const result = await db.query(
        `SELECT partner_id, SUM(amount) as total_amount, COUNT(*) as count
         FROM revenue_records
         WHERE campaign_id = $1
         GROUP BY partner_id
         ORDER BY total_amount DESC`,
        [campaignId]
      );

      const rows = result.rows || [];
      const totalRevenue = rows.reduce((sum: number, row: any) => sum + parseFloat(row.total_amount || 0), 0);

      const attributions = rows.map((row: any) => {
        const amount = parseFloat(row.total_amount || 0);
        return {
          partnerId: row.partner_id,
          amount,
          percentage: totalRevenue > 0 ? (amount / totalRevenue) * 100 : 0,
        };
      });

      return {
        campaignId,
        totalRevenue,
        attributions,
      };
    } catch (error) {
      logger.error('Failed to get attribution by campaign', error);
      throw error;
    }
  }

  async getAttributionByPartner(partnerId: string, startTime?: number, endTime?: number): Promise<AttributionResult> {
    try {
      let query = `SELECT campaign_id, SUM(amount) as total_amount
                   FROM revenue_records
                   WHERE partner_id = $1`;
      const params: any[] = [partnerId];

      if (startTime) {
        query += ` AND timestamp >= $${params.length + 1}`;
        params.push(startTime);
      }

      if (endTime) {
        query += ` AND timestamp <= $${params.length + 1}`;
        params.push(endTime);
      }

      query += ` GROUP BY campaign_id ORDER BY total_amount DESC`;

      const result = await db.query(query, params);
      const rows = result.rows || [];
      const totalRevenue = rows.reduce((sum: number, row: any) => sum + parseFloat(row.total_amount || 0), 0);

      return {
        campaignId: 'multi',
        totalRevenue,
        attributions: rows.map((row: any) => ({
          partnerId: row.campaign_id,
          amount: parseFloat(row.total_amount || 0),
          percentage: totalRevenue > 0 ? (parseFloat(row.total_amount || 0) / totalRevenue) * 100 : 0,
        })),
      };
    } catch (error) {
      logger.error('Failed to get attribution by partner', error);
      throw error;
    }
  }

  async allocateRevenue(
    campaignId: string,
    amount: number,
    rules: { partnerId: string; percentage: number }[]
  ): Promise<RevenueRecord[]> {
    try {
      const records: RevenueRecord[] = [];

      for (const rule of rules) {
        const allocatedAmount = (amount * rule.percentage) / 100;
        const record = await this.recordRevenue({
          campaignId,
          partnerId: rule.partnerId,
          amount: allocatedAmount,
          currency: 'XLM',
          transactionId: `alloc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          metadata: { allocated: true, originalAmount: amount, percentage: rule.percentage },
        });
        records.push(record);
      }

      logger.info(`Revenue allocated for campaign ${campaignId}: ${records.length} records`);
      return records;
    } catch (error) {
      logger.error('Failed to allocate revenue', error);
      throw error;
    }
  }

  async getRevenueMetrics(campaignId: string): Promise<any> {
    try {
      const result = await db.query(
        `SELECT
          COUNT(*) as transaction_count,
          SUM(amount) as total_revenue,
          AVG(amount) as avg_transaction,
          MAX(amount) as max_transaction,
          MIN(amount) as min_transaction,
          COUNT(DISTINCT partner_id) as unique_partners
         FROM revenue_records
         WHERE campaign_id = $1`,
        [campaignId]
      );

      const row = result.rows?.[0] || {};
      return {
        campaignId,
        transactionCount: parseInt(row.transaction_count || 0, 10),
        totalRevenue: parseFloat(row.total_revenue || 0),
        averageTransaction: parseFloat(row.avg_transaction || 0),
        maxTransaction: parseFloat(row.max_transaction || 0),
        minTransaction: parseFloat(row.min_transaction || 0),
        uniquePartners: parseInt(row.unique_partners || 0, 10),
      };
    } catch (error) {
      logger.error('Failed to get revenue metrics', error);
      throw error;
    }
  }
}

export const revenueAttributionService = new RevenueAttributionService();
