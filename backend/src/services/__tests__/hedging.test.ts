import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HedgingService } from '../hedging.js';

function makeService() {
  return new HedgingService();
}

// Patch the module-level fetchLiveRate via vi.mock so we control rates
vi.mock('../hedging.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../hedging.js')>();
  return mod;
});

describe('HedgingService', () => {
  let svc: ReturnType<typeof makeService>;

  beforeEach(() => {
    svc = makeService();
  });

  // ── Rate monitoring ────────────────────────────────────────────────────────

  describe('getRate', () => {
    it('returns a rate snapshot for a known pair', async () => {
      const snap = await svc.getRate('USD', 'EUR');
      expect(snap.baseCurrency).toBe('USD');
      expect(snap.quoteCurrency).toBe('EUR');
      expect(snap.rate).toBeGreaterThan(0);
      expect(snap.timestamp).toBeGreaterThan(0);
    });

    it('throws for an unsupported pair', async () => {
      await expect(svc.getRate('AAA', 'BBB')).rejects.toThrow('Unsupported pair');
    });

    it('accumulates rate history', async () => {
      await svc.getRate('USD', 'EUR');
      await svc.getRate('USD', 'EUR');
      const history = svc.getRateHistory('USD', 'EUR');
      expect(history.length).toBe(2);
    });

    it('filters history by currency pair', async () => {
      await svc.getRate('USD', 'EUR');
      await svc.getRate('USD', 'GBP');
      expect(svc.getRateHistory('USD', 'EUR').length).toBe(1);
      expect(svc.getRateHistory('USD', 'GBP').length).toBe(1);
    });
  });

  // ── Schedule management ────────────────────────────────────────────────────

  describe('createSchedule', () => {
    it('creates and returns a schedule', () => {
      const schedule = svc.createSchedule({
        merchantId: 'merchant-1',
        thresholds: [
          {
            baseCurrency: 'USD',
            quoteCurrency: 'EUR',
            upperBound: 1.1,
            notionalAmount: 1000,
            instrument: 'forward',
            lockDurationSeconds: 3600,
          },
        ],
      });
      expect(schedule.id).toBeTruthy();
      expect(schedule.merchantId).toBe('merchant-1');
      expect(schedule.enabled).toBe(true);
    });

    it('lists schedules by merchant', () => {
      svc.createSchedule({ merchantId: 'merchant-1', thresholds: [{ baseCurrency: 'USD', quoteCurrency: 'EUR', notionalAmount: 100, instrument: 'spot', lockDurationSeconds: 60 }] });
      svc.createSchedule({ merchantId: 'merchant-2', thresholds: [{ baseCurrency: 'USD', quoteCurrency: 'EUR', notionalAmount: 100, instrument: 'spot', lockDurationSeconds: 60 }] });
      expect(svc.listSchedules('merchant-1').length).toBe(1);
      expect(svc.listSchedules('merchant-2').length).toBe(1);
    });
  });

  describe('updateSchedule', () => {
    it('updates enabled flag', () => {
      const s = svc.createSchedule({ merchantId: 'm1', thresholds: [{ baseCurrency: 'USD', quoteCurrency: 'EUR', notionalAmount: 100, instrument: 'spot', lockDurationSeconds: 60 }] });
      const updated = svc.updateSchedule(s.id, { enabled: false });
      expect(updated?.enabled).toBe(false);
    });

    it('returns undefined for unknown id', () => {
      expect(svc.updateSchedule('nonexistent', { enabled: false })).toBeUndefined();
    });
  });

  describe('deleteSchedule', () => {
    it('deletes an existing schedule', () => {
      const s = svc.createSchedule({ merchantId: 'm1', thresholds: [{ baseCurrency: 'USD', quoteCurrency: 'EUR', notionalAmount: 100, instrument: 'spot', lockDurationSeconds: 60 }] });
      expect(svc.deleteSchedule(s.id)).toBe(true);
      expect(svc.getSchedule(s.id)).toBeUndefined();
    });

    it('returns false for unknown id', () => {
      expect(svc.deleteSchedule('nonexistent')).toBe(false);
    });
  });

  // ── Hedge execution ────────────────────────────────────────────────────────

  describe('executeHedge', () => {
    it('creates an active position with a locked rate', async () => {
      const pos = await svc.executeHedge({
        merchantId: 'm1',
        baseCurrency: 'USD',
        quoteCurrency: 'EUR',
        notionalAmount: 5000,
        instrument: 'forward',
        lockDurationSeconds: 86400,
      });
      expect(pos.status).toBe('active');
      expect(pos.lockedRate).toBeGreaterThan(0);
      expect(pos.expiresAt).toBeGreaterThan(pos.openedAt);
      expect(pos.providerRef).toBeTruthy();
    });

    it('records the position in the list', async () => {
      await svc.executeHedge({ merchantId: 'm1', baseCurrency: 'USD', quoteCurrency: 'EUR', notionalAmount: 100, instrument: 'spot', lockDurationSeconds: 60 });
      expect(svc.listPositions('m1').length).toBe(1);
    });
  });

  describe('closePosition', () => {
    it('closes an active position and computes P&L', async () => {
      const pos = await svc.executeHedge({ merchantId: 'm1', baseCurrency: 'USD', quoteCurrency: 'EUR', notionalAmount: 1000, instrument: 'forward', lockDurationSeconds: 3600 });
      const closed = await svc.closePosition(pos.id);
      expect(closed?.status).toBe('executed');
      expect(closed?.realizedPnl).toBeDefined();
      expect(closed?.closedAt).toBeDefined();
    });

    it('returns undefined for unknown position', async () => {
      expect(await svc.closePosition('nonexistent')).toBeUndefined();
    });
  });

  describe('cancelPosition', () => {
    it('cancels an active position', async () => {
      const pos = await svc.executeHedge({ merchantId: 'm1', baseCurrency: 'USD', quoteCurrency: 'EUR', notionalAmount: 100, instrument: 'spot', lockDurationSeconds: 60 });
      const cancelled = svc.cancelPosition(pos.id);
      expect(cancelled?.status).toBe('cancelled');
    });

    it('returns undefined for already-closed position', async () => {
      const pos = await svc.executeHedge({ merchantId: 'm1', baseCurrency: 'USD', quoteCurrency: 'EUR', notionalAmount: 100, instrument: 'spot', lockDurationSeconds: 60 });
      await svc.closePosition(pos.id);
      expect(svc.cancelPosition(pos.id)).toBeUndefined();
    });
  });

  // ── P&L reporting ──────────────────────────────────────────────────────────

  describe('getPnlReport', () => {
    it('returns a report with open and closed counts', async () => {
      await svc.executeHedge({ merchantId: 'm1', baseCurrency: 'USD', quoteCurrency: 'EUR', notionalAmount: 100, instrument: 'spot', lockDurationSeconds: 60 });
      const pos2 = await svc.executeHedge({ merchantId: 'm1', baseCurrency: 'USD', quoteCurrency: 'EUR', notionalAmount: 200, instrument: 'forward', lockDurationSeconds: 3600 });
      await svc.closePosition(pos2.id);

      const report = await svc.getPnlReport('m1');
      expect(report.openPositions).toBe(1);
      expect(report.closedPositions).toBe(1);
      expect(report.totalRealizedPnl).toBeDefined();
    });
  });

  // ── Audit trail ────────────────────────────────────────────────────────────

  describe('getHedgeAudit', () => {
    it('records audit entries for hedge actions', async () => {
      await svc.executeHedge({ merchantId: 'm1', baseCurrency: 'USD', quoteCurrency: 'EUR', notionalAmount: 100, instrument: 'spot', lockDurationSeconds: 60 });
      const entries = svc.getHedgeAudit('m1');
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].action).toBe('hedge.executed');
    });

    it('returns all entries when no merchantId filter', async () => {
      await svc.executeHedge({ merchantId: 'm1', baseCurrency: 'USD', quoteCurrency: 'EUR', notionalAmount: 100, instrument: 'spot', lockDurationSeconds: 60 });
      await svc.executeHedge({ merchantId: 'm2', baseCurrency: 'USD', quoteCurrency: 'EUR', notionalAmount: 100, instrument: 'spot', lockDurationSeconds: 60 });
      expect(svc.getHedgeAudit().length).toBe(2);
    });
  });

  // ── expirePositions ────────────────────────────────────────────────────────

  describe('expirePositions', () => {
    it('marks expired positions', async () => {
      const pos = await svc.executeHedge({ merchantId: 'm1', baseCurrency: 'USD', quoteCurrency: 'EUR', notionalAmount: 100, instrument: 'spot', lockDurationSeconds: 1 });
      // Manually backdate expiry
      (pos as any).expiresAt = Date.now() - 1000;
      const count = svc.expirePositions();
      expect(count).toBe(1);
      expect(svc.getPosition(pos.id)?.status).toBe('expired');
    });
  });
});
