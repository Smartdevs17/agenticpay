// Sandbox-to-Production Migration Wizard
// Handles migrating sandbox accounts and data to production environment

import { PrismaClient } from '@prisma/client';
import SandboxDatabaseService from './sandbox-db.js';

const prisma = new PrismaClient();

export interface MigrationStep {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface MigrationOptions {
  tenantId: string;
  sourceAccountId: string;
  targetUserId?: string;
  migrateTransactions: boolean;
  dryRun: boolean;
}

export interface MigrationResult {
  migrationId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  steps: MigrationStep[];
  summary: {
    accountsMigrated: number;
    transactionsMigrated: number;
    errors: number;
  };
}

export class SandboxMigrationWizard {
  private sandboxDb: SandboxDatabaseService;

  constructor() {
    this.sandboxDb = new SandboxDatabaseService();
  }

  /**
   * Start a migration from sandbox to production
   */
  async startMigration(options: MigrationOptions): Promise<MigrationResult> {
    const migration = await prisma.sandboxMigration.create({
      data: {
        tenantId: options.tenantId,
        sourceAccountId: options.sourceAccountId,
        targetAccountId: options.targetUserId,
        status: 'in_progress',
        steps: [],
      },
    });

    const steps: MigrationStep[] = [
      {
        id: 'validate_source',
        name: 'Validate Source Account',
        description: 'Verify sandbox account exists and is valid',
        status: 'pending',
      },
      {
        id: 'validate_target',
        name: 'Validate Target Account',
        description: 'Verify production user account exists',
        status: 'pending',
      },
      {
        id: 'export_data',
        name: 'Export Sandbox Data',
        description: 'Export all sandbox account data',
        status: 'pending',
      },
      {
        id: 'transform_data',
        name: 'Transform Data',
        description: 'Transform sandbox data for production',
        status: 'pending',
      },
      {
        id: 'import_data',
        name: 'Import to Production',
        description: 'Import transformed data to production',
        status: 'pending',
      },
      {
        id: 'verify_migration',
        name: 'Verify Migration',
        description: 'Verify data integrity after migration',
        status: 'pending',
      },
    ];

    const result: MigrationResult = {
      migrationId: migration.id,
      status: 'in_progress',
      steps,
      summary: {
        accountsMigrated: 0,
        transactionsMigrated: 0,
        errors: 0,
      },
    };

    if (options.dryRun) {
      console.log('[Migration] Dry run mode - no changes will be made');
    }

    try {
      // Execute migration steps
      for (const step of steps) {
        await this.executeStep(step, options, result);
        
        // Update migration record with current steps
        await prisma.sandboxMigration.update({
          where: { id: migration.id },
          data: {
            steps: result.steps,
          },
        });
      }

      result.status = 'completed';
      await prisma.sandboxMigration.update({
        where: { id: migration.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          steps: result.steps,
        },
      });
    } catch (error) {
      result.status = 'failed';
      await prisma.sandboxMigration.update({
        where: { id: migration.id },
        data: {
          status: 'failed',
          error: (error as Error).message,
          steps: result.steps,
        },
      });
      throw error;
    }

    return result;
  }

  /**
   * Execute a single migration step
   */
  private async executeStep(
    step: MigrationStep,
    options: MigrationOptions,
    result: MigrationResult
  ): Promise<void> {
    step.status = 'in_progress';
    step.startedAt = new Date();

    try {
      switch (step.id) {
        case 'validate_source':
          await this.validateSourceAccount(options.sourceAccountId);
          break;
        case 'validate_target':
          await this.validateTargetAccount(options.tenantId, options.targetUserId);
          break;
        case 'export_data':
          await this.exportSandboxData(options.sourceAccountId, result);
          break;
        case 'transform_data':
          await this.transformData(result);
          break;
        case 'import_data':
          if (!options.dryRun) {
            await this.importToProduction(options, result);
          } else {
            console.log('[Migration] Skipping import in dry run mode');
          }
          break;
        case 'verify_migration':
          await this.verifyMigration(result);
          break;
      }

      step.status = 'completed';
      step.completedAt = new Date();
    } catch (error) {
      step.status = 'failed';
      step.error = (error as Error).message;
      result.summary.errors++;
      throw error;
    }
  }

  /**
   * Validate source sandbox account
   */
  private async validateSourceAccount(accountId: string): Promise<void> {
    const account = await this.sandboxDb.getAccountById(accountId);
    if (!account) {
      throw new Error(`Source sandbox account ${accountId} not found`);
    }
    if (!account.isActive) {
      throw new Error(`Source sandbox account ${accountId} is not active`);
    }
    console.log(`[Migration] Validated source account: ${account.email}`);
  }

