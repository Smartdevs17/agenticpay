/**
 * backend/src/repositories/__tests__/repositories.test.ts
 *
 * Unit and characterization tests for the repository layer under Issue #1404.
 * Tests repositories against a hand-written fake Prisma client asserting
 * exact query arguments, transaction scoping, and service error propagation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentRepository } from '../PaymentRepository.js';
import { UserRepository } from '../UserRepository.js';
import { InvoiceRepository } from '../InvoiceRepository.js';
import { WebhookRepository } from '../WebhookRepository.js';
import { NotificationRepository } from '../NotificationRepository.js';
import { SandboxRepository } from '../SandboxRepository.js';
import { runInTransaction } from '../index.js';

describe('Issue #1404: Repository Layer Tests', () => {
  let fakePrisma: any;

  beforeEach(() => {
    fakePrisma = {
      payment: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      },
      invoice: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      },
      webhook: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      pushSubscription: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      pushPreference: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      notificationLog: {
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
      sandboxAccount: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        deleteMany: vi.fn(),
        count: vi.fn(),
        aggregate: vi.fn(),
      },
      sandboxTransaction: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
        deleteMany: vi.fn(),
        count: vi.fn(),
      },
      $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(fakePrisma)),
    };
  });

  describe('PaymentRepository', () => {
    it('executes findById with verbatim where clause', async () => {
      fakePrisma.payment.findUnique.mockResolvedValue({ id: 'pay_123', amount: 100 });
      const repo = new PaymentRepository(fakePrisma);

      const result = await repo.findById('pay_123');

      expect(fakePrisma.payment.findUnique).toHaveBeenCalledWith({
        where: { id: 'pay_123' },
      });
      expect(result).toEqual({ id: 'pay_123', amount: 100 });
    });

    it('executes create with exact payload verbatim', async () => {
      const payload = {
        amount: 250,
        currency: 'XLM',
        status: 'pending',
        txHash: 'hash_abc',
      };
      fakePrisma.payment.create.mockResolvedValue({ id: 'pay_new', ...payload });
      const repo = new PaymentRepository(fakePrisma);

      const created = await repo.create(payload);

      expect(fakePrisma.payment.create).toHaveBeenCalledWith({
        data: payload,
      });
      expect(created.id).toBe('pay_new');
    });

    it('executes updateStatus verbatim', async () => {
      fakePrisma.payment.update.mockResolvedValue({ id: 'pay_1', status: 'completed' });
      const repo = new PaymentRepository(fakePrisma);

      await repo.updateStatus('pay_1', 'completed', 'tx_xyz');

      expect(fakePrisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay_1' },
        data: { status: 'completed', txHash: 'tx_xyz' },
      });
    });

    it('binds to an active transaction client via withTransaction', async () => {
      const fakeTxClient = { payment: { findUnique: vi.fn() } };
      const repo = new PaymentRepository(fakePrisma);
      const txRepo = repo.withTransaction(fakeTxClient as any);

      await txRepo.findById('pay_tx_1');

      expect(fakeTxClient.payment.findUnique).toHaveBeenCalledWith({
        where: { id: 'pay_tx_1' },
      });
      expect(fakePrisma.payment.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('UserRepository', () => {
    it('executes findByEmail with exact where clause', async () => {
      fakePrisma.user.findUnique.mockResolvedValue({ id: 'usr_1', email: 'test@example.com' });
      const repo = new UserRepository(fakePrisma);

      const user = await repo.findByEmail('test@example.com');

      expect(fakePrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(user?.id).toBe('usr_1');
    });

    it('executes create verbatim', async () => {
      fakePrisma.user.create.mockResolvedValue({ id: 'usr_2', email: 'alice@example.com' });
      const repo = new UserRepository(fakePrisma);

      await repo.create({ email: 'alice@example.com', role: 'admin' });

      expect(fakePrisma.user.create).toHaveBeenCalledWith({
        data: { email: 'alice@example.com', role: 'admin' },
      });
    });
  });

  describe('InvoiceRepository', () => {
    it('executes listByMerchant with order and pagination', async () => {
      fakePrisma.invoice.findMany.mockResolvedValue([]);
      const repo = new InvoiceRepository(fakePrisma);

      await repo.listByMerchant('merch_1', 25, 5);

      expect(fakePrisma.invoice.findMany).toHaveBeenCalledWith({
        where: { merchantId: 'merch_1' },
        take: 25,
        skip: 5,
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('WebhookRepository', () => {
    it('executes listActive with exact active filter', async () => {
      fakePrisma.webhook.findMany.mockResolvedValue([]);
      const repo = new WebhookRepository(fakePrisma);

      await repo.listActive();

      expect(fakePrisma.webhook.findMany).toHaveBeenCalledWith({
        where: { active: true },
      });
    });
  });

  describe('NotificationRepository', () => {
    it('creates notification log verbatim', async () => {
      fakePrisma.notificationLog.create.mockResolvedValue({ id: 'log_1' });
      const repo = new NotificationRepository(fakePrisma);

      await repo.createNotificationLog({ data: { title: 'Payment received' } });

      expect(fakePrisma.notificationLog.create).toHaveBeenCalledWith({
        data: { title: 'Payment received' },
      });
    });
  });

  describe('SandboxRepository', () => {
    it('executes findExpiredAccounts with verbatim query', async () => {
      const now = new Date();
      fakePrisma.sandboxAccount.findMany.mockResolvedValue([]);
      const repo = new SandboxRepository(fakePrisma);

      await repo.findExpiredAccounts(now);

      expect(fakePrisma.sandboxAccount.findMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lte: now },
          isActive: true,
        },
      });
    });
  });

  describe('Atomic Transaction Support (runInTransaction)', () => {
    it('runs multi-repository operations atomically within a transaction', async () => {
      const result = await runInTransaction(async (repos) => {
        expect(repos.payment).toBeInstanceOf(PaymentRepository);
        expect(repos.user).toBeInstanceOf(UserRepository);
        expect(repos.invoice).toBeInstanceOf(InvoiceRepository);
        return 'transaction-success';
      }, fakePrisma);

      expect(fakePrisma.$transaction).toHaveBeenCalledOnce();
      expect(result).toBe('transaction-success');
    });

    it('rolls back on repository error in transaction', async () => {
      fakePrisma.$transaction.mockImplementation(async (cb: any) => {
        return cb(fakePrisma);
      });

      const txPromise = runInTransaction(async () => {
        throw new Error('Simulated atomic failure');
      }, fakePrisma);

      await expect(txPromise).rejects.toThrow('Simulated atomic failure');
    });
  });
});
