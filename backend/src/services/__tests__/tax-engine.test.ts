import { beforeEach, describe, expect, it } from 'vitest';
import { TaxRuleEngine } from '../tax/tax-engine.js';

// These tests run without DATABASE_URL set, exercising the in-memory
// fallback path (usePrisma() === false).
describe('TaxRuleEngine', () => {
  let engine: TaxRuleEngine;

  beforeEach(() => {
    engine = new TaxRuleEngine();
    engine.resetForTests();
  });

  describe('rule CRUD', () => {
    it('creates a rule and finds it via listRules', async () => {
      const created = await engine.createRule({
        jurisdiction: 'gb',
        name: 'UK VAT standard rate',
        ruleType: 'vat',
        rate: 0.2,
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.jurisdiction).toBe('GB');

      const listed = await engine.listRules({ jurisdiction: 'GB' });
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      expect(listed.value).toHaveLength(1);
    });

    it('rejects an out-of-range rate', async () => {
      const result = await engine.createRule({
        jurisdiction: 'GB',
        name: 'Bad rule',
        ruleType: 'vat',
        rate: 1.5,
      });
      expect(result.ok).toBe(false);
    });

    it('deactivates a rule', async () => {
      const created = await engine.createRule({
        jurisdiction: 'US',
        name: 'CA sales tax',
        ruleType: 'sales_tax',
        rate: 0.0725,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const deactivated = await engine.deactivateRule(created.value.id);
      expect(deactivated.ok).toBe(true);
      if (!deactivated.ok) return;
      expect(deactivated.value.active).toBe(false);

      const activeOnly = await engine.listRules({ jurisdiction: 'US', activeOnly: true });
      expect(activeOnly.ok).toBe(true);
      if (!activeOnly.ok) return;
      expect(activeOnly.value).toHaveLength(0);
    });
  });

  describe('calculate', () => {
    it('applies the active rate for a jurisdiction', async () => {
      await engine.createRule({
        jurisdiction: 'DE',
        name: 'Germany VAT',
        ruleType: 'vat',
        rate: 0.19,
        effectiveFrom: new Date('2023-01-01T00:00:00Z'),
      });

      const result = await engine.calculate({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'DE',
        amount: 100,
        currency: 'EUR',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.rate).toBe(0.19);
      expect(result.value.taxAmount).toBe(19);
      expect(result.value.totalAmount).toBe(119);
      expect(result.value.exempt).toBe(false);
      expect(result.value.ruleFound).toBe(true);
    });

    it('returns zero tax when no rule is found for the jurisdiction', async () => {
      const result = await engine.calculate({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'ZZ',
        amount: 500,
        currency: 'USD',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.taxAmount).toBe(0);
      expect(result.value.ruleFound).toBe(false);
      expect(result.value.exempt).toBe(false);
    });

    it('only applies a rule within its effective window', async () => {
      await engine.createRule({
        jurisdiction: 'FR',
        name: 'Old rate',
        ruleType: 'vat',
        rate: 0.196,
        effectiveFrom: new Date('2010-01-01T00:00:00Z'),
        effectiveTo: new Date('2014-01-01T00:00:00Z'),
      });
      await engine.createRule({
        jurisdiction: 'FR',
        name: 'Current rate',
        ruleType: 'vat',
        rate: 0.2,
        effectiveFrom: new Date('2014-01-01T00:00:00Z'),
      });

      const historical = await engine.calculate({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'FR',
        amount: 100,
        currency: 'EUR',
        at: new Date('2012-06-01T00:00:00Z'),
      });
      const current = await engine.calculate({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'FR',
        amount: 100,
        currency: 'EUR',
        at: new Date('2020-06-01T00:00:00Z'),
      });

      expect(historical.ok && historical.value.rate).toBe(0.196);
      expect(current.ok && current.value.rate).toBe(0.2);
    });

    it('zeroes tax for an active exemption', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'CA sales tax',
        ruleType: 'sales_tax',
        rate: 0.0725,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      });
      await engine.createExemption({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        reason: 'Non-profit exemption certificate',
        validFrom: new Date('2024-01-01T00:00:00Z'),
      });

      const result = await engine.calculate({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        amount: 1000,
        currency: 'USD',
        at: new Date('2025-01-01T00:00:00Z'),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.exempt).toBe(true);
      expect(result.value.taxAmount).toBe(0);
      expect(result.value.exemptionId).not.toBeNull();
    });

    it('does not apply an expired exemption', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'CA sales tax',
        ruleType: 'sales_tax',
        rate: 0.0725,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      });
      await engine.createExemption({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        reason: 'Temporary exemption',
        validFrom: new Date('2020-01-01T00:00:00Z'),
        validTo: new Date('2022-01-01T00:00:00Z'),
      });

      const result = await engine.calculate({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        amount: 1000,
        currency: 'USD',
        at: new Date('2025-01-01T00:00:00Z'),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.exempt).toBe(false);
      expect(result.value.taxAmount).toBeCloseTo(72.5);
    });

    it('does not apply tax below the appliesAbove threshold', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'Small-value threshold rule',
        ruleType: 'sales_tax',
        rate: 0.08,
        appliesAbove: 50,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      });

      const below = await engine.calculate({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        amount: 20,
        currency: 'USD',
      });
      const above = await engine.calculate({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        amount: 100,
        currency: 'USD',
      });

      expect(below.ok && below.value.taxAmount).toBe(0);
      expect(above.ok && above.value.taxAmount).toBe(8);
    });
  });

  describe('compliance checks', () => {
    it('flags a jurisdiction with recorded transactions but no active rule', async () => {
      await engine.calculate({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'JP',
        amount: 100,
        currency: 'JPY',
      });

      const result = await engine.checkCompliance({ tenantId: 't_1', merchantId: 'm_1' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.findings.some((f) => f.code === 'NO_ACTIVE_RULE' && f.jurisdiction === 'JP')).toBe(true);
    });

    it('flags an exemption that is still active past its validTo date', async () => {
      const exemption = await engine.createExemption({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        reason: 'Expired cert',
        validFrom: new Date('2020-01-01T00:00:00Z'),
        validTo: new Date('2021-01-01T00:00:00Z'),
      });
      expect(exemption.ok).toBe(true);

      const result = await engine.checkCompliance({ tenantId: 't_1', merchantId: 'm_1', jurisdiction: 'US' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.findings.some((f) => f.code === 'EXPIRED_EXEMPTION_ACTIVE')).toBe(true);
      expect(result.value.compliant).toBe(false);
    });

    it('flags rules with overlapping effective windows', async () => {
      await engine.createRule({
        jurisdiction: 'IT',
        name: 'Rule A',
        ruleType: 'vat',
        rate: 0.22,
        effectiveFrom: new Date('2023-01-01T00:00:00Z'),
        effectiveTo: new Date('2025-01-01T00:00:00Z'),
      });
      await engine.createRule({
        jurisdiction: 'IT',
        name: 'Rule B (overlaps)',
        ruleType: 'vat',
        rate: 0.21,
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      });

      const result = await engine.checkCompliance({ tenantId: 't_1', merchantId: 'm_1', jurisdiction: 'IT' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.findings.some((f) => f.code === 'OVERLAPPING_RULE_WINDOWS')).toBe(true);
      expect(result.value.compliant).toBe(false);
    });

    it('is compliant when there are no findings', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'CA sales tax',
        ruleType: 'sales_tax',
        rate: 0.0725,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      });
      await engine.calculate({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        amount: 100,
        currency: 'USD',
      });

      const result = await engine.checkCompliance({ tenantId: 't_1', merchantId: 'm_1', jurisdiction: 'US' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.compliant).toBe(true);
    });
  });

  describe('audit trail', () => {
    it('records a calculation and returns it via getAuditTrail', async () => {
      await engine.createRule({
        jurisdiction: 'US',
        name: 'CA sales tax',
        ruleType: 'sales_tax',
        rate: 0.0725,
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      });
      await engine.calculate({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        amount: 100,
        currency: 'USD',
        paymentId: 'pay_123',
      });

      const trail = await engine.getAuditTrail({ tenantId: 't_1' });
      expect(trail.ok).toBe(true);
      if (!trail.ok) return;
      expect(trail.value.total).toBe(1);
      expect(trail.value.entries[0].paymentId).toBe('pay_123');
      expect(trail.value.entries[0].taxAmount).toBeCloseTo(7.25);
    });

    it('filters the audit trail by jurisdiction and tenant', async () => {
      await engine.calculate({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        amount: 100,
        currency: 'USD',
      });
      await engine.calculate({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'GB',
        amount: 100,
        currency: 'GBP',
      });
      await engine.calculate({
        tenantId: 't_2',
        merchantId: 'm_2',
        jurisdiction: 'US',
        amount: 100,
        currency: 'USD',
      });

      const usOnly = await engine.getAuditTrail({ tenantId: 't_1', jurisdiction: 'US' });
      expect(usOnly.ok).toBe(true);
      if (!usOnly.ok) return;
      expect(usOnly.value.total).toBe(1);
      expect(usOnly.value.entries[0].jurisdiction).toBe('US');

      const allForTenant1 = await engine.getAuditTrail({ tenantId: 't_1' });
      expect(allForTenant1.ok && allForTenant1.value.total).toBe(2);

      const tenant2 = await engine.getAuditTrail({ tenantId: 't_2' });
      expect(tenant2.ok && tenant2.value.total).toBe(1);
    });

    it('paginates results with limit/offset', async () => {
      for (let i = 0; i < 5; i++) {
        await engine.calculate({
          tenantId: 't_1',
          merchantId: 'm_1',
          jurisdiction: 'US',
          amount: 10,
          currency: 'USD',
        });
      }

      const page1 = await engine.getAuditTrail({ tenantId: 't_1', limit: 2, offset: 0 });
      const page2 = await engine.getAuditTrail({ tenantId: 't_1', limit: 2, offset: 2 });
      expect(page1.ok && page1.value.entries).toHaveLength(2);
      expect(page1.ok && page1.value.total).toBe(5);
      expect(page2.ok && page2.value.entries).toHaveLength(2);
    });
  });

  describe('exemptions', () => {
    it('revokes an exemption', async () => {
      const created = await engine.createExemption({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        reason: 'Test',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const revoked = await engine.revokeExemption(created.value.id);
      expect(revoked.ok).toBe(true);
      if (!revoked.ok) return;
      expect(revoked.value.active).toBe(false);

      const activeOnly = await engine.listExemptions({ tenantId: 't_1', merchantId: 'm_1', activeOnly: true });
      expect(activeOnly.ok && activeOnly.value).toHaveLength(0);
    });

    it('returns not found for revoking an unknown exemption', async () => {
      const result = await engine.revokeExemption('does-not-exist');
      expect(result.ok).toBe(false);
    });
  });
});
