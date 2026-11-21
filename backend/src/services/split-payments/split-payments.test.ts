/**
 * split-payments.test.ts — Issue #917: Split payments between multiple
 * recipients
 *
 * Covers basis-point conversion, exact minor-unit allocation, request
 * validation, plan lifecycle and execution reconciliation.
 */
import { describe, expect, it, beforeEach } from 'vitest';

import {
  InMemorySplitStore,
  SplitPaymentService,
  allocateMinorUnits,
  allocateSplit,
  fromBasisPoints,
  toBasisPoints,
  validateSplitPlan,
} from './index.js';
import type { SplitEvent, SplitEventPublisher, SplitRecipientInput } from './index.js';

class CapturingPublisher implements SplitEventPublisher {
  events: SplitEvent[] = [];
  publish(event: SplitEvent): void {
    this.events.push(event);
  }
}

const NOW = new Date('2026-09-28T00:00:00.000Z');

function makeService(publisher?: SplitEventPublisher) {
  const store = new InMemorySplitStore();
  let counter = 0;
  const service = new SplitPaymentService({
    repository: store,
    executionRepository: store,
    publisher: publisher ?? { publish: () => undefined },
    now: () => NOW,
    idFactory: () => `id-${++counter}`,
  });
  return service;
}

function recipient(overrides: Partial<SplitRecipientInput> = {}): SplitRecipientInput {
  return { recipientId: 'r1', walletAddress: 'GABC', percentage: 50, ...overrides };
}

function sumMinor(result: ReturnType<typeof allocateSplit>): number {
  return result.platformFeeMinor + result.shares.reduce((sum, share) => sum + share.amountMinor, 0);
}

describe('basis-point conversion', () => {
  it('round-trips percentages through basis points', () => {
    expect(toBasisPoints(47.5)).toBe(4750);
    expect(toBasisPoints(33.33)).toBe(3333);
    expect(fromBasisPoints(4750)).toBe(47.5);
  });
});

describe('allocateMinorUnits', () => {
  it('allocates the whole total with no remainder lost', () => {
    expect(allocateMinorUnits(1000, [3333, 3333, 3334])).toEqual([333, 333, 334]);
    expect(allocateMinorUnits(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateMinorUnits(7, [1, 1, 1, 1, 1, 1, 1])).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it('returns zeros for non-positive inputs', () => {
    expect(allocateMinorUnits(0, [1, 1])).toEqual([0, 0]);
    expect(allocateMinorUnits(100, [0, 0])).toEqual([0, 0]);
  });
});

describe('validateSplitPlan', () => {
  const base = { tenantId: 'tenant-1', recipients: [recipient({ percentage: 60 }), recipient({ recipientId: 'r2', percentage: 40 })] };

  it('normalises a valid plan', () => {
    const result = validateSplitPlan({ ...base, platformFeePercentage: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currency).toBe('USD');
    expect(result.value.platformFeeBps).toBe(0);
    expect(result.value.recipients.map((r) => r.shareBps)).toEqual([6000, 4000]);
  });

  it('rejects an empty recipient list', () => {
    expect(validateSplitPlan({ tenantId: 't', recipients: [] }).ok).toBe(false);
  });

  it('rejects duplicate or missing recipient ids', () => {
    expect(
      validateSplitPlan({
        tenantId: 't',
        recipients: [recipient({ percentage: 50 }), recipient({ percentage: 50 })],
      }).ok,
    ).toBe(false);
    expect(
      validateSplitPlan({ tenantId: 't', recipients: [recipient({ recipientId: '', percentage: 100 })] }).ok,
    ).toBe(false);
  });

  it('rejects a missing wallet address', () => {
    expect(
      validateSplitPlan({ tenantId: 't', recipients: [recipient({ walletAddress: '', percentage: 100 })] }).ok,
    ).toBe(false);
  });

  it('rejects percentages that do not sum to exactly 100', () => {
    const short = validateSplitPlan({ tenantId: 't', recipients: [recipient({ percentage: 90 })] });
    expect(short.ok).toBe(false);
    if (short.ok) return;
    expect(short.error.code).toBe('VALIDATION_ERROR');

    expect(
      validateSplitPlan({
        tenantId: 't',
        recipients: [recipient({ recipientId: 'a', percentage: 60 }), recipient({ recipientId: 'b', percentage: 60 })],
      }).ok,
    ).toBe(false);
  });

  it('rejects out-of-range percentages and fees', () => {
    expect(validateSplitPlan({ tenantId: 't', recipients: [recipient({ percentage: 0 })] }).ok).toBe(false);
    expect(
      validateSplitPlan({ ...base, platformFeePercentage: 101 }).ok,
    ).toBe(false);
    expect(
      validateSplitPlan({ ...base, platformFeePercentage: -1 }).ok,
    ).toBe(false);
  });

  it('rejects unsupported currencies and too many recipients', () => {
    expect(validateSplitPlan({ ...base, currency: 'JPY' }).ok).toBe(false);
    const many = Array.from({ length: 26 }, (_, index) => recipient({ recipientId: `r${index}`, percentage: 100 / 26 }));
    expect(validateSplitPlan({ tenantId: 't', recipients: many }).ok).toBe(false);
  });
});

describe('allocateSplit', () => {
  it('splits fee and recipients exactly', () => {
    const validated = validateSplitPlan({
      tenantId: 't',
      platformFeePercentage: 5,
      recipients: [
        recipient({ recipientId: 'a', percentage: 47.5, walletAddress: 'GA' }),
        recipient({ recipientId: 'b', percentage: 47.5, walletAddress: 'GB' }),
      ],
    });
    if (!validated.ok) throw new Error('validation failed');

    const allocation = allocateSplit({
      totalAmount: 100,
      platformFeePercentage: validated.value.platformFeePercentage,
      platformFeeBps: validated.value.platformFeeBps,
      recipients: validated.value.recipients,
    });

    expect(allocation.platformFeeAmount).toBe(5);
    expect(allocation.shares.map((share) => share.amount)).toEqual([47.5, 47.5]);
    expect(allocation.allocatedMinor).toBe(10_000);
    expect(allocation.unallocatedMinor).toBe(0);
  });

  it('absorbs rounding remainders so nothing is lost', () => {
    const validated = validateSplitPlan({
      tenantId: 't',
      recipients: [
        recipient({ recipientId: 'a', percentage: 33.33 }),
        recipient({ recipientId: 'b', percentage: 33.33 }),
        recipient({ recipientId: 'c', percentage: 33.34 }),
      ],
    });
    if (!validated.ok) throw new Error('validation failed');

    const allocation = allocateSplit({
      totalAmount: 10,
      platformFeePercentage: 0,
      platformFeeBps: 0,
      recipients: validated.value.recipients,
    });

    expect(allocation.shares.map((share) => share.amount)).toEqual([3.33, 3.33, 3.34]);
    expect(sumMinor(allocation)).toBe(1000);
    expect(allocation.unallocatedMinor).toBe(0);
  });

  it('flags recipients below their minimum amount', () => {
    const validated = validateSplitPlan({
      tenantId: 't',
      recipients: [
        recipient({ recipientId: 'small', percentage: 50, minimumAmount: 10 }),
        recipient({ recipientId: 'ok', percentage: 50 }),
      ],
    });
    if (!validated.ok) throw new Error('validation failed');

    const allocation = allocateSplit({
      totalAmount: 1,
      platformFeePercentage: 0,
      platformFeeBps: 0,
      recipients: validated.value.recipients,
    });

    expect(allocation.shares[0].skipped).toBe(true);
    expect(allocation.shares[0].reason).toBe('Below minimum amount');
    expect(allocation.shares[1].skipped).toBe(false);
  });

  it('throws for a non-positive total', () => {
    expect(() =>
      allocateSplit({ totalAmount: 0, platformFeePercentage: 0, platformFeeBps: 0, recipients: [] }),
    ).toThrow(/positive/);
  });
});

describe('SplitPaymentService', () => {
  let publisher: CapturingPublisher;
  let service: SplitPaymentService;

  beforeEach(() => {
    publisher = new CapturingPublisher();
    service = makeService(publisher);
  });

  async function createPlan(overrides: Record<string, unknown> = {}) {
    const result = await service.createPlan({
      tenantId: 'tenant-1',
      recipients: [
        recipient({ recipientId: 'a', percentage: 65, walletAddress: 'GA' }),
        recipient({ recipientId: 'b', percentage: 32.5, walletAddress: 'GB' }),
      ],
      platformFeePercentage: 2.5,
      ...overrides,
    });
    if (!result.ok) throw new Error(`createPlan failed: ${result.error.message}`);
    return result.value;
  }

  it('creates an active plan and emits an event', async () => {
    const plan = await createPlan();
    expect(plan.status).toBe('active');
    expect(plan.platformFeeBps).toBe(250);
    expect(plan.recipients).toHaveLength(2);
    expect(publisher.events.map((event) => event.type)).toContain('split_plan.created');
  });

  it('does not persist a plan when validation fails', async () => {
    const result = await service.createPlan({
      tenantId: 'tenant-1',
      recipients: [recipient({ percentage: 90 })],
    });
    expect(result.ok).toBe(false);
    const listed = await service.listPlans('tenant-1');
    expect(listed.ok && listed.value).toHaveLength(0);
  });

  it('scopes reads to the owning tenant', async () => {
    const plan = await createPlan();
    const other = await service.getPlan('tenant-2', plan.id);
    expect(other.ok).toBe(false);
    if (other.ok) return;
    expect(other.error.code).toBe('NOT_FOUND');
  });

  it('lists plans filtered by status', async () => {
    const plan = await createPlan();
    await service.archivePlan('tenant-1', plan.id);

    const active = await service.listPlans('tenant-1', { status: 'active' });
    expect(active.ok && active.value).toHaveLength(0);
    const archived = await service.listPlans('tenant-1', { status: 'archived' });
    expect(archived.ok && archived.value).toHaveLength(1);
  });

  it('rejects archiving a plan twice', async () => {
    const plan = await createPlan();
    await service.archivePlan('tenant-1', plan.id);
    const again = await service.archivePlan('tenant-1', plan.id);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('CONFLICT');
  });

  it('executes a payment and reconciles the full amount', async () => {
    const plan = await createPlan();
    const executed = await service.executeSplit('tenant-1', plan.id, {
      paymentId: 'pay_1',
      totalAmount: 199.99,
    });

    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    const execution = executed.value;
    expect(execution.totalAmount).toBe(199.99);
    expect(execution.platformFeeAmount).toBe(5);
    expect(execution.distributions.map((share) => share.amount)).toEqual([129.99, 65]);
    expect(execution.allocatedMinor).toBe(19_999);
    expect(publisher.events.map((event) => event.type)).toContain('split.executed');
  });

  it('rejects executing an archived plan', async () => {
    const plan = await createPlan();
    await service.archivePlan('tenant-1', plan.id);
    const result = await service.executeSplit('tenant-1', plan.id, { paymentId: 'p', totalAmount: 10 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT');
  });

  it('rejects a currency that does not match the plan', async () => {
    const plan = await createPlan({ currency: 'USD' });
    const result = await service.executeSplit('tenant-1', plan.id, {
      paymentId: 'p',
      totalAmount: 10,
      currency: 'EUR',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects executing an unknown plan', async () => {
    const result = await service.executeSplit('tenant-1', 'missing', { paymentId: 'p', totalAmount: 10 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('previews an allocation without persisting an execution', async () => {
    const plan = await createPlan();
    const preview = await service.previewAllocation('tenant-1', plan.id, 100);

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.platformFeeAmount).toBe(2.5);
    expect(preview.value.shares.map((share) => share.amount)).toEqual([65, 32.5]);

    const executions = await service.listExecutions('tenant-1', plan.id);
    expect(executions.ok && executions.value).toHaveLength(0);
  });

  it('summarises executions', async () => {
    const plan = await createPlan();
    await service.executeSplit('tenant-1', plan.id, { paymentId: 'p1', totalAmount: 100 });
    await service.executeSplit('tenant-1', plan.id, { paymentId: 'p2', totalAmount: 200 });

    const summary = await service.getExecutionSummary('tenant-1', plan.id);
    expect(summary.ok).toBe(true);
    if (!summary.ok) return;
    expect(summary.value.executionCount).toBe(2);
    expect(summary.value.totalProcessed).toBe(300);
    expect(summary.value.totalPlatformFees).toBe(7.5);
  });
});
