import { db } from '../../db';
import { logger } from '../../utils/logger';

export interface TaxRule {
  id: string;
  corridor: string;
  jurisdiction: string;
  taxRate: number;
  taxType: 'income' | 'sales' | 'capital_gains' | 'vat';
  applicableFrom: number;
  applicableTo?: number;
  conditions?: Record<string, unknown>;
  active: boolean;
}

export interface TaxCalculation {
  grossAmount: number;
  taxAmount: number;
  netAmount: number;
  taxRate: number;
  applicableRules: TaxRule[];
}

export class TaxRulesEngine {
  async createRule(rule: Omit<TaxRule, 'id'>): Promise<TaxRule> {
    try {
      const id = `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = Math.floor(Date.now() / 1000);

      const result: TaxRule = {
        id,
        ...rule,
      };

      await db.query(
        `INSERT INTO tax_rules (id, corridor, jurisdiction, tax_rate, tax_type, applicable_from, applicable_to, conditions, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          rule.corridor,
          rule.jurisdiction,
          rule.taxRate,
          rule.taxType,
          rule.applicableFrom,
          rule.applicableTo || null,
          JSON.stringify(rule.conditions || {}),
          rule.active,
        ]
      );

      logger.info(`Tax rule created: ${id}`, { corridor: rule.corridor, jurisdiction: rule.jurisdiction });
      return result;
    } catch (error) {
      logger.error('Failed to create tax rule', error);
      throw error;
    }
  }

  async getRulesByJurisdiction(jurisdiction: string): Promise<TaxRule[]> {
    try {
      const result = await db.query(
        `SELECT * FROM tax_rules WHERE jurisdiction = $1 AND active = true ORDER BY applicable_from DESC`,
        [jurisdiction]
      );

      return (result.rows || []).map((row: any) => ({
        id: row.id,
        corridor: row.corridor,
        jurisdiction: row.jurisdiction,
        taxRate: row.tax_rate,
        taxType: row.tax_type,
        applicableFrom: row.applicable_from,
        applicableTo: row.applicable_to,
        conditions: JSON.parse(row.conditions || '{}'),
        active: row.active,
      }));
    } catch (error) {
      logger.error('Failed to get rules by jurisdiction', error);
      throw error;
    }
  }

  async getRulesByCorridor(corridor: string): Promise<TaxRule[]> {
    try {
      const result = await db.query(
        `SELECT * FROM tax_rules WHERE corridor = $1 AND active = true ORDER BY applicable_from DESC`,
        [corridor]
      );

      return (result.rows || []).map((row: any) => ({
        id: row.id,
        corridor: row.corridor,
        jurisdiction: row.jurisdiction,
        taxRate: row.tax_rate,
        taxType: row.tax_type,
        applicableFrom: row.applicable_from,
        applicableTo: row.applicable_to,
        conditions: JSON.parse(row.conditions || '{}'),
        active: row.active,
      }));
    } catch (error) {
      logger.error('Failed to get rules by corridor', error);
      throw error;
    }
  }

  async calculateTax(
    amount: number,
    corridor: string,
    jurisdiction: string,
    transactionType: 'income' | 'sales' | 'capital_gains' | 'vat'
  ): Promise<TaxCalculation> {
    try {
      const now = Math.floor(Date.now() / 1000);

      const result = await db.query(
        `SELECT * FROM tax_rules
         WHERE (corridor = $1 OR corridor = 'global')
         AND jurisdiction = $2
         AND tax_type = $3
         AND applicable_from <= $4
         AND (applicable_to IS NULL OR applicable_to >= $4)
         AND active = true
         ORDER BY applicable_from DESC
         LIMIT 1`,
        [corridor, jurisdiction, transactionType, now]
      );

      const rows = result.rows || [];
      let totalTaxRate = 0;
      const applicableRules: TaxRule[] = [];

      for (const row of rows) {
        const rule: TaxRule = {
          id: row.id,
          corridor: row.corridor,
          jurisdiction: row.jurisdiction,
          taxRate: row.tax_rate,
          taxType: row.tax_type,
          applicableFrom: row.applicable_from,
          applicableTo: row.applicable_to,
          conditions: JSON.parse(row.conditions || '{}'),
          active: row.active,
        };
        applicableRules.push(rule);
        totalTaxRate += rule.taxRate;
      }

      const taxAmount = (amount * totalTaxRate) / 100;
      const netAmount = amount - taxAmount;

      return {
        grossAmount: amount,
        taxAmount: Math.round(taxAmount * 100) / 100,
        netAmount: Math.round(netAmount * 100) / 100,
        taxRate: totalTaxRate,
        applicableRules,
      };
    } catch (error) {
      logger.error('Failed to calculate tax', error);
      throw error;
    }
  }

  async updateRule(ruleId: string, updates: Partial<TaxRule>): Promise<TaxRule> {
    try {
      const fields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.taxRate !== undefined) {
        fields.push(`tax_rate = $${paramIndex++}`);
        values.push(updates.taxRate);
      }

      if (updates.conditions !== undefined) {
        fields.push(`conditions = $${paramIndex++}`);
        values.push(JSON.stringify(updates.conditions));
      }

      if (updates.active !== undefined) {
        fields.push(`active = $${paramIndex++}`);
        values.push(updates.active);
      }

      if (updates.applicableTo !== undefined) {
        fields.push(`applicable_to = $${paramIndex++}`);
        values.push(updates.applicableTo);
      }

      if (fields.length === 0) {
        throw new Error('No updates provided');
      }

      values.push(ruleId);

      await db.query(
        `UPDATE tax_rules SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
        values
      );

      logger.info(`Tax rule updated: ${ruleId}`);

      const result = await db.query('SELECT * FROM tax_rules WHERE id = $1', [ruleId]);
      const row = result.rows?.[0];

      return {
        id: row.id,
        corridor: row.corridor,
        jurisdiction: row.jurisdiction,
        taxRate: row.tax_rate,
        taxType: row.tax_type,
        applicableFrom: row.applicable_from,
        applicableTo: row.applicable_to,
        conditions: JSON.parse(row.conditions || '{}'),
        active: row.active,
      };
    } catch (error) {
      logger.error('Failed to update tax rule', error);
      throw error;
    }
  }

  async deactivateRule(ruleId: string): Promise<void> {
    try {
      await db.query('UPDATE tax_rules SET active = false WHERE id = $1', [ruleId]);
      logger.info(`Tax rule deactivated: ${ruleId}`);
    } catch (error) {
      logger.error('Failed to deactivate tax rule', error);
      throw error;
    }
  }

  async getApplicableRules(corridor: string, jurisdiction: string): Promise<TaxRule[]> {
    try {
      const now = Math.floor(Date.now() / 1000);

      const result = await db.query(
        `SELECT * FROM tax_rules
         WHERE (corridor = $1 OR corridor = 'global')
         AND jurisdiction = $2
         AND applicable_from <= $3
         AND (applicable_to IS NULL OR applicable_to >= $3)
         AND active = true
         ORDER BY tax_type, applicable_from DESC`,
        [corridor, jurisdiction, now]
      );

      return (result.rows || []).map((row: any) => ({
        id: row.id,
        corridor: row.corridor,
        jurisdiction: row.jurisdiction,
        taxRate: row.tax_rate,
        taxType: row.tax_type,
        applicableFrom: row.applicable_from,
        applicableTo: row.applicable_to,
        conditions: JSON.parse(row.conditions || '{}'),
        active: row.active,
      }));
    } catch (error) {
      logger.error('Failed to get applicable rules', error);
      throw error;
    }
  }
}

export const taxRulesEngine = new TaxRulesEngine();
