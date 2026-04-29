import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { paymentQueue, ScheduledPayment } from '../payment-queue.js';

// Prevent actual file I/O during tests
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('[]'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

function clearQueue() {
  const all = paymentQueue.list();
  for (const p of all) paymentQueue.delete(p.id);
}

describe('PaymentQueue', () => {
  beforeEach(() => {
    clearQueue();
    paymentQueue.stop();
  });

  afterEach(() => {
    paymentQueue.stop();
  });

  // ── Scheduling ────────────────────────────────────────────────────────────

  describe('schedule()', () => {
    it('creates a pending time-triggered payment', () => {
      const p = paymentQueue.schedule({
        from: 'GABC',
        to: 'GXYZ',
        amount: '100',
        trigger: { type: 'time', executeAt: new Date(Date.now() + 60_000).toISOString() },
      });

      expect(p.id).toMatch(/^pq-/);
      expect(p.status).toBe('pending');
      expect(p.asset).toBe('XLM');
    });

    it('creates a block-triggered payment', () => {
      const p = paymentQueue.schedule({
        from: 'GABC',
        to: 'GXYZ',
        amount: '50',
        trigger: { type: 'block', blockHeight: 1_000_000 },
      });
      expect(p.trigger.type).toBe('block');
    });

    it('creates a price-triggered payment', () => {
      const p = paymentQueue.schedule({
        from: 'GABC',
        to: 'GXYZ',
        amount: '200',
        trigger: { type: 'price', maxPrice: 0.1 },
      });
      expect(p.trigger.type).toBe('price');
    });
  });

  // ── Retrieval ─────────────────────────────────────────────────────────────

  describe('get() / list()', () => {
    it('retrieves a payment by id', () => {
      const p = paymentQueue.schedule({
        from: 'A', to: 'B', amount: '1',
        trigger: { type: 'time', executeAt: new Date(Date.now() + 10_000).toISOString() },
      });
      expect(paymentQueue.get(p.id)).toEqual(p);
    });

    it('returns undefined for unknown id', () => {
      expect(paymentQueue.get('nonexistent')).toBeUndefined();
    });

    it('filters list by status', () => {
      paymentQueue.schedule({
        from: 'A', to: 'B', amount: '1',
        trigger: { type: 'time', executeAt: new Date(Date.now() + 10_000).toISOString() },
      });
      const pending = paymentQueue.list('pending');
      expect(pending.length).toBeGreaterThan(0);
      expect(pending.every((p) => p.status === 'pending')).toBe(true);
    });
  });

  // ── Cancel / Delete ───────────────────────────────────────────────────────

  describe('cancel()', () => {
    it('cancels a pending payment', () => {
      const p = paymentQueue.schedule({
        from: 'A', to: 'B', amount: '1',
        trigger: { type: 'time', executeAt: new Date(Date.now() + 10_000).toISOString() },
      });
      expect(paymentQueue.cancel(p.id)).toBe(true);
      expect(paymentQueue.get(p.id)?.status).toBe('cancelled');
    });

    it('cannot cancel a non-pending payment', () => {
      const p = paymentQueue.schedule({
        from: 'A', to: 'B', amount: '1',
        trigger: { type: 'time', executeAt: new Date(Date.now() + 10_000).toISOString() },
      });
      paymentQueue.cancel(p.id); // now cancelled
      expect(paymentQueue.cancel(p.id)).toBe(false);
    });
  });

  describe('delete()', () => {
    it('deletes an existing payment', () => {
      const p = paymentQueue.schedule({
        from: 'A', to: 'B', amount: '1',
        trigger: { type: 'time', executeAt: new Date(Date.now() + 10_000).toISOString() },
      });
      expect(paymentQueue.delete(p.id)).toBe(true);
      expect(paymentQueue.get(p.id)).toBeUndefined();
    });

    it('returns false for unknown id', () => {
      expect(paymentQueue.delete('ghost')).toBe(false);
    });
  });

  // ── Trigger evaluation ────────────────────────────────────────────────────

  describe('tick() — time trigger', () => {
    it('executes a payment whose time has come', async () => {
      const p = paymentQueue.schedule({
        from: 'A', to: 'B', amount: '10',
        trigger: { type: 'time', executeAt: new Date(Date.now() - 1_000).toISOString() },
      });
      await paymentQueue.tick();
      expect(paymentQueue.get(p.id)?.status).toBe('executed');
    });

    it('marks a payment as missed when window has passed', async () => {
      const p = paymentQueue.schedule({
        from: 'A', to: 'B', amount: '10',
        trigger: { type: 'time', executeAt: new Date(Date.now() - 120_000).toISOString() },
      });
      await paymentQueue.tick();
      expect(paymentQueue.get(p.id)?.status).toBe('missed');
    });

    it('does not execute a future payment', async () => {
      const p = paymentQueue.schedule({
        from: 'A', to: 'B', amount: '10',
        trigger: { type: 'time', executeAt: new Date(Date.now() + 60_000).toISOString() },
      });
      await paymentQueue.tick();
      expect(paymentQueue.get(p.id)?.status).toBe('pending');
    });
  });

  describe('tick() — block trigger', () => {
    it('executes when current block >= trigger block', async () => {
      const p = paymentQueue.schedule({
        from: 'A', to: 'B', amount: '5',
        trigger: { type: 'block', blockHeight: 500 },
      });
      await paymentQueue.tick({ currentBlock: 600 });
      expect(paymentQueue.get(p.id)?.status).toBe('executed');
    });

    it('stays pending when block not yet reached', async () => {
      const p = paymentQueue.schedule({
        from: 'A', to: 'B', amount: '5',
        trigger: { type: 'block', blockHeight: 1_000_000 },
      });
      await paymentQueue.tick({ currentBlock: 100 });
      expect(paymentQueue.get(p.id)?.status).toBe('pending');
    });
  });

  describe('tick() — price trigger', () => {
    it('executes when price <= maxPrice', async () => {
      const p = paymentQueue.schedule({
        from: 'A', to: 'B', amount: '20',
        trigger: { type: 'price', maxPrice: 0.15 },
      });
      await paymentQueue.tick({ xlmUsdPrice: 0.10 });
      expect(paymentQueue.get(p.id)?.status).toBe('executed');
    });

    it('stays pending when price is above maxPrice', async () => {
      const p = paymentQueue.schedule({
        from: 'A', to: 'B', amount: '20',
        trigger: { type: 'price', maxPrice: 0.05 },
      });
      await paymentQueue.tick({ xlmUsdPrice: 0.20 });
      expect(paymentQueue.get(p.id)?.status).toBe('pending');
    });
  });

  // ── Stats ─────────────────────────────────────────────────────────────────

  describe('stats()', () => {
    it('returns correct counts', async () => {
      paymentQueue.schedule({
        from: 'A', to: 'B', amount: '1',
        trigger: { type: 'time', executeAt: new Date(Date.now() - 1_000).toISOString() },
      });
      paymentQueue.schedule({
        from: 'A', to: 'B', amount: '2',
        trigger: { type: 'time', executeAt: new Date(Date.now() + 60_000).toISOString() },
      });

      await paymentQueue.tick();

      const s = paymentQueue.stats();
      expect(s.executed).toBe(1);
      expect(s.pending).toBe(1);
      expect(s.total).toBe(2);
    });
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  describe('start() / stop()', () => {
    it('starts and stops without throwing', () => {
      expect(() => paymentQueue.start()).not.toThrow();
      expect(() => paymentQueue.stop()).not.toThrow();
    });

    it('is idempotent — double start does not throw', () => {
      paymentQueue.start();
      expect(() => paymentQueue.start()).not.toThrow();
      paymentQueue.stop();
    });
  });
});
