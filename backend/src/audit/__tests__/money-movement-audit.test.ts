import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MoneyMovementAuditLog } from '../money-movement-audit.js';
import { verifyAuditChain } from '../chain-verifier.js';
import type { ImmutableAuditLogEntry, ImmutableAuditStore } from '../immutable-logger.js';

describe('MoneyMovementAuditLog — Issue #1011', () => {
  let clock: Date;
  let log: MoneyMovementAuditLog;

  beforeEach(() => {
    clock = new Date('2026-03-01T10:00:00Z');
    log = new MoneyMovementAuditLog({ now: () => clock });
  });

  function seed() {
    log.record({ actor: 'fin_1', operation: 'balance.set', amount: 500, asset: 'USDC', reference: 'balance:m1', merchantId: 'm1' });
    clock = new Date('2026-03-01T11:00:00Z');
    log.record({ actor: 'system', operation: 'payout.reserved', amount: 500, asset: 'USDC', reference: 'po_1', merchantId: 'm1' });
    clock = new Date('2026-03-02T09:00:00Z');
    log.record({
      actor: 'fin_2',
      operation: 'payout.settled',
      amount: 500,
      asset: 'USDC',
      reference: 'po_1',
      merchantId: 'm1',
      metadata: { transactionHash: '0xabc' },
    });
    log.record({ actor: 'system', operation: 'payout.reserved', amount: 75, asset: 'XLM', reference: 'po_2', merchantId: 'm2' });
  }

  describe('records actor, amount and reference', () => {
    it('returns a typed record with every movement field', () => {
      const record = log.record({
        actor: 'fin_1',
        operation: 'payout.approved',
        amount: 1250.5,
        asset: 'USDC',
        reference: 'po_123',
        merchantId: 'm1',
        metadata: { scheduleId: 'sch_m1' },
      });

      expect(record).toMatchObject({
        sequence: 1,
        actor: 'fin_1',
        operation: 'payout.approved',
        amount: 1250.5,
        asset: 'USDC',
        reference: 'po_123',
        merchantId: 'm1',
        metadata: { scheduleId: 'sch_m1' },
        timestamp: '2026-03-01T10:00:00.000Z',
      });
      expect(record.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(record.previousHash).toBe('0'.repeat(64));
    });

    it('refuses entries without an actor, reference or finite amount', () => {
      const base = { actor: 'a', operation: 'payout.settled' as const, amount: 1, asset: 'USDC', reference: 'r' };
      expect(() => log.record({ ...base, actor: '' })).toThrow('AUDIT_ACTOR_REQUIRED');
      expect(() => log.record({ ...base, reference: '' })).toThrow('AUDIT_REFERENCE_REQUIRED');
      expect(() => log.record({ ...base, amount: Number.NaN })).toThrow('AUDIT_AMOUNT_INVALID');
      expect(log.size).toBe(0);
    });
  });

  describe('tamper evidence', () => {
    it('chains every entry to the previous one and verifies clean', async () => {
      seed();
      const entries = log.getEntries();
      for (let i = 1; i < entries.length; i++) expect(entries[i].previousHash).toBe(entries[i - 1].hash);
      expect(await log.verify()).toEqual({ valid: true, checked: 4 });
    });

    it('exposes entries as frozen copies so callers cannot rewrite history', async () => {
      seed();
      const entries = log.getEntries();
      expect(Object.isFrozen(entries[0])).toBe(true);
      expect(Object.isFrozen(entries[0].details)).toBe(true);
      expect(() => {
        (entries[0].details as Record<string, unknown>).amount = 1;
      }).toThrow();
      expect(log.query().records[0].amount).toBe(500);
      expect(await log.verify()).toMatchObject({ valid: true });
    });

    it.each([
      ['amount', (e: ImmutableAuditLogEntry) => ((e.details as Record<string, unknown>).amount = 1)],
      ['actor', (e: ImmutableAuditLogEntry) => (e.actor = 'someone_else')],
      ['reference', (e: ImmutableAuditLogEntry) => ((e.details as Record<string, unknown>).reference = 'po_x')],
    ])('detects an edited %s in an exported copy', async (_field, mutate) => {
      seed();
      const exported = structuredClone(log.getEntries());
      mutate(exported[1]);
      const result = await verifyAuditChain(exported);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(exported[1].id);
    });

    it('detects deleted and reordered entries', async () => {
      seed();
      const dropped = structuredClone(log.getEntries());
      dropped.splice(1, 1);
      expect((await verifyAuditChain(dropped)).valid).toBe(false);

      const reordered = structuredClone(log.getEntries());
      [reordered[1], reordered[2]] = [reordered[2], reordered[1]];
      expect((await verifyAuditChain(reordered)).valid).toBe(false);
    });

    it('persists entries to a durable store in chain order without blocking', async () => {
      const appended: ImmutableAuditLogEntry[] = [];
      const store: ImmutableAuditStore = {
        getLatestAuditHash: vi.fn(),
        appendAuditEntry: vi.fn(async (entry) => {
          appended.push(entry);
        }),
      };
      const durable = new MoneyMovementAuditLog({ store, now: () => clock });
      durable.record({ actor: 'a', operation: 'payout.reserved', amount: 1, asset: 'USDC', reference: 'r1' });
      durable.record({ actor: 'a', operation: 'payout.settled', amount: 1, asset: 'USDC', reference: 'r1' });
      await durable.flush();
      expect(appended.map((e) => e.action)).toEqual(['payout.reserved', 'payout.settled']);
      expect((await verifyAuditChain(appended)).valid).toBe(true);
    });
  });

  describe('compliance queries', () => {
    beforeEach(seed);

    it('filters by actor, merchant, reference, operation and asset', () => {
      expect(log.query({ actor: 'fin_2' }).records.map((r) => r.operation)).toEqual(['payout.settled']);
      expect(log.query({ merchantId: 'm2' }).total).toBe(1);
      expect(log.query({ reference: 'po_1' }).records.map((r) => r.operation)).toEqual([
        'payout.reserved',
        'payout.settled',
      ]);
      expect(log.query({ operation: ['payout.reserved', 'balance.set'] }).total).toBe(3);
      expect(log.query({ asset: 'XLM' }).records[0].reference).toBe('po_2');
    });

    it('filters by amount range and time window and totals by asset', () => {
      const big = log.query({ minAmount: 100 });
      expect(big.total).toBe(3);
      expect(big.totalAmountByAsset).toEqual({ USDC: 1500 });

      const day2 = log.query({ from: new Date('2026-03-02T00:00:00Z'), to: new Date('2026-03-02T23:59:59Z') });
      expect(day2.records.map((r) => r.reference)).toEqual(['po_1', 'po_2']);
    });

    it('paginates while reporting the full match count', () => {
      const page = log.query({ limit: 2, offset: 1 });
      expect(page.total).toBe(4);
      expect(page.records.map((r) => r.sequence)).toEqual([2, 3]);
    });
  });
});
