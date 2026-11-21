// Sandbox Routes - Testing and Development API Endpoints
// Provides sandbox-specific functionality for developer testing

import { Router, Request, Response } from 'express';
import SandboxManager from '../services/sandbox.js';
import MockPaymentProcessor from '../services/mock-payments.js';
import TestDataSeeder from '../services/test-data-seeder.js';
import MockBlockchainService from '../services/mock-blockchain.js';
import SandboxDatabaseService from '../services/sandbox-db.js';
import SandboxMigrationWizard from '../services/sandbox-migration.js';

export function createSandboxRouter(
  sandboxManager: SandboxManager,
  mockPaymentProcessor: MockPaymentProcessor,
  testDataSeeder: TestDataSeeder
): Router {
  const router = Router();
  const mockBlockchain = new MockBlockchainService();
  const sandboxDb = new SandboxDatabaseService();
  const migrationWizard = new SandboxMigrationWizard();

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
        accounts: '/sandbox/accounts/*',
        blockchain: '/sandbox/blockchain/*',
        migration: '/sandbox/migration/*',
      },
      documentation: 'https://docs.agenticpay.com/sandbox',
    });
  });

  // ── Sandbox Accounts (Database-backed) ────────────────────────────────────
  router.post('/accounts', async (req: Request, res: Response) => {
    try {
      const { tenantId, userId, name, email, walletAddress, fakeBalance, currency, expiresAt } = req.body;

      if (!tenantId || !name || !email || !walletAddress || !fakeBalance) {
        return res.status(400).json({
          error: 'Missing required fields',
          required: ['tenantId', 'name', 'email', 'walletAddress', 'fakeBalance'],
        });
      }

      const account = await sandboxDb.createAccount({
        tenantId,
        userId,
        name,
        email,
        walletAddress,
        fakeBalance,
        currency,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      });

      res.json({
        success: true,
        account,
      });
    } catch (error) {
      res.status(500).json({
        error: (error as Error).message,
      });
    }
  });

  router.get('/accounts/:id', async (req: Request, res: Response) => {
    try {
      const account = await sandboxDb.getAccountById(req.params.id);
      if (!account) {
        return res.status(404).json({ error: 'Account not found' });
      }
      res.json({ account });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/accounts', async (req: Request, res: Response) => {
    try {
      const { tenantId, activeOnly } = req.query;
      if (!tenantId) {
        return res.status(400).json({ error: 'tenantId is required' });
      }
      const accounts = await sandboxDb.listAccountsByTenant(tenantId as string, {
        activeOnly: activeOnly === 'true',
      });
      res.json({ accounts });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.patch('/accounts/:id/balance', async (req: Request, res: Response) => {
    try {
      const { balance } = req.body;
      if (typeof balance !== 'number') {
        return res.status(400).json({ error: 'balance must be a number' });
      }
      const account = await sandboxDb.updateAccountBalance(req.params.id, balance);
      res.json({ success: true, account });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.delete('/accounts/:id', async (req: Request, res: Response) => {
    try {
      await sandboxDb.deleteAccount(req.params.id);
      res.json({ success: true, message: 'Account deleted' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ── Mock Blockchain Operations ──────────────────────────────────────────────
  router.post('/blockchain/submit', async (req: Request, res: Response) => {
    try {
      const { fromAddress, toAddress, amount, currency, memo } = req.body;

      if (!fromAddress || !toAddress || !amount) {
        return res.status(400).json({
          error: 'Missing required fields',
          required: ['fromAddress', 'toAddress', 'amount'],
        });
      }

      const result = await mockBlockchain.submitTransaction({
        fromAddress,
        toAddress,
        amount,
        currency,
        memo,
      });

      res.json({
        success: true,
        transaction: result,
      });
    } catch (error) {
      res.status(500).json({
        error: (error as Error).message,
      });
    }
  });

  router.get('/blockchain/tx/:txHash', (req: Request, res: Response) => {
    const tx = mockBlockchain.getTransaction(req.params.txHash);
    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json({ transaction: tx });
  });

  router.get('/blockchain/account/:address', (req: Request, res: Response) => {
    const account = mockBlockchain.getAccount(req.params.address);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json({ account });
  });

  router.post('/blockchain/account/:address/fund', (req: Request, res: Response) => {
    const { amount } = req.body;
    const account = mockBlockchain.fundAccount(req.params.address, amount || 10000);
    res.json({ success: true, account });
  });

  router.get('/blockchain/stats', (req: Request, res: Response) => {
    const stats = mockBlockchain.getNetworkStats();
    res.json({ stats });
  });

  // ── Sandbox Migration Wizard ────────────────────────────────────────────────
  router.post('/migration/start', async (req: Request, res: Response) => {
    try {
      const { tenantId, sourceAccountId, targetUserId, migrateTransactions, dryRun } = req.body;

      if (!tenantId || !sourceAccountId) {
        return res.status(400).json({
          error: 'Missing required fields',
          required: ['tenantId', 'sourceAccountId'],
        });
      }

      const result = await migrationWizard.startMigration({
        tenantId,
        sourceAccountId,
        targetUserId,
        migrateTransactions: migrateTransactions !== false,
        dryRun: dryRun || false,
      });

      res.json({
        success: true,
        migration: result,
      });
    } catch (error) {
      res.status(500).json({
        error: (error as Error).message,
      });
    }
  });

  router.get('/migration/:id', async (req: Request, res: Response) => {
    try {
      const migration = await migrationWizard.getMigrationStatus(req.params.id);
      if (!migration) {
        return res.status(404).json({ error: 'Migration not found' });
      }
      res.json({ migration });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/migration', async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.query;
      if (!tenantId) {
        return res.status(400).json({ error: 'tenantId is required' });
      }
      const migrations = await migrationWizard.listMigrations(tenantId as string);
      res.json({ migrations });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/migration/:id/cancel', async (req: Request, res: Response) => {
    try {
      await migrationWizard.cancelMigration(req.params.id);
      res.json({ success: true, message: 'Migration cancelled' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ── Sandbox Statistics ──────────────────────────────────────────────────────
  router.get('/stats', async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.query;
      if (!tenantId) {
        return res.status(400).json({ error: 'tenantId is required' });
      }
      const stats = await sandboxDb.getTenantStatistics(tenantId as string);
      res.json({ stats });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}

export default createSandboxRouter;
