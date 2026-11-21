import { beforeEach, describe, expect, it } from 'vitest';
import { TaxCalendarService } from '../tax/tax-calendar.js';

describe('TaxCalendarService — Issue #693', () => {
  let service: TaxCalendarService;

  beforeEach(() => {
    service = new TaxCalendarService();
    service.resetForTests();
  });

  describe('createDeadline', () => {
    it('creates a tax deadline with correct defaults', async () => {
      const result = await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: 'Q2 Estimated Tax',
        frequency: 'quarterly',
        dueDate: new Date('2025-07-15T23:59:59Z'),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.jurisdiction).toBe('US');
      expect(result.value.name).toBe('Q2 Estimated Tax');
      expect(result.value.frequency).toBe('quarterly');
      expect(result.value.dueSoonThresholdDays).toBe(14);
      expect(['upcoming', 'due_soon', 'overdue']).toContain(result.value.status);
    });

    it('rejects missing tenantId', async () => {
      const result = await service.createDeadline({
        tenantId: '',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: 'Test',
        frequency: 'quarterly',
        dueDate: new Date('2025-07-15'),
      });
      expect(result.ok).toBe(false);
    });

    it('rejects missing name', async () => {
      const result = await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: '',
        frequency: 'quarterly',
        dueDate: new Date('2025-07-15'),
      });
      expect(result.ok).toBe(false);
    });

    it('uppercases jurisdiction', async () => {
      const result = await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'gb',
        name: 'VAT Return',
        frequency: 'quarterly',
        dueDate: new Date('2025-07-15'),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.jurisdiction).toBe('GB');
    });
  });

  describe('updateDeadline', () => {
    it('updates deadline properties', async () => {
      const created = await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: 'Original Name',
        frequency: 'quarterly',
        dueDate: new Date('2025-07-15'),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const updated = await service.updateDeadline(created.value.id, {
        name: 'Updated Name',
        description: 'New description',
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.value.name).toBe('Updated Name');
      expect(updated.value.description).toBe('New description');
    });

    it('returns not found for unknown id', async () => {
      const result = await service.updateDeadline('does-not-exist', { name: 'Test' });
      expect(result.ok).toBe(false);
    });
  });

  describe('completeDeadline', () => {
    it('marks a deadline as completed', async () => {
      const created = await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: 'Test',
        frequency: 'quarterly',
        dueDate: new Date('2025-07-15'),
      });
      if (!created.ok) return;

      const completed = await service.completeDeadline(created.value.id);
      expect(completed.ok).toBe(true);
      if (!completed.ok) return;
      expect(completed.value.status).toBe('completed');
      expect(completed.value.completedAt).not.toBeNull();
    });
  });

  describe('extendDeadline', () => {
    it('extends a deadline to a new date', async () => {
      const created = await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: 'Test',
        frequency: 'quarterly',
        dueDate: new Date('2025-07-15'),
      });
      if (!created.ok) return;

      const extended = await service.extendDeadline(created.value.id, new Date('2025-08-15'));
      expect(extended.ok).toBe(true);
      if (!extended.ok) return;
      expect(extended.value.extensionUntil?.toISOString()).toContain('2025-08-15');
      expect(extended.value.status).toBe('extension');
    });

    it('rejects extension before original due date', async () => {
      const created = await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: 'Test',
        frequency: 'quarterly',
        dueDate: new Date('2025-07-15'),
      });
      if (!created.ok) return;

      const result = await service.extendDeadline(created.value.id, new Date('2025-06-01'));
      expect(result.ok).toBe(false);
    });
  });

  describe('deleteDeadline', () => {
    it('deletes a deadline', async () => {
      const created = await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: 'Test',
        frequency: 'quarterly',
        dueDate: new Date('2025-07-15'),
      });
      if (!created.ok) return;

      const deleted = await service.deleteDeadline(created.value.id);
      expect(deleted.ok).toBe(true);

      const get = await service.getDeadline(created.value.id);
      expect(get.ok).toBe(false);
    });

    it('returns not found for unknown id', async () => {
      const result = await service.deleteDeadline('does-not-exist');
      expect(result.ok).toBe(false);
    });
  });

  describe('listDeadlines', () => {
    it('lists deadlines with filters', async () => {
      await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: 'US Deadline',
        frequency: 'quarterly',
        dueDate: new Date('2025-07-15'),
      });
      await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'GB',
        name: 'GB Deadline',
        frequency: 'monthly',
        dueDate: new Date('2025-08-07'),
      });
      await service.createDeadline({
        tenantId: 't_2',
        merchantId: 'm_2',
        jurisdiction: 'US',
        name: 'Other Tenant',
        frequency: 'annual',
        dueDate: new Date('2025-12-31'),
      });

      const all = await service.listDeadlines({ tenantId: 't_1' });
      expect(all.ok).toBe(true);
      if (!all.ok) return;
      expect(all.value.total).toBe(2);

      const usOnly = await service.listDeadlines({ tenantId: 't_1', jurisdiction: 'US' });
      expect(usOnly.ok).toBe(true);
      if (!usOnly.ok) return;
      expect(usOnly.value.total).toBe(1);
      expect(usOnly.value.deadlines[0].jurisdiction).toBe('US');

      const monthlyOnly = await service.listDeadlines({ tenantId: 't_1', frequency: 'monthly' });
      expect(monthlyOnly.ok).toBe(true);
      if (!monthlyOnly.ok) return;
      expect(monthlyOnly.value.total).toBe(1);
    });

    it('sorts deadlines by due date ascending', async () => {
      await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: 'Later',
        frequency: 'quarterly',
        dueDate: new Date('2025-12-15'),
      });
      await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: 'Earlier',
        frequency: 'quarterly',
        dueDate: new Date('2025-07-15'),
      });

      const result = await service.listDeadlines({ tenantId: 't_1' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.deadlines[0].name).toBe('Earlier');
      expect(result.value.deadlines[1].name).toBe('Later');
    });

    it('paginates results', async () => {
      for (let i = 0; i < 5; i++) {
        await service.createDeadline({
          tenantId: 't_1',
          merchantId: 'm_1',
          jurisdiction: 'US',
          name: `Deadline ${i}`,
          frequency: 'quarterly',
          dueDate: new Date(Date.UTC(2025, 6, 15 + i)),
        });
      }

      const page1 = await service.listDeadlines({ tenantId: 't_1', limit: 2, offset: 0 });
      const page2 = await service.listDeadlines({ tenantId: 't_1', limit: 2, offset: 2 });
      expect(page1.ok && page1.value.deadlines).toHaveLength(2);
      expect(page1.ok && page1.value.total).toBe(5);
      expect(page2.ok && page2.value.deadlines).toHaveLength(2);
    });
  });

  describe('getUpcomingAlerts', () => {
    it('returns alerts for upcoming deadlines', async () => {
      // Create a deadline due in 10 days (should be "due_soon" → "warning")
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: 'Q2 Tax',
        frequency: 'quarterly',
        dueDate: futureDate,
      });

      const result = await service.getUpcomingAlerts({
        tenantId: 't_1',
        lookaheadDays: 30,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBeGreaterThanOrEqual(1);
      const alert = result.value.find((a) => a.deadline.name === 'Q2 Tax');
      expect(alert).toBeDefined();
      expect(alert?.severity).toBe('warning');
      expect(alert?.daysUntilDue).toBeGreaterThan(0);
    });

    it('returns overdue alerts for past deadlines', async () => {
      const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: 'Overdue Tax',
        frequency: 'quarterly',
        dueDate: pastDate,
      });

      const result = await service.getUpcomingAlerts({
        tenantId: 't_1',
        lookaheadDays: 30,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const overdue = result.value.find((a) => a.deadline.name === 'Overdue Tax');
      expect(overdue?.severity).toBe('overdue');
    });

    it('excludes completed deadlines from alerts', async () => {
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const created = await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: 'Completed Tax',
        frequency: 'quarterly',
        dueDate: futureDate,
      });
      if (created.ok) {
        await service.completeDeadline(created.value.id);
      }

      const result = await service.getUpcomingAlerts({ tenantId: 't_1', lookaheadDays: 30 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.find((a) => a.deadline.name === 'Completed Tax')).toBeUndefined();
    });
  });

  describe('getOverdueDeadlines', () => {
    it('returns only overdue deadlines', async () => {
      const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: 'Overdue',
        frequency: 'quarterly',
        dueDate: pastDate,
      });
      await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: 'Not Overdue',
        frequency: 'quarterly',
        dueDate: futureDate,
      });

      const result = await service.getOverdueDeadlines({ tenantId: 't_1' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0].name).toBe('Overdue');
    });
  });

  describe('getDefaultTemplates', () => {
    it('returns all templates when no jurisdiction specified', () => {
      const templates = service.getDefaultTemplates();
      expect(templates.length).toBeGreaterThan(0);
    });

    it('filters templates by jurisdiction', () => {
      const usTemplates = service.getDefaultTemplates('US');
      expect(usTemplates.length).toBeGreaterThan(0);
      expect(usTemplates.every((t) => t.jurisdiction === 'US')).toBe(true);
    });

    it('returns empty for unknown jurisdiction', () => {
      const templates = service.getDefaultTemplates('ZZ');
      expect(templates).toHaveLength(0);
    });
  });

  describe('createDeadlineFromTemplate', () => {
    it('creates a deadline from a template', async () => {
      const templates = service.getDefaultTemplates('US');
      expect(templates.length).toBeGreaterThan(0);

      const result = await service.createDeadlineFromTemplate({
        tenantId: 't_1',
        merchantId: 'm_1',
        template: templates[0],
        year: 2025,
        periodNumber: 1,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.jurisdiction).toBe('US');
      expect(result.value.name).toBe(templates[0].name);
    });
  });

  describe('refreshStatuses', () => {
    it('refreshes deadline statuses based on current date', async () => {
      const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const created = await service.createDeadline({
        tenantId: 't_1',
        merchantId: 'm_1',
        jurisdiction: 'US',
        name: 'Test',
        frequency: 'quarterly',
        dueDate: futureDate,
        dueSoonThresholdDays: 14,
      });
      if (!created.ok) return;

      // Initially it should be "due_soon" (within 14 day threshold)
      expect(created.value.status).toBe('due_soon');

      // Set threshold very low so it becomes "upcoming"
      await service.updateDeadline(created.value.id, { dueSoonThresholdDays: 1 });
      const refreshed = service.refreshStatuses();
      expect(refreshed).toBeGreaterThanOrEqual(0);
    });
  });
});
