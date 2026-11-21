import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock heavy deps before importing modules under test ──────────────────────
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    payment: {
      create: vi.fn().mockResolvedValue({ id: 'pay-1', status: 'pending' }),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

vi.mock('../../events/event-bus.js', () => ({
  publish: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn(),
  subscribeAll: vi.fn(),
  clearHandlers: vi.fn(),
}));

vi.mock('../../db/replica-router.js', () => ({
  replicaRouter: {},
  ReplicaRouter: class {},
  createReplicaMiddleware: vi.fn(),
}));

vi.mock('../../events/projections.js', () => ({
  getPaymentReadModel: vi.fn().mockReturnValue(undefined),
  getAllPayments: vi.fn().mockReturnValue([]),
  getProjectReadModel: vi.fn().mockReturnValue(undefined),
  getAllProjects: vi.fn().mockReturnValue([]),
  getVerificationReadModel: vi.fn().mockReturnValue(undefined),
  getAllVerifications: vi.fn().mockReturnValue([]),
}));

import { registerCommandHandler, executeCommand } from '../command-bus.js';
import { registerQueryHandler, executeQuery } from '../query-bus.js';

describe('CQRS command-bus', () => {
  it('throws when no handler registered', async () => {
    await expect(executeCommand({ _type: 'UnknownCommand' })).rejects.toThrow(
      'No handler registered for command: UnknownCommand'
    );
  });

  it('executes registered command handler', async () => {
    registerCommandHandler<{ _type: 'TestCmd'; value: number }, number>('TestCmd', async (cmd) => cmd.value * 2);
    const result = await executeCommand<number>({ _type: 'TestCmd', value: 21 } as never);
    expect(result).toBe(42);
  });
});

describe('CQRS query-bus', () => {
  it('throws when no handler registered', async () => {
    await expect(executeQuery({ _type: 'UnknownQuery' })).rejects.toThrow(
      'No handler registered for query: UnknownQuery'
    );
  });

  it('executes registered query handler', async () => {
    registerQueryHandler<{ _type: 'PingQuery' }, string>('PingQuery', async () => 'pong');
    const result = await executeQuery<string>({ _type: 'PingQuery' } as never);
    expect(result).toBe('pong');
  });
});
