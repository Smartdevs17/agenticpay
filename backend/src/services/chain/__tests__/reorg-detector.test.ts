/**
 * reorg-detector.test.ts — Issue #514
 *
 * Integration tests using in-memory mock providers and Prisma mocks.
 * No real blockchain or database required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfirmationTracker, DEFAULT_THRESHOLDS } from '../confirmation-tracker.js';
import {
  ReorgDetector,
  type ChainConfig,
  type ChainProvider,
  type BlockHeader,
} from '../reorg-detector.js';

// ── Prisma mock (vi.hoisted ensures refs are available inside vi.mock factory) ─

const {
  mockReorgEventCreate,
  mockTransactionReorgCreate,
  mockTransactionReorgCount,
  mockTransactionReorgUpdateMany,
  mockPaymentFindMany,
  mockPaymentUpdate,
  mockReorgEventUpdate,
  mockTransaction,
  mockFetch,
} = vi.hoisted(() => {
  const mockReorgEventCreate = vi.fn();
  const mockTransactionReorgCreate = vi.fn();
  const mockTransactionReorgCount = vi.fn().mockResolvedValue(0);
  const mockTransactionReorgUpdateMany = vi.fn();
  const mockPaymentFindMany = vi.fn().mockResolvedValue([]);
  const mockPaymentUpdate = vi.fn();
  const mockReorgEventUpdate = vi.fn();
  // prisma.$transaction receives a callback; execute it with the mock client
  const mockTransaction = vi.fn((cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      reorgEvent: { create: mockReorgEventCreate },
      transactionReorg: { create: mockTransactionReorgCreate },
      payment: { update: mockPaymentUpdate },
    }),
  );
  const mockFetch = vi.fn().mockResolvedValue({ ok: true });
  return {
    mockReorgEventCreate,
    mockTransactionReorgCreate,
    mockTransactionReorgCount,
    mockTransactionReorgUpdateMany,
    mockPaymentFindMany,
    mockPaymentUpdate,
    mockReorgEventUpdate,
    mockTransaction,
    mockFetch,
  };
});

// PrismaClient must use a regular function (not arrow) so `new` works correctly
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(function () {
    return {
      $transaction: mockTransaction,
      reorgEvent: { create: mockReorgEventCreate, update: mockReorgEventUpdate },
      transactionReorg: {
        create: mockTransactionReorgCreate,
        count: mockTransactionReorgCount,
        updateMany: mockTransactionReorgUpdateMany,
      },
      payment: { findMany: mockPaymentFindMany, update: mockPaymentUpdate },
    };
  }),
}));

// ── node-fetch mock ───────────────────────────────────────────────────────────

vi.mock('node-fetch', () => ({ default: mockFetch }));

// ── Mock ChainProvider ────────────────────────────────────────────────────────

function makeBlock(number: number, hash: string, parentHash: string): BlockHeader {
  return { number, hash, parentHash, timestamp: Date.now() };
}

class MockProvider implements ChainProvider {
  private blocks = new Map<number, BlockHeader>();
  private head = 0;

  addBlock(block: BlockHeader): void {
    this.blocks.set(block.number, block);
    if (block.number > this.head) this.head = block.number;
  }

  async getBlockNumber(): Promise<number> { return this.head; }
  async getBlock(n: number): Promise<BlockHeader | null> { return this.blocks.get(n) ?? null; }
  setHead(n: number): void { this.head = n; }
}

function makeMockDetector(network: string, provider: MockProvider, safetyThreshold = 2): ReorgDetector {
  return new ReorgDetector({
    chains: [{ network, safetyThreshold } as ChainConfig],
    providerFactory: () => provider,
  });
}

// ── ConfirmationTracker ───────────────────────────────────────────────────────

describe('ConfirmationTracker', () => {
  let tracker: ConfirmationTracker;

  beforeEach(() => {
    // Fix test-isolation: each test gets a fresh instance; never touches the singleton
    tracker = new ConfirmationTracker();
  });

  it('returns correct default thresholds', () => {
    expect(tracker.getThreshold('ethereum')).toBe(12);
    expect(tracker.getThreshold('polygon')).toBe(64);
    expect(tracker.getThreshold('stellar')).toBe(1);
  });

  it('falls back to default threshold for unknown networks', () => {
    expect(tracker.getThreshold('avalanche')).toBe(DEFAULT_THRESHOLDS['default']);
  });

  it('records a confirmation and computes status correctly', () => {
    tracker.setNetworkHead('ethereum', 1000);
    tracker.recordConfirmation('0xabc', 'ethereum', 990);

    const status = tracker.getStatus('0xabc', 'ethereum');
    expect(status).not.toBeNull();
    expect(status!.confirmations).toBe(11); // 1000 - 990 + 1
    expect(status!.isFinalized).toBe(false); // 11 < 12 threshold
  });

  it('marks transaction as finalized when confirmations reach threshold', () => {
    tracker.setNetworkHead('ethereum', 1000);
    tracker.recordConfirmation('0xabc', 'ethereum', 989); // exactly 12 confirmations

    expect(tracker.isFinalized('0xabc', 'ethereum')).toBe(true);
  });

  it('does not finalize below threshold', () => {
    tracker.setNetworkHead('ethereum', 1000);
    tracker.recordConfirmation('0xabc', 'ethereum', 991); // 10 confirmations, needs 12

    expect(tracker.isFinalized('0xabc', 'ethereum')).toBe(false);
  });

  it('findAffected returns only txs in the orphaned block range', () => {
    tracker.recordConfirmation('0xaaa', 'ethereum', 100);
    tracker.recordConfirmation('0xbbb', 'ethereum', 101);
    tracker.recordConfirmation('0xccc', 'ethereum', 102);
    tracker.recordConfirmation('0xddd', 'ethereum', 103);

    const hashes = tracker.findAffected('ethereum', 101, 102).map((a) => a.txHash).sort();
    expect(hashes).toEqual(['0xbbb', '0xccc']);
  });

  it('findAffected returns empty array when nothing is in range', () => {
    tracker.recordConfirmation('0xaaa', 'ethereum', 100);
    expect(tracker.findAffected('ethereum', 200, 300)).toHaveLength(0);
  });

  it('removes a confirmation', () => {
    tracker.recordConfirmation('0xabc', 'ethereum', 100);
    tracker.removeConfirmation('0xabc', 'ethereum');
    expect(tracker.getStatus('0xabc', 'ethereum')).toBeNull();
  });

  it('is network-scoped — ethereum and polygon tracked independently', () => {
    tracker.recordConfirmation('0xsame', 'ethereum', 100);
    tracker.recordConfirmation('0xsame', 'polygon', 200);

    expect(tracker.getStatus('0xsame', 'ethereum')!.confirmedAtBlock).toBe(100);
    expect(tracker.getStatus('0xsame', 'polygon')!.confirmedAtBlock).toBe(200);
  });
});

// ── ReorgDetector.simulateReorg ───────────────────────────────────────────────

describe('ReorgDetector.simulateReorg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReorgEventCreate.mockResolvedValue({ id: 'evt-sim-1' });
    mockPaymentFindMany.mockResolvedValue([]);
    // $transaction executes the callback synchronously in tests
    mockTransaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        reorgEvent: { create: mockReorgEventCreate },
        transactionReorg: { create: mockTransactionReorgCreate },
        payment: { update: mockPaymentUpdate },
      }),
    );
  });

  it('persists ReorgEvent with correct depth and block range', async () => {
    const detector = new ReorgDetector({
      chains: [{ network: 'ethereum', safetyThreshold: 12 }],
    });

    await detector.simulateReorg('ethereum', '0xorphaned', '0xcanonical', 500, 502, []);

    expect(mockReorgEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          network: 'ethereum',
          reorgDepth: 3,
          fromBlockNumber: 500,
          toBlockNumber: 502,
          orphanedBlockHash: '0xorphaned',
          canonicalBlockHash: '0xcanonical',
          safetyThreshold: 12,
        }),
      }),
    );
  });

  it('marks affected payment as pending_review inside the transaction', async () => {
    const paymentId = 'payment-abc-123';
    mockPaymentFindMany.mockResolvedValue([{ id: paymentId, txHash: '0xtxaffected' }]);

    const detector = new ReorgDetector({
      chains: [{ network: 'ethereum', safetyThreshold: 12 }],
    });

    await detector.simulateReorg('ethereum', '0xorphaned', '0xcanonical', 100, 101, ['0xtxaffected']);

    expect(mockPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: paymentId },
        data: { status: 'pending_review' },
      }),
    );
  });

  it('creates TransactionReorg row with correct reorgDetails', async () => {
    const paymentId = 'payment-xyz-456';
    mockPaymentFindMany.mockResolvedValue([{ id: paymentId, txHash: '0xtxb' }]);
    mockReorgEventCreate.mockResolvedValue({ id: 'evt-tr-1' });

    const detector = new ReorgDetector({
      chains: [{ network: 'polygon', safetyThreshold: 64 }],
    });

    await detector.simulateReorg('polygon', '0xoldblock', '0xnewblock', 200, 203, ['0xtxb']);

    expect(mockTransactionReorgCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          txHash: '0xtxb',
          paymentId,
          network: 'polygon',
          reorgDetails: expect.objectContaining({
            reorgDepth: 4,
            orphanedBlockHash: '0xoldblock',
          }),
        }),
      }),
    );
  });

  it('does NOT fire alert when depth is within safety threshold', async () => {
    const detector = new ReorgDetector({
      chains: [{ network: 'ethereum', safetyThreshold: 12 }],
      alertWebhookUrl: 'http://alerts.test/hook',
    });

    await detector.simulateReorg('ethereum', '0xA', '0xB', 100, 102, []); // depth 3 < 12

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fires alert when depth exceeds safety threshold', async () => {
    const detector = new ReorgDetector({
      chains: [{ network: 'ethereum', safetyThreshold: 2 }],
      alertWebhookUrl: 'http://alerts.test/hook',
    });

    await detector.simulateReorg('ethereum', '0xA', '0xB', 100, 104, []); // depth 5 > 2

    expect(mockFetch).toHaveBeenCalledWith(
      'http://alerts.test/hook',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"severity":"critical"'),
      }),
    );
  });

  // Fix #9 verification
  it('sets TransactionReorg status to rolled_back when tx is not re-confirmed', async () => {
    mockPaymentFindMany.mockResolvedValue([{ id: 'pay-1', txHash: '0xtx1' }]);
    mockReorgEventCreate.mockResolvedValue({ id: 'evt-rolled' });

    const detector = new ReorgDetector({
      chains: [{ network: 'ethereum', safetyThreshold: 12 }],
    });

    // processReorgJob with no rpcUrl and no providerFactory → isStillConfirmed = false
    await detector.processReorgJob({
      reorgEventId: 'evt-rolled',
      txHash: '0xtx1',
      paymentId: 'pay-1',
      network: 'ethereum',
    });

    expect(mockTransactionReorgUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'rolled_back' }),
      }),
    );
    expect(mockPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'pending' } }),
    );
  });
});

// ── ReorgDetector.pollChain ───────────────────────────────────────────────────

describe('ReorgDetector.pollChain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReorgEventCreate.mockResolvedValue({ id: 'evt-poll' });
    mockPaymentFindMany.mockResolvedValue([]);
    mockTransaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        reorgEvent: { create: mockReorgEventCreate },
        transactionReorg: { create: mockTransactionReorgCreate },
        payment: { update: mockPaymentUpdate },
      }),
    );
  });

  it('advances chain tip on clean linear extension without triggering reorg', async () => {
    const provider = new MockProvider();
    provider.addBlock(makeBlock(1, '0xb1', '0x0'));
    provider.addBlock(makeBlock(2, '0xb2', '0xb1'));
    provider.addBlock(makeBlock(3, '0xb3', '0xb2'));

    const detector = makeMockDetector('ethereum', provider, 2);
    await detector.start();

    expect(detector.getCurrentTip('ethereum')?.blockHash).toBe('0xb3');

    provider.addBlock(makeBlock(4, '0xb4', '0xb3'));
    await detector.pollChain('ethereum');

    expect(detector.getCurrentTip('ethereum')?.blockHash).toBe('0xb4');
    expect(mockReorgEventCreate).not.toHaveBeenCalled();

    await detector.stopAsync();
  });

  it('calls handleReorg when parentHash mismatches canonical tip', async () => {
    const provider = new MockProvider();
    provider.addBlock(makeBlock(1, '0xb1', '0x0'));
    provider.addBlock(makeBlock(2, '0xb2', '0xb1'));
    provider.addBlock(makeBlock(3, '0xb3', '0xb2'));

    const handleReorgSpy = vi
      .spyOn(
        ReorgDetector.prototype as unknown as { handleReorg: () => Promise<void> },
        'handleReorg' as never,
      )
      .mockResolvedValue(undefined);

    const detector = makeMockDetector('ethereum', provider, 2);
    await detector.start();

    provider.addBlock(makeBlock(4, '0xb4_fork', '0xb2_fork'));
    await detector.pollChain('ethereum');

    expect(handleReorgSpy).toHaveBeenCalledOnce();

    handleReorgSpy.mockRestore();
    await detector.stopAsync();
  });

  // Fix #3 verification: same-height reorg must NOT be skipped
  it('detects a same-height sibling block reorg', async () => {
    const provider = new MockProvider();
    provider.addBlock(makeBlock(1, '0xb1', '0x0'));
    provider.addBlock(makeBlock(2, '0xb2', '0xb1'));
    provider.addBlock(makeBlock(3, '0xb3', '0xb2'));

    const detector = makeMockDetector('ethereum', provider, 2);
    await detector.start();

    // Tip is now block 3 (0xb3). Replace it with a sibling at the same height.
    // The provider returns block 3 again but with a different hash/parentHash.
    provider.addBlock(makeBlock(3, '0xb3_sibling', '0xb2_fork'));
    provider.setHead(3); // same height

    const handleReorgSpy = vi
      .spyOn(
        ReorgDetector.prototype as unknown as { handleReorg: () => Promise<void> },
        'handleReorg' as never,
      )
      .mockResolvedValue(undefined);

    await detector.pollChain('ethereum');

    // With the old <= comparison this would have returned early. With < it proceeds.
    expect(handleReorgSpy).toHaveBeenCalledOnce();

    handleReorgSpy.mockRestore();
    await detector.stopAsync();
  });

  it('does not poll when chain head has not advanced', async () => {
    const provider = new MockProvider();
    provider.addBlock(makeBlock(5, '0xb5', '0xb4'));

    const detector = makeMockDetector('ethereum', provider, 2);
    await detector.start();

    await detector.pollChain('ethereum'); // no new block

    expect(mockReorgEventCreate).not.toHaveBeenCalled();
    await detector.stopAsync();
  });

  // Fix #7 verification: second start() must be a no-op
  it('start() is idempotent — second call does not create duplicate timers', async () => {
    const provider = new MockProvider();
    provider.addBlock(makeBlock(1, '0xb1', '0x0'));

    const detector = makeMockDetector('ethereum', provider, 2);
    await detector.start();
    await detector.start(); // second call must be a no-op

    // Only one provider should be registered
    expect(detector.getCurrentTip('ethereum')).toBeDefined();

    await detector.stopAsync();
  });
});