  /**
   * Validate target production account
   */
  private async validateTargetAccount(tenantId: string, userId?: string): Promise<void> {
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        throw new Error(`Target user ${userId} not found`);
      }
      if (user.tenantId !== tenantId) {
        throw new Error(`Target user ${userId} does not belong to tenant ${tenantId}`);
      }
      console.log(`[Migration] Validated target user: ${user.email}`);
    } else {
      console.log('[Migration] No target user specified, will create new user');
    }
  }

  /**
   * Export sandbox data
   */
  private async exportSandboxData(accountId: string, result: MigrationResult): Promise<void> {
    const account = await this.sandboxDb.getAccountById(accountId);
    if (!account) {
      throw new Error('Source account not found');
    }

    const transactions = await this.sandboxDb.listTransactionsByAccount(accountId);

    // Store exported data in result for transformation
    (result as any).exportedData = {
      account,
      transactions,
    };

    console.log(`[Migration] Exported ${transactions.length} transactions`);
  }

  /**
   * Transform sandbox data for production
   */
  private async transformData(result: MigrationResult): Promise<void> {
    const exportedData = (result as any).exportedData;
    if (!exportedData) {
      throw new Error('No data to transform');
    }

    // Transform sandbox transactions to production format
    const transformedTransactions = exportedData.transactions.map((tx: any) => ({
      tenantId: exportedData.account.tenantId,
      txHash: `PROD_${tx.txHash}`, // Prefix to distinguish from sandbox
      amount: tx.amount,
      currency: tx.currency,
      network: 'stellar',
      status: tx.status === 'success' ? 'completed' : tx.status,
      type: tx.type,
      fromAddress: tx.fromAddress,
      toAddress: tx.toAddress,
      metadata: {
        migratedFromSandbox: true,
        originalSandboxTxHash: tx.txHash,
        migratedAt: new Date().toISOString(),
      },
    }));

    (result as any).transformedData = {
      account: exportedData.account,
      transactions: transformedTransactions,
    };

    console.log(`[Migration] Transformed ${transformedTransactions.length} transactions`);
  }

  /**
   * Import data to production
   */
  private async importToProduction(options: MigrationOptions, result: MigrationResult): Promise<void> {
    const transformedData = (result as any).transformedData;
    if (!transformedData) {
      throw new Error('No transformed data to import');
    }

    // Create or update user in production
    let userId = options.targetUserId;
    if (!userId) {
      const user = await prisma.user.create({
        data: {
          tenantId: options.tenantId,
          email: transformedData.account.email,
          tier: 'free',
          walletAddress: transformedData.account.walletAddress,
        },
      });
      userId = user.id;
      result.summary.accountsMigrated++;
    }

    // Import transactions
    for (const tx of transformedData.transactions) {
      try {
        await prisma.payment.create({
          data: {
            ...tx,
            userId,
          },
        });
        result.summary.transactionsMigrated++;
      } catch (error) {
        console.error(`[Migration] Failed to import transaction: ${error}`);
        result.summary.errors++;
      }
    }

    console.log(`[Migration] Imported ${result.summary.transactionsMigrated} transactions`);
  }

  /**
   * Verify migration integrity
   */
  private async verifyMigration(result: MigrationResult): Promise<void> {
    const transformedData = (result as any).transformedData;
    if (!transformedData) {
      throw new Error('No data to verify');
    }

    // Verify transaction counts match
    if (result.summary.transactionsMigrated !== transformedData.transactions.length) {
      console.warn(
        `[Migration] Transaction count mismatch: expected ${transformedData.transactions.length}, got ${result.summary.transactionsMigrated}`
      );
    }

    console.log('[Migration] Verification complete');
  }

  /**
   * Get migration status
   */
  async getMigrationStatus(migrationId: string) {
    return await prisma.sandboxMigration.findUnique({
      where: { id: migrationId },
    });
  }

  /**
   * List migrations for a tenant
   */
  async listMigrations(tenantId: string) {
    return await prisma.sandboxMigration.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Cancel an in-progress migration
   */
  async cancelMigration(migrationId: string) {
    const migration = await prisma.sandboxMigration.findUnique({
      where: { id: migrationId },
    });

    if (!migration) {
      throw new Error('Migration not found');
    }

    if (migration.status !== 'in_progress') {
      throw new Error('Cannot cancel migration that is not in progress');
    }

    return await prisma.sandboxMigration.update({
      where: { id: migrationId },
      data: {
        status: 'failed',
        error: 'Migration cancelled by user',
        completedAt: new Date(),
      },
    });
  }
}

export default SandboxMigrationWizard;
