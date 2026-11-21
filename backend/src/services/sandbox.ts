// Sandbox Environment Configuration for AgenticPay
// Enables testing without real transactions

import { Request, Response, NextFunction } from 'express';

export interface SandboxConfig {
  enabled: boolean;
  environment: 'sandbox' | 'testnet' | 'production';
  fakePaymentsEnabled: boolean;
  mockWebhooksEnabled: boolean;
  testDataSeedingEnabled: boolean;
  timelineAcceleration: number; // 1 = normal, 10 = 10x faster
}

export interface MockPaymentOptions {
  projectId: string;
  amount: number;
  clientAddress: string;
  freelancerAddress: string;
  status: 'pending' | 'success' | 'failed';
  delayMs?: number; // Artificial delay for testing
}

export interface TestDataSeed {
  projects: number;
  users: number;
  payments: number;
  invoices: number;
}

const SANDBOX_CONFIG: Record<string, SandboxConfig> = {
  development: {
    enabled: true,
    environment: 'sandbox',
    fakePaymentsEnabled: true,
    mockWebhooksEnabled: true,
    testDataSeedingEnabled: true,
    timelineAcceleration: 1,
  },
  sandbox: {
    enabled: true,
    environment: 'sandbox',
    fakePaymentsEnabled: true,
    mockWebhooksEnabled: true,
    testDataSeedingEnabled: true,
    timelineAcceleration: 1,
  },
  testnet: {
    enabled: true,
    environment: 'testnet',
    fakePaymentsEnabled: false,
    mockWebhooksEnabled: false,
    testDataSeedingEnabled: true,
    timelineAcceleration: 1,
  },
  production: {
    enabled: false,
    environment: 'production',
    fakePaymentsEnabled: false,
    mockWebhooksEnabled: false,
    testDataSeedingEnabled: false,
    timelineAcceleration: 1,
  },
};

export class SandboxManager {
  private config: SandboxConfig;
  private mockPayments: Map<string, any> = new Map();
  private testData: Map<string, any> = new Map();

  constructor(environment: string = 'sandbox') {
    this.config = SANDBOX_CONFIG[environment] || SANDBOX_CONFIG.development;
  }

  getConfig(): SandboxConfig {
    return this.config;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isSandboxMode(): boolean {
    return this.config.environment === 'sandbox';
  }

  /**
   * Process a mock payment in sandbox
   */
  async processMockPayment(options: MockPaymentOptions): Promise<{
    transactionId: string;
    status: string;
    timestamp: number;
  }> {
    if (!this.config.fakePaymentsEnabled) {
      throw new Error('Fake payments are not enabled in this environment');
    }

    const transactionId = `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Simulate processing delay
    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }

    const payment = {
      transactionId,
      projectId: options.projectId,
      amount: options.amount,
      clientAddress: options.clientAddress,
      freelancerAddress: options.freelancerAddress,
      status: options.status,
      timestamp: Date.now(),
      mockData: true,
    };

    this.mockPayments.set(transactionId, payment);

    return {
      transactionId,
      status: options.status,
      timestamp: Date.now(),
    };
  }

  /**
   * Get a mock payment status
   */
  getMockPayment(transactionId: string): any {
    return this.mockPayments.get(transactionId);
  }

  /**
   * Generate testnet wallet
   */
  generateTestnetWallet(): {
    address: string;
    privateKey: string;
    publicKey: string;
    seed: string;
  } {
    // Generate mock Stellar testnet wallet
    const randomBytes = Math.random().toString(36).substring(2, 15);
    const seed = `SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX${randomBytes}`;
    const address = `GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX${randomBytes}`;

    return {
      address,
      privateKey: seed,
      publicKey: address,
      seed,
    };
  }

  /**
   * Seed test data
   */
  async seedTestData(options: TestDataSeed): Promise<{
    projectCount: number;
    userCount: number;
    paymentCount: number;
    invoiceCount: number;
  }> {
    if (!this.config.testDataSeedingEnabled) {
      throw new Error('Test data seeding is not enabled in this environment');
    }

    const testData = {
      projectCount: options.projects,
      userCount: options.users,
      paymentCount: options.payments,
      invoiceCount: options.invoices,
      source: 'sandbox',
      timestamp: Date.now(),
    };

    this.testData.set('seed_metadata', testData);

    return {
      projectCount: options.projects,
      userCount: options.users,
      paymentCount: options.payments,
      invoiceCount: options.invoices,
    };
  }

  /**
   * Simulate webhook delivery
   */
  async simulateMockWebhook(
    event: string,
    data: any,
    webhookUrl?: string
  ): Promise<{ success: boolean; simulatedDelivery: boolean }> {
    if (!this.config.mockWebhooksEnabled) {
      throw new Error('Mock webhooks are not enabled in this environment');
    }

    // Simulate webhook event
    const webhookEvent = {
      event,
      data,
      timestamp: Date.now(),
      simulatedDelivery: true,
      deliveryUrl: webhookUrl || 'mock://webhook',
    };

    if (process.env.SANDBOX_LOG_WEBHOOKS === 'true') {
      console.log('📧 Mock Webhook Event:', webhookEvent);
    }

    return {
      success: true,
      simulatedDelivery: true,
    };
  }

  /**
   * Get sandbox info for API response
   */
  getSandboxInfo(): { environment: string; sandbox: boolean; features: string[] } {
    const features: string[] = [];
    if (this.config.fakePaymentsEnabled) features.push('fake-payments');
    if (this.config.mockWebhooksEnabled) features.push('mock-webhooks');
    if (this.config.testDataSeedingEnabled) features.push('test-data-seeding');

    return {
      environment: this.config.environment,
      sandbox: this.isSandboxMode(),
      features,
    };
  }

  /**
   * Clear all mock data
   */
  clear(): void {
    this.mockPayments.clear();
    this.testData.clear();
  }
}

/**
 * Middleware for sandbox environment detection and enhancement
 */
export function sandboxMiddleware(sandboxManager: SandboxManager) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Attach sandbox manager to request
    (req as any).sandbox = sandboxManager;

    // Add sandbox headers if enabled
    if (sandboxManager.isEnabled()) {
      res.setHeader('X-Sandbox-Mode', sandboxManager.isSandboxMode() ? 'true' : 'false');
      res.setHeader('X-Environment', sandboxManager.getConfig().environment);
    }

    next();
  };
}

export default SandboxManager;
