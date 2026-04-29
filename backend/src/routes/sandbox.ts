// Sandbox Routes - Testing and Development API Endpoints
// Provides sandbox-specific functionality for developer testing

import { Router, Request, Response } from 'express';
import SandboxManager from '../services/sandbox.js';
import MockPaymentProcessor from '../services/mock-payments.js';
import TestDataSeeder from '../services/test-data-seeder.js';

export function createSandboxRouter(
  sandboxManager: SandboxManager,
  mockPaymentProcessor: MockPaymentProcessor,
  testDataSeeder: TestDataSeeder
): Router {
  const router = Router();

  // ── Sandbox Status ─────────────────────────────────────────────────────────
  router.get('/status', (req: Request, res: Response) => {
    if (!sandboxManager.isEnabled()) {
      return res.status(403).json({
        error: 'Sandbox mode is not enabled in this environment',
      });
    }

    res.json({
      sandbox: true,
      environment: sandboxManager.getConfig().environment,
      features: sandboxManager.getSandboxInfo().features,
      timestamp: Date.now(),
    });
  });

  // ── Mock Payments ──────────────────────────────────────────────────────────
  router.post('/payments/process', async (req: Request, res: Response) => {
    try {
      if (!sandboxManager.getConfig().fakePaymentsEnabled) {
        return res.status(403).json({
          error: 'Fake payments are not enabled',
        });
      }

      const { projectId, clientAddress, freelancerAddress, amount, currency, delay } = req.body;

      if (!projectId || !clientAddress || !freelancerAddress || !amount) {
        return res.status(400).json({
          error: 'Missing required fields',
          required: ['projectId', 'clientAddress', 'freelancerAddress', 'amount'],
        });
      }

      const result = await mockPaymentProcessor.processPayment({
        projectId,
        clientAddress,
        freelancerAddress,
        amount,
        currency: currency || 'XLM',
        delay: delay || 100,
      });

      res.json({
        success: true,
        payment: result,
      });
    } catch (error) {
      res.status(500).json({
        error: (error as Error).message,
      });
    }
  });

  router.get('/payments/:transactionId', (req: Request, res: Response) => {
    const payment = mockPaymentProcessor.getPaymentStatus(req.params.transactionId);

    if (!payment) {
      return res.status(404).json({
        error: 'Payment not found',
      });
    }

    res.json({
      payment,
    });
  });

  router.post('/payments/:transactionId/reverse', async (req: Request, res: Response) => {
    try {
      const result = await mockPaymentProcessor.reversePayment(req.params.transactionId);
      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      res.status(500).json({
        error: (error as Error).message,
      });
    }
  });

  router.get('/payments', (req: Request, res: Response) => {
    const stats = mockPaymentProcessor.getStatistics();
    res.json({
      statistics: stats,
    });
  });

  // ── Test Data Seeding ──────────────────────────────────────────────────────
  router.post('/testdata/seed', async (req: Request, res: Response) => {
    try {
      if (!sandboxManager.getConfig().testDataSeedingEnabled) {
        return res.status(403).json({
          error: 'Test data seeding is not enabled',
        });
      }

      const { users = 5, projects = 10, payments = 20, invoices = 15 } = req.body;

      const result = await testDataSeeder.seedAll({
        users: Math.min(users, 100), // Cap at 100
        projects: Math.min(projects, 500),
        payments: Math.min(payments, 1000),
        invoices: Math.min(invoices, 500),
      });

      res.json({
        success: true,
        seeded: {
          userCount: result.users.length,
          projectCount: result.projects.length,
          paymentCount: result.payments.length,
          invoiceCount: result.invoices.length,
        },
      });
    } catch (error) {
      res.status(500).json({
        error: (error as Error).message,
      });
    }
  });

  router.get('/testdata/users', (req: Request, res: Response) => {
    const users = testDataSeeder.getUsers();
    res.json({
      count: users.length,
      users,
    });
  });

  router.get('/testdata/projects', (req: Request, res: Response) => {
    const projects = testDataSeeder.getProjects();
    res.json({
      count: projects.length,
      projects,
    });
  });

  router.get('/testdata/statistics', (req: Request, res: Response) => {
    const stats = testDataSeeder.getStatistics();
    res.json({
      statistics: stats,
    });
  });

  router.delete('/testdata/clear', (req: Request, res: Response) => {
    testDataSeeder.clear();
    mockPaymentProcessor.clear();
    sandboxManager.clear();

    res.json({
      success: true,
      message: 'All sandbox data cleared',
    });
  });

  // ── Wallets ────────────────────────────────────────────────────────────────
  router.post('/wallets/generate', (req: Request, res: Response) => {
    const wallet = sandboxManager.generateTestnetWallet();
    res.json({
      wallet,
      environment: 'testnet',
      fundingUrl: 'https://friendbot.stellar.org/?addr=' + wallet.address,
    });
  });

  // ── Mock Webhooks ──────────────────────────────────────────────────────────
  router.post('/webhooks/simulate', async (req: Request, res: Response) => {
    try {
      if (!sandboxManager.getConfig().mockWebhooksEnabled) {
        return res.status(403).json({
          error: 'Mock webhooks are not enabled',
        });
      }

      const { event, data, webhookUrl } = req.body;

      if (!event || !data) {
        return res.status(400).json({
          error: 'Missing required fields: event, data',
        });
      }

      const result = await sandboxManager.simulateMockWebhook(event, data, webhookUrl);

      res.json({
        success: true,
        webhook: result,
        event,
        dataSize: JSON.stringify(data).length,
      });
    } catch (error) {
      res.status(500).json({
        error: (error as Error).message,
      });
    }
  });

  // ── Environment Info ───────────────────────────────────────────────────────
  router.get('/info', (req: Request, res: Response) => {
    res.json({
      environment: sandboxManager.getConfig().environment,
      sandbox: sandboxManager.isEnabled(),
      features: {
        fakePayments: sandboxManager.getConfig().fakePaymentsEnabled,
        mockWebhooks: sandboxManager.getConfig().mockWebhooksEnabled,
        testDataSeeding: sandboxManager.getConfig().testDataSeedingEnabled,
      },
      endpoints: {
        payments: '/sandbox/payments/*',
        testdata: '/sandbox/testdata/*',
        wallets: '/sandbox/wallets/generate',
        webhooks: '/sandbox/webhooks/simulate',
      },
      documentation: 'https://docs.agenticpay.com/sandbox',
    });
  });

  return router;
}

export default createSandboxRouter;
