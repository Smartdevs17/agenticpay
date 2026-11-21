import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPaymentReadModel,
  getAllPayments,
  getProjectReadModel,
  getAllProjects,
  getVerificationReadModel,
  getAllVerifications,
  clearProjections,
  registerProjections,
  resetProjectionsRegistration,
} from './projections';
import { appendEvent, clearEventStore } from './event-store';
import { publish, clearHandlers } from './event-bus';
import { eventSchemaRegistry } from './schemas/index.js';
import type { StoredEvent } from './event-types';

describe('Projections', () => {
  beforeEach(() => {
    clearEventStore();
    clearProjections();
    // Bypass schema validation
    vi.spyOn(eventSchemaRegistry, 'hasSchema').mockReturnValue(false);
    // Ensure projections are registered (re-register if cleared by other tests)
    resetProjectionsRegistration();
    clearHandlers();
    registerProjections();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function publishAndWait(event: StoredEvent) {
    await publish(event);
    await new Promise((r) => setTimeout(r, 0));
  }

  describe('Payment Projection', () => {
    it('creates payment read model on payment.created', async () => {
      const event = appendEvent('payment', 'pay-1', 'payment.created', {
        from: 'A',
        to: 'B',
        amount: 100,
        asset: 'USDC',
      } as any);
      await publishAndWait(event);

      const model = getPaymentReadModel('pay-1');
      expect(model).toEqual(
        expect.objectContaining({
          paymentId: 'pay-1',
          from: 'A',
          to: 'B',
          amount: 100,
          asset: 'USDC',
          status: 'pending',
        })
      );
    });

    it('updates status to executed on payment.executed', async () => {
      const e1 = appendEvent('payment', 'pay-1', 'payment.created', {
        from: 'A',
        to: 'B',
        amount: 100,
        asset: 'USDC',
      } as any);
      await publishAndWait(e1);
      const e2 = appendEvent('payment', 'pay-1', 'payment.executed', {
        paymentId: 'pay-1',
        transactionHash: 'hash-1',
        amount: 100,
        asset: 'USDC',
      } as any);
      await publishAndWait(e2);

      const model = getPaymentReadModel('pay-1');
      expect(model?.status).toBe('executed');
    });

    it('updates status to failed on payment.failed', async () => {
      const e1 = appendEvent('payment', 'pay-1', 'payment.created', {
        from: 'A',
        to: 'B',
        amount: 100,
        asset: 'USDC',
      } as any);
      await publishAndWait(e1);
      const e2 = appendEvent('payment', 'pay-1', 'payment.failed', {
        paymentId: 'pay-1',
        reason: 'insufficient_funds',
        error: 'Not enough balance',
        retryable: true,
        retryCount: 0,
      } as any);
      await publishAndWait(e2);
      expect(getPaymentReadModel('pay-1')?.status).toBe('failed');
    });

    it('updates status to cancelled on payment.cancelled', async () => {
      const e1 = appendEvent('payment', 'pay-1', 'payment.created', {
        from: 'A',
        to: 'B',
        amount: 100,
        asset: 'USDC',
      } as any);
      await publishAndWait(e1);
      const e2 = appendEvent('payment', 'pay-1', 'payment.cancelled', {
        paymentId: 'pay-1',
        cancelledBy: 'user-1',
        cancelledAt: new Date().toISOString(),
      } as any);
      await publishAndWait(e2);
      expect(getPaymentReadModel('pay-1')?.status).toBe('cancelled');
    });

    it('returns undefined for non-existent payment', () => {
      expect(getPaymentReadModel('non-existent')).toBeUndefined();
    });

    it('getAllPayments returns all payments', async () => {
      const e1 = appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      await publishAndWait(e1);
      const e2 = appendEvent('payment', 'pay-2', 'payment.created', { from: 'C', to: 'D', amount: 200, asset: 'USDC' } as any);
      await publishAndWait(e2);

      expect(getAllPayments().length).toBe(2);
    });
  });

  describe('Project Projection', () => {
    it('creates project read model on project.created', async () => {
      const event = appendEvent('project', 'proj-1', 'project.created', {
        client: 'client-1',
        amount: 500,
      } as any);
      await publishAndWait(event);

      expect(getProjectReadModel('proj-1')).toEqual(
        expect.objectContaining({
          projectId: 'proj-1',
          client: 'client-1',
          amount: 500,
          status: 'created',
        })
      );
    });

    it('updates status to funded on project.funded', async () => {
      const e1 = appendEvent('project', 'proj-1', 'project.created', { client: 'client-1', amount: 500 } as any);
      await publishAndWait(e1);
      const e2 = appendEvent('project', 'proj-1', 'project.funded', {} as any);
      await publishAndWait(e2);
      expect(getProjectReadModel('proj-1')?.status).toBe('funded');
    });

    it('updates status and repoUrl on project.work_submitted', async () => {
      const e1 = appendEvent('project', 'proj-1', 'project.created', { client: 'client-1', amount: 500 } as any);
      await publishAndWait(e1);
      const e2 = appendEvent('project', 'proj-1', 'project.work_submitted', { repoUrl: 'https://github.com/test/repo' } as any);
      await publishAndWait(e2);
      const m = getProjectReadModel('proj-1');
      expect(m?.status).toBe('work_submitted');
      expect(m?.repoUrl).toBe('https://github.com/test/repo');
    });

    it('updates status to completed on project.work_approved', async () => {
      const e1 = appendEvent('project', 'proj-1', 'project.created', { client: 'client-1', amount: 500 } as any);
      await publishAndWait(e1);
      const e2 = appendEvent('project', 'proj-1', 'project.work_approved', {} as any);
      await publishAndWait(e2);
      expect(getProjectReadModel('proj-1')?.status).toBe('completed');
    });

    it('updates status to disputed on project.disputed', async () => {
      const e1 = appendEvent('project', 'proj-1', 'project.created', { client: 'client-1', amount: 500 } as any);
      await publishAndWait(e1);
      const e2 = appendEvent('project', 'proj-1', 'project.disputed', {} as any);
      await publishAndWait(e2);
      expect(getProjectReadModel('proj-1')?.status).toBe('disputed');
    });

    it('getAllProjects returns all projects', async () => {
      const e1 = appendEvent('project', 'proj-1', 'project.created', { client: 'client-1', amount: 500 } as any);
      await publishAndWait(e1);
      const e2 = appendEvent('project', 'proj-2', 'project.created', { client: 'client-2', amount: 300 } as any);
      await publishAndWait(e2);
      expect(getAllProjects().length).toBe(2);
    });
  });

  describe('Verification Projection', () => {
    it('creates verification read model on verification.requested', async () => {
      const event = appendEvent('verification', 'ver-1', 'verification.requested', {
        projectId: 'proj-1',
        repositoryUrl: 'https://github.com/test/repo',
      } as any);
      await publishAndWait(event);

      expect(getVerificationReadModel('ver-1')).toEqual(
        expect.objectContaining({
          verificationId: 'ver-1',
          projectId: 'proj-1',
          repositoryUrl: 'https://github.com/test/repo',
          status: 'requested',
        })
      );
    });

    it('updates status and score on verification.passed', async () => {
      const e1 = appendEvent('verification', 'ver-1', 'verification.requested', {
        projectId: 'proj-1',
        repositoryUrl: 'https://github.com/test/repo',
      } as any);
      await publishAndWait(e1);
      const e2 = appendEvent('verification', 'ver-1', 'verification.passed', { score: 95, summary: 'All checks passed' } as any);
      await publishAndWait(e2);
      const m = getVerificationReadModel('ver-1');
      expect(m?.status).toBe('passed');
      expect(m?.score).toBe(95);
    });

    it('updates status and score on verification.failed', async () => {
      const e1 = appendEvent('verification', 'ver-1', 'verification.requested', {
        projectId: 'proj-1',
        repositoryUrl: 'https://github.com/test/repo',
      } as any);
      await publishAndWait(e1);
      const e2 = appendEvent('verification', 'ver-1', 'verification.failed', { score: 40, summary: 'Tests failed' } as any);
      await publishAndWait(e2);
      const m = getVerificationReadModel('ver-1');
      expect(m?.status).toBe('failed');
      expect(m?.score).toBe(40);
    });

    it('getAllVerifications returns all verifications', async () => {
      const e1 = appendEvent('verification', 'ver-1', 'verification.requested', {
        projectId: 'proj-1',
        repositoryUrl: 'https://github.com/test/repo',
      } as any);
      await publishAndWait(e1);
      const e2 = appendEvent('verification', 'ver-2', 'verification.requested', {
        projectId: 'proj-2',
        repositoryUrl: 'https://github.com/test/repo2',
      } as any);
      await publishAndWait(e2);
      expect(getAllVerifications().length).toBe(2);
    });
  });

  describe('clearProjections', () => {
    it('clears all read models', async () => {
      const e1 = appendEvent('payment', 'pay-1', 'payment.created', { from: 'A', to: 'B', amount: 100, asset: 'USDC' } as any);
      await publishAndWait(e1);
      clearProjections();
      expect(getAllPayments().length).toBe(0);
      expect(getAllProjects().length).toBe(0);
      expect(getAllVerifications().length).toBe(0);
    });
  });
});
