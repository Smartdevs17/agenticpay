// fx-service.test.ts — Issue #626
// Runs against the in-memory fallback path (no DATABASE_URL set), matching
// how this repo's test suite runs by default.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FxService } from '../fx/fx-service.js';

describe('FxService', () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  describe('rate caching / TTL', () => {
    it('fetches once and reuses the cached rate within the TTL window', async () => {
      const fetchRate = vi.fn().mockResolvedValue(1.1);
      const service = new FxService({ ttlMs: 60_000, fetchRate });

      const first = await service.getRate('USD', 'EUR');
      const second = await service.getRate('USD', 'EUR');

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(first.value.rate).toBe(1.1);
        expect(second.value.id).toBe(first.value.id);
      }
      expect(fetchRate).toHaveBeenCalledTimes(1);
    });

    it('re-fetches once the cached rate has expired', async () => {
      const fetchRate = vi.fn().mockResolvedValueOnce(1.1).mockResolvedValueOnce(1.2);
      const service = new FxService({ ttlMs: 10, fetchRate });

      const first = await service.getRate('USD', 'EUR');
      await new Promise((resolve) => setTimeout(resolve, 25));
      const second = await service.getRate('USD', 'EUR');

      expect(fetchRate).toHaveBeenCalledTimes(2);
      if (first.ok && second.ok) {
        expect(first.value.rate).toBe(1.1);
        expect(second.value.rate).toBe(1.2);
      }
    });

    it('returns an identity rate of 1 for same-currency pairs without fetching', async () => {
      const fetchRate = vi.fn().mockResolvedValue(999);
      const service = new FxService({ fetchRate });

      const result = await service.getRate('usd', 'USD');

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.rate).toBe(1);
      expect(fetchRate).not.toHaveBeenCalled();
    });

    it('rejects an invalid fetched rate', async () => {
      const service = new FxService({ fetchRate: vi.fn().mockResolvedValue(-5) });
      const result = await service.getRate('USD', 'EUR');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('convert', () => {
    it('computes converted amount using the cached rate', async () => {
      const service = new FxService({ fetchRate: vi.fn().mockResolvedValue(2) });
      const result = await service.convert(50, 'USD', 'XLM');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.convertedAmount).toBe(100);
        expect(result.value.rate).toBe(2);
        expect(result.value.baseCurrency).toBe('USD');
        expect(result.value.quoteCurrency).toBe('XLM');
      }
    });

    it('rejects a negative amount', async () => {
      const service = new FxService({ fetchRate: vi.fn().mockResolvedValue(2) });
      const result = await service.convert(-10, 'USD', 'EUR');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('history', () => {
    it('returns rows for a pair ordered oldest-first', async () => {
      let rate = 1;
      const service = new FxService({ ttlMs: 1, fetchRate: vi.fn(async () => rate++) });

      await service.getRate('USD', 'EUR');
      await new Promise((resolve) => setTimeout(resolve, 5));
      await service.getRate('USD', 'EUR');
      await new Promise((resolve) => setTimeout(resolve, 5));
      await service.getRate('USD', 'EUR');

      const history = await service.getHistory('USD', 'EUR');
      expect(history.ok).toBe(true);
      if (history.ok) {
        expect(history.value.length).toBe(3);
        expect(history.value.map((r) => r.rate)).toEqual([1, 2, 3]);
        for (let i = 1; i < history.value.length; i++) {
          expect(history.value[i].fetchedAt.getTime()).toBeGreaterThanOrEqual(
            history.value[i - 1].fetchedAt.getTime(),
          );
        }
      }
    });

    it('filters by since/until', async () => {
      let rate = 1;
      const service = new FxService({ ttlMs: 1, fetchRate: vi.fn(async () => rate++) });

      await service.getRate('USD', 'GBP');
      await new Promise((resolve) => setTimeout(resolve, 5));
      const cutoff = new Date();
      await new Promise((resolve) => setTimeout(resolve, 5));
      await service.getRate('USD', 'GBP');

      const history = await service.getHistory('USD', 'GBP', { since: cutoff });
      expect(history.ok).toBe(true);
      if (history.ok) {
        expect(history.value.length).toBe(1);
        expect(history.value[0].rate).toBe(2);
      }
    });

    it('does not mix history across different pairs', async () => {
      const service = new FxService({ fetchRate: vi.fn().mockResolvedValue(1.5) });
      await service.getRate('USD', 'EUR');
      await service.getRate('USD', 'GBP');

      const history = await service.getHistory('USD', 'EUR');
      expect(history.ok).toBe(true);
      if (history.ok) expect(history.value).toHaveLength(1);
    });
  });

  describe('alerts', () => {
    it('creates, lists, and deactivates an alert', async () => {
      const service = new FxService({ fetchRate: vi.fn().mockResolvedValue(1) });

      const created = await service.createAlert({
        tenantId: 'tenant-1',
        baseCurrency: 'usd',
        quoteCurrency: 'eur',
        thresholdPct: 5,
        direction: 'both',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.baseCurrency).toBe('USD');
      expect(created.value.active).toBe(true);

      const listed = await service.listAlerts({ tenantId: 'tenant-1' });
      expect(listed.ok).toBe(true);
      if (listed.ok) expect(listed.value).toHaveLength(1);

      const deactivated = await service.deactivateAlert(created.value.id);
      expect(deactivated.ok).toBe(true);
      if (deactivated.ok) expect(deactivated.value.active).toBe(false);

      const activeOnly = await service.listAlerts({ tenantId: 'tenant-1', activeOnly: true });
      expect(activeOnly.ok).toBe(true);
      if (activeOnly.ok) expect(activeOnly.value).toHaveLength(0);
    });

    it('rejects an alert with a non-positive threshold', async () => {
      const service = new FxService();
      const result = await service.createAlert({
        tenantId: 'tenant-1',
        baseCurrency: 'USD',
        quoteCurrency: 'EUR',
        thresholdPct: 0,
      });
      expect(result.ok).toBe(false);
    });

    it('returns not-found when deactivating an unknown alert', async () => {
      const service = new FxService();
      const result = await service.deactivateAlert('does-not-exist');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    });

    it('triggers a "both" direction alert when the rate moves up past the threshold', async () => {
      const service = new FxService({ fetchRate: vi.fn().mockResolvedValue(1) });
      await service.getRate('USD', 'EUR'); // seeds baseline rate = 1

      await service.createAlert({
        tenantId: 't1',
        baseCurrency: 'USD',
        quoteCurrency: 'EUR',
        thresholdPct: 5,
        direction: 'both',
      });

      const triggered = await service.checkAlerts('USD', 'EUR', 1.1); // +10%
      expect(triggered.ok).toBe(true);
      if (triggered.ok) {
        expect(triggered.value).toHaveLength(1);
        expect(triggered.value[0].lastTriggeredRate).toBe(1.1);
        expect(triggered.value[0].lastTriggeredAt).not.toBeNull();
      }
    });

    it('triggers a "both" direction alert when the rate moves down past the threshold', async () => {
      const service = new FxService({ fetchRate: vi.fn().mockResolvedValue(1) });
      await service.getRate('USD', 'EUR');

      await service.createAlert({
        tenantId: 't1',
        baseCurrency: 'USD',
        quoteCurrency: 'EUR',
        thresholdPct: 5,
        direction: 'both',
      });

      const triggered = await service.checkAlerts('USD', 'EUR', 0.9); // -10%
      expect(triggered.ok).toBe(true);
      if (triggered.ok) expect(triggered.value).toHaveLength(1);
    });

    it('does not trigger when movement is under the threshold', async () => {
      const service = new FxService({ fetchRate: vi.fn().mockResolvedValue(1) });
      await service.getRate('USD', 'EUR');

      await service.createAlert({
        tenantId: 't1',
        baseCurrency: 'USD',
        quoteCurrency: 'EUR',
        thresholdPct: 5,
        direction: 'both',
      });

      const triggered = await service.checkAlerts('USD', 'EUR', 1.02); // +2%
      expect(triggered.ok).toBe(true);
      if (triggered.ok) expect(triggered.value).toHaveLength(0);
    });

    it('respects direction: an "up"-only alert does not trigger on a downward move', async () => {
      const service = new FxService({ fetchRate: vi.fn().mockResolvedValue(1) });
      await service.getRate('USD', 'EUR');

      await service.createAlert({
        tenantId: 't1',
        baseCurrency: 'USD',
        quoteCurrency: 'EUR',
        thresholdPct: 5,
        direction: 'up',
      });

      const downMove = await service.checkAlerts('USD', 'EUR', 0.9);
      expect(downMove.ok).toBe(true);
      if (downMove.ok) expect(downMove.value).toHaveLength(0);

      const upMove = await service.checkAlerts('USD', 'EUR', 1.1);
      expect(upMove.ok).toBe(true);
      if (upMove.ok) expect(upMove.value).toHaveLength(1);
    });

    it('respects direction: a "down"-only alert does not trigger on an upward move', async () => {
      const service = new FxService({ fetchRate: vi.fn().mockResolvedValue(1) });
      await service.getRate('USD', 'EUR');

      await service.createAlert({
        tenantId: 't1',
        baseCurrency: 'USD',
        quoteCurrency: 'EUR',
        thresholdPct: 5,
        direction: 'down',
      });

      const upMove = await service.checkAlerts('USD', 'EUR', 1.1);
      expect(upMove.ok).toBe(true);
      if (upMove.ok) expect(upMove.value).toHaveLength(0);

      const downMove = await service.checkAlerts('USD', 'EUR', 0.9);
      expect(downMove.ok).toBe(true);
      if (downMove.ok) expect(downMove.value).toHaveLength(1);
    });

    it('does not trigger an inactive alert', async () => {
      const service = new FxService({ fetchRate: vi.fn().mockResolvedValue(1) });
      await service.getRate('USD', 'EUR');

      const created = await service.createAlert({
        tenantId: 't1',
        baseCurrency: 'USD',
        quoteCurrency: 'EUR',
        thresholdPct: 5,
        direction: 'both',
      });
      if (created.ok) await service.deactivateAlert(created.value.id);

      const triggered = await service.checkAlerts('USD', 'EUR', 2);
      expect(triggered.ok).toBe(true);
      if (triggered.ok) expect(triggered.value).toHaveLength(0);
    });

    it('automatically evaluates alerts as part of getRate on a fresh fetch', async () => {
      let rate = 1;
      const service = new FxService({ ttlMs: 1, fetchRate: vi.fn(async () => rate) });

      await service.getRate('USD', 'EUR'); // seeds rate = 1
      await service.createAlert({
        tenantId: 't1',
        baseCurrency: 'USD',
        quoteCurrency: 'EUR',
        thresholdPct: 5,
        direction: 'both',
      });

      rate = 1.2; // +20% for the next fetch
      await new Promise((resolve) => setTimeout(resolve, 5)); // let TTL expire
      await service.getRate('USD', 'EUR');

      const alerts = await service.listAlerts({ tenantId: 't1' });
      expect(alerts.ok).toBe(true);
      if (alerts.ok) {
        expect(alerts.value[0].lastTriggeredAt).not.toBeNull();
        expect(alerts.value[0].lastTriggeredRate).toBe(1.2);
      }
    });
  });

  describe('resetForTests', () => {
    it('clears in-memory rates and alerts', async () => {
      const service = new FxService({ fetchRate: vi.fn().mockResolvedValue(1.5) });
      await service.getRate('USD', 'EUR');
      await service.createAlert({ tenantId: 't1', baseCurrency: 'USD', quoteCurrency: 'EUR', thresholdPct: 5 });

      service.resetForTests();

      const history = await service.getHistory('USD', 'EUR');
      const alerts = await service.listAlerts({});
      if (history.ok) expect(history.value).toHaveLength(0);
      if (alerts.ok) expect(alerts.value).toHaveLength(0);
    });
  });
});
