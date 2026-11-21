import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventStore, resetEventStoreForTesting } from '../event-store.js';
import { TransactionAggregate } from '../transaction-aggregate.js';
import { TransactionProjector, resetTransactionProjectorForTesting } from '../transaction-projector.js';
import { Projection, ProjectionManager, resetProjectionManagerForTesting } from '../projection.js';
import type { StoredEvent } from '../types.js';

function getFreshStore(): EventStore {
  resetEventStoreForTesting();
  return new EventStore();
}

describe('EventStore', () => {
  beforeEach(() => {
    resetEventStoreForTesting();
  });

  afterEach(async () => {
    const store = new EventStore();
    await store.clear();
  });

  it('appends an event and returns it', async () => {
    const store = getFreshStore();
    const result = await store.append('transaction', 'txn_1', 'TransactionCreated', {
      amount: 100,
      currency: 'XLM',
      toAddress: 'GABC',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.eventType).toBe('TransactionCreated');
      expect(result.value.aggregateId).toBe('txn_1');
      expect(result.value.version).toBe(1);
    }
  });

  it('reads the event stream for an aggregate', async () => {
    const store = getFreshStore();
    await store.append('transaction', 'txn_1', 'TransactionCreated', { amount: 100 });
    await store.append('transaction', 'txn_1', 'PaymentAuthorized', { providerId: 'stripe' });

    const stream = await store.getStream('txn_1');
    expect(stream.length).toBe(2);
    expect(stream[0].eventType).toBe('TransactionCreated');
    expect(stream[1].eventType).toBe('PaymentAuthorized');
    expect(stream[1].version).toBe(2);
  });

  it('returns empty stream for unknown aggregate', async () => {
    const store = getFreshStore();
    const stream = await store.getStream('nonexistent');
    expect(stream).toEqual([]);
  });

  it('rejects concurrent writes with wrong expected version', async () => {
    const store = getFreshStore();
    await store.append('transaction', 'txn_2', 'TransactionCreated', { amount: 100 });
    const result = await store.append('transaction', 'txn_2', 'PaymentAuthorized', { providerId: 'x' }, { expectedVersion: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CONCURRENCY_CONFLICT');
  });

  it('accepts concurrent writes with correct expected version', async () => {
    const store = getFreshStore();
    await store.append('transaction', 'txn_3', 'TransactionCreated', { amount: 100 });
    const result = await store.append('transaction', 'txn_3', 'PaymentAuthorized', { providerId: 'x' }, { expectedVersion: 1 });
    expect(result.ok).toBe(true);
  });

  it('getMetrics returns serialisable shape', async () => {
    const store = getFreshStore();
    await store.append('transaction', 'txn_4', 'TransactionCreated', { amount: 100 });
    const metrics = await store.getMetrics();
    expect(typeof metrics.totalEvents).toBe('number');
    expect(typeof metrics.eventsByType).toBe('object');
    expect(typeof metrics.aggregatesByType).toBe('object');
    expect(() => JSON.stringify(metrics)).not.toThrow();
  });

  it('clear removes all events', async () => {
    const store = getFreshStore();
    await store.append('transaction', 'txn_5', 'TransactionCreated', { amount: 100 });
    await store.clear();
    const stream = await store.getStream('txn_5');
    expect(stream).toEqual([]);
  });
});

describe('TransactionAggregate', () => {
  beforeEach(() => {
    resetEventStoreForTesting();
    resetTransactionProjectorForTesting();
  });

  afterEach(async () => {
    const store = new EventStore();
    await store.clear();
  });

  it('creates a transaction via event sourcing', async () => {
    const txn = new TransactionAggregate('txn-create-1');
    const result = await txn.createTransaction({
      amount: 250,
      currency: 'USDC',
      toAddress: 'GABC',
      network: 'stellar',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('pending');
      expect(result.value.amount).toBe(250);
      expect(result.value.currency).toBe('USDC');
    }
    expect(txn.getVersion()).toBe(1);
  });

  it('rejects creating a duplicate transaction', async () => {
    const txn = new TransactionAggregate('txn-dup-1');
    await txn.createTransaction({ amount: 50, currency: 'XLM', toAddress: 'GABC' });
    const result = await txn.createTransaction({ amount: 50, currency: 'XLM', toAddress: 'GABC' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TRANSACTION_ALREADY_EXISTS');
  });

  it('rejects invalid amount', async () => {
    const txn = new TransactionAggregate('txn-invalid-1');
    const result = await txn.createTransaction({ amount: -10, currency: 'XLM', toAddress: 'GABC' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_AMOUNT');
  });

  it('authorizes then captures a payment', async () => {
    const txn = new TransactionAggregate('txn-auth-1');
    await txn.createTransaction({ amount: 100, currency: 'XLM', toAddress: 'GABC' });

    const auth = await txn.authorizePayment({ providerId: 'stripe', txHash: 'hash_1' });
    expect(auth.ok).toBe(true);
    if (auth.ok) expect(auth.value.status).toBe('authorized');

    const cap = await txn.capturePayment();
    expect(cap.ok).toBe(true);
    if (cap.ok) expect(cap.value.status).toBe('captured');
  });

  it('rejects capture before authorization', async () => {
    const txn = new TransactionAggregate('txn-cap-1');
    await txn.createTransaction({ amount: 100, currency: 'XLM', toAddress: 'GABC' });
    const result = await txn.capturePayment();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_TRANSITION');
  });

  it('fails a payment and records reason', async () => {
    const txn = new TransactionAggregate('txn-fail-1');
    await txn.createTransaction({ amount: 100, currency: 'XLM', toAddress: 'GABC' });
    const result = await txn.failPayment('insufficient_funds');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('failed');
  });

  it('refunds a captured transaction', async () => {
    const txn = new TransactionAggregate('txn-refund-1');
    await txn.createTransaction({ amount: 100, currency: 'XLM', toAddress: 'GABC' });
    await txn.authorizePayment({ providerId: 'stripe' });
    await txn.capturePayment();

    const result = await txn.refund({ amount: 40 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.refundedAmount).toBe(40);
      expect(result.value.status).toBe('partially_refunded');
    }
  });

  it('rejects refund exceeding remaining amount', async () => {
    const txn = new TransactionAggregate('txn-refund-over-1');
    await txn.createTransaction({ amount: 100, currency: 'XLM', toAddress: 'GABC' });
    await txn.authorizePayment({ providerId: 'stripe' });
    await txn.capturePayment();
    await txn.refund({ amount: 60 });

    const result = await txn.refund({ amount: 50 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('REFUND_EXCEEDS_AMOUNT');
  });

  it('cancels a pending transaction', async () => {
    const txn = new TransactionAggregate('txn-cancel-1');
    await txn.createTransaction({ amount: 100, currency: 'XLM', toAddress: 'GABC' });
    const result = await txn.cancel();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('cancelled');
  });

  it('rejects cancelling a non-pending transaction', async () => {
    const txn = new TransactionAggregate('txn-cannot-cancel-1');
    await txn.createTransaction({ amount: 100, currency: 'XLM', toAddress: 'GABC' });
    await txn.cancel();
    const result = await txn.cancel();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_TRANSITION');
  });

  it('rehydrates state by replaying events', async () => {
    const store = new EventStore();
    await store.append('transaction', 'txn-rehydrate-1', 'TransactionCreated', { amount: 300, currency: 'XLM', toAddress: 'GABC' });
    await store.append('transaction', 'txn-rehydrate-1', 'PaymentAuthorized', { providerId: 'stripe' });

    const txn = new TransactionAggregate('txn-rehydrate-1');
    await txn.load();
    expect(txn.getVersion()).toBe(2);
    expect(txn.getState().status).toBe('authorized');
    expect(txn.getState().amount).toBe(300);
  });

  it('exposes uncommitted events after a commit', async () => {
    const txn = new TransactionAggregate('txn-uncommitted-1');
    await txn.createTransaction({ amount: 50, currency: 'XLM', toAddress: 'GABC' });
    const uncommitted = txn.getUncommitted();
    expect(uncommitted.length).toBeGreaterThan(0);
    txn.markCommitted();
    expect(txn.getUncommitted()).toEqual([]);
  });
});

describe('TransactionProjector', () => {
  beforeEach(() => {
    resetEventStoreForTesting();
    resetTransactionProjectorForTesting();
  });

  afterEach(async () => {
    const store = new EventStore();
    await store.clear();
  });

  it('projects TransactionCreated into a read model', async () => {
    const projector = getTransactionProjector();
    await projector.project({
      id: 'evt_proj_1',
      aggregateType: 'transaction',
      aggregateId: 'txn-proj-1',
      eventType: 'TransactionCreated',
      payload: { amount: 77, currency: 'USD', toAddress: 'GABC', network: 'stellar' },
      version: 1,
      occurredAt: new Date().toISOString(),
      sequenceNumber: 1,
    });

    const model = projector.getReadModel('txn-proj-1');
    expect(model).toBeDefined();
    if (model) {
      expect(model.status).toBe('pending');
      expect(model.amount).toBe(77);
      expect(model.currency).toBe('USD');
    }
  });

  it('updates read model on PaymentAuthorized', async () => {
    const projector = getTransactionProjector();
    await projector.project({
      id: 'evt_proj_2', aggregateType: 'transaction', aggregateId: 'txn-proj-2',
      eventType: 'TransactionCreated', payload: { amount: 10, currency: 'XLM', toAddress: 'GABC' },
      version: 1, occurredAt: new Date().toISOString(), sequenceNumber: 1,
    });
    await projector.project({
      id: 'evt_proj_3', aggregateType: 'transaction', aggregateId: 'txn-proj-2',
      eventType: 'PaymentAuthorized', payload: { providerId: 'stripe', txHash: 'hash_9' },
      version: 2, occurredAt: new Date().toISOString(), sequenceNumber: 2,
    });

    const model = projector.getReadModel('txn-proj-2');
    expect(model?.status).toBe('authorized');
    expect(model?.providerId).toBe('stripe');
    expect(model?.txHash).toBe('hash_9');
  });

  it('returns undefined for unknown aggregate', () => {
    const projector = getTransactionProjector();
    expect(projector.getReadModel('nope')).toBeUndefined();
  });
});

describe('ProjectionManager', () => {
  beforeEach(() => {
    resetProjectionManagerForTesting();
    resetEventStoreForTesting();
  });

  afterEach(async () => {
    const store = new EventStore();
    await store.clear();
  });

  it('registers and replays events into projections', async () => {
    class CountingProjection extends Projection {
      protected readonly name = 'counting';
      protected readonly eventTypes = ['TransactionCreated'];
      count = 0;
      getReadModel(_id: string) { return this.count; }
      private onTransactionCreated() { this.count++; }
    }

    const manager = getProjectionManager();
    const proj = new CountingProjection();
    manager.register(proj);

    const store = new EventStore();
    await store.append('transaction', 'txn-mgr-1', 'TransactionCreated', { amount: 1 });
    await store.append('transaction', 'txn-mgr-2', 'TransactionCreated', { amount: 2 });

    await manager.replay();
    expect(proj.getReadModel('any')).toBe(2);
  });
});

describe('types', () => {
  it('StoredEvent shape is valid', () => {
    const evt: StoredEvent = {
      id: 'evt_1',
      aggregateType: 'transaction',
      aggregateId: 'txn_1',
      eventType: 'TransactionCreated',
      payload: { amount: 100, currency: 'XLM', toAddress: 'GABC', network: 'stellar' },
      version: 1,
      occurredAt: new Date().toISOString(),
      sequenceNumber: 1,
    };
    expect(evt.aggregateType).toBe('transaction');
    expect(evt.eventType).toBe('TransactionCreated');
    expect(typeof evt.sequenceNumber).toBe('number');
  });
});
