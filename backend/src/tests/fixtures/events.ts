import type { StoredEvent, DomainEventType, EventMetadata } from '../../events/event-types.js';

export const createTestEvent = <T = Record<string, unknown>>(
  type: DomainEventType,
  aggregateId: string,
  payload: T,
  overrides: Partial<StoredEvent<T>> = {}
): StoredEvent<T> => ({
  id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  type,
  aggregateId,
  aggregateType: getAggregateTypeFromEventType(type),
  version: 1,
  payload,
  metadata: {} as EventMetadata,
  occurredAt: new Date().toISOString(),
  sequenceNumber: 1,
  streamId: `${getAggregateTypeFromEventType(type)}:${aggregateId}`,
  ...overrides,
});

function getAggregateTypeFromEventType(eventType: DomainEventType): string {
  const prefix = eventType.split('.')[0];
  return prefix === 'invoice' || prefix === 'receipt' || prefix === 'refund' || prefix === 'split'
    ? 'payment'
    : prefix;
}

export const paymentCreatedEvent = (overrides: Partial<StoredEvent> = {}) =>
  createTestEvent(
    'payment.created',
    'pay-1',
    {
      from: 'GABC123',
      to: 'GXYZ789',
      amount: 100.5,
      asset: 'USDC',
      trigger: { type: 'immediate' },
    },
    overrides
  );

export const paymentExecutedEvent = (overrides: Partial<StoredEvent> = {}) =>
  createTestEvent(
    'payment.executed',
    'pay-1',
    {
      paymentId: 'pay-1',
      transactionHash: 'tx-hash-123',
      amount: 100.5,
      asset: 'USDC',
      fee: 0.01,
    },
    overrides
  );

export const paymentFailedEvent = (overrides: Partial<StoredEvent> = {}) =>
  createTestEvent(
    'payment.failed',
    'pay-1',
    {
      paymentId: 'pay-1',
      reason: 'insufficient_funds',
      error: 'Insufficient balance',
      retryable: true,
      retryCount: 0,
    },
    overrides
  );

export const projectCreatedEvent = (overrides: Partial<StoredEvent> = {}) =>
  createTestEvent(
    'project.created',
    'proj-1',
    {
      client: 'client-1',
      freelancer: 'freelancer-1',
      amount: 5000,
      repoUrl: 'https://github.com/test/repo',
    },
    overrides
  );

export const verificationRequestedEvent = (overrides: Partial<StoredEvent> = {}) =>
  createTestEvent(
    'verification.requested',
    'ver-1',
    {
      projectId: 'proj-1',
      repositoryUrl: 'https://github.com/test/repo',
    },
    overrides
  );

export const batchEvents = () => [
  paymentCreatedEvent(),
  paymentExecutedEvent(),
  projectCreatedEvent(),
  verificationRequestedEvent(),
];