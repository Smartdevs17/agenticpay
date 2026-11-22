import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  emitEscrowTransition,
  mapEscrowTransitionToEventType,
  type EscrowTransition,
} from './escrow-events.js';
import { subscribe, clearHandlers } from './event-bus.js';
import { clearEventStore, getEventsForStream } from './event-store.js';

describe('Escrow Domain Events (#1420)', () => {
  beforeEach(() => {
    clearHandlers();
    clearEventStore();
  });

  const mockEscrow = {
    id: 'esc-123',
    projectId: 'proj-456',
    status: 'pending',
    amount: '500',
    asset: 'XLM',
  };

  it('exhaustively maps all transition variants to domain event types', () => {
    const transitions: Array<{ transition: EscrowTransition; expected: string }> = [
      {
        transition: { type: 'create', toStatus: 'pending', amount: '500', asset: 'XLM' },
        expected: 'escrow.created',
      },
      {
        transition: { type: 'fund', fromStatus: 'pending', toStatus: 'funded', txHash: 'tx-1' },
        expected: 'escrow.funded',
      },
      {
        transition: { type: 'dispute', fromStatus: 'funded', toStatus: 'disputed', raisedBy: 'client' },
        expected: 'escrow.disputed',
      },
      {
        transition: {
          type: 'resolve',
          fromStatus: 'disputed',
          toStatus: 'released',
          releaseType: 'release_to_freelancer',
          approvedBy: ['arb-1'],
        },
        expected: 'escrow.released',
      },
      {
        transition: {
          type: 'resolve',
          fromStatus: 'disputed',
          toStatus: 'refunded',
          releaseType: 'refund_to_client',
          approvedBy: ['arb-1'],
        },
        expected: 'escrow.refunded',
      },
      {
        transition: { type: 'appeal', fromStatus: 'disputed', toStatus: 'disputed', appealTarget: 'arb-2' },
        expected: 'escrow.appealed',
      },
      {
        transition: { type: 'timeout_release', fromStatus: 'disputed', toStatus: 'released', reason: 'timeout' },
        expected: 'escrow.released',
      },
      {
        transition: { type: 'expire', fromStatus: 'pending', toStatus: 'expired' },
        expected: 'escrow.expired',
      },
    ];

    for (const { transition, expected } of transitions) {
      expect(mapEscrowTransitionToEventType(transition)).toBe(expected);
    }
  });

  it('emits exactly one event with expected payload and stores it in event stream', async () => {
    const emittedEvents: any[] = [];
    subscribe('escrow.funded', (event) => {
      emittedEvents.push(event);
    });

    const transition: EscrowTransition = {
      type: 'fund',
      fromStatus: 'pending',
      toStatus: 'funded',
      txHash: '0xabc123',
    };

    const stored = await emitEscrowTransition(mockEscrow, transition);

    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0].type).toBe('escrow.funded');
    expect(emittedEvents[0].aggregateId).toBe(mockEscrow.id);
    expect(emittedEvents[0].payload.escrowId).toBe(mockEscrow.id);
    expect(emittedEvents[0].payload.fromStatus).toBe('pending');
    expect(emittedEvents[0].payload.toStatus).toBe('funded');
    expect(emittedEvents[0].payload.metadata?.txHash).toBe('0xabc123');

    // Verify persisted stream
    const stream = getEventsForStream(`escrow-${mockEscrow.id}`);
    expect(stream.length).toBe(1);
    expect(stream[0].id).toBe(stored.id);
  });

  it('a throwing subscriber handler does not abort or undo the transition', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    subscribe('escrow.disputed', () => {
      throw new Error('Subscriber webhook failed');
    });

    const transition: EscrowTransition = {
      type: 'dispute',
      fromStatus: 'funded',
      toStatus: 'disputed',
      raisedBy: 'client-addr',
    };

    // Does not throw despite handler failure
    const stored = await emitEscrowTransition(mockEscrow, transition);
    expect(stored).toBeDefined();
    expect(stored.type).toBe('escrow.disputed');

    errorSpy.mockRestore();
  });

  it('maintains ordering across multiple state transitions', async () => {
    const eventOrder: string[] = [];
    subscribe('escrow.created', () => eventOrder.push('created'));
    subscribe('escrow.funded', () => eventOrder.push('funded'));
    subscribe('escrow.released', () => eventOrder.push('released'));

    await emitEscrowTransition(mockEscrow, {
      type: 'create',
      toStatus: 'pending',
      amount: '500',
      asset: 'XLM',
    });

    await emitEscrowTransition(mockEscrow, {
      type: 'fund',
      fromStatus: 'pending',
      toStatus: 'funded',
      txHash: '0x1',
    });

    await emitEscrowTransition(mockEscrow, {
      type: 'resolve',
      fromStatus: 'disputed',
      toStatus: 'released',
      releaseType: 'release_to_freelancer',
      approvedBy: ['arb-1'],
    });

    expect(eventOrder).toEqual(['created', 'funded', 'released']);
  });
});
