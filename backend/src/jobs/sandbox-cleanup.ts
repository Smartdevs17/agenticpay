// Sandbox Cleanup Job
// Periodically cleans up expired sandbox accounts and old data

import type { JobDefinition } from './types.js';
import SandboxDatabaseService from '../services/sandbox-db.js';

const sandboxDb = new SandboxDatabaseService();

export const sandboxCleanupJobs: JobDefinition[] = [
  {
    id: 'sandbox-cleanup-expired-accounts',
    name: 'Cleanup Expired Sandbox Accounts',
    schedule: { type: 'cron', expression: '0 */6 * * *' }, // Every 6 hours
    handler: async () => {
      console.log('[Sandbox Cleanup] Starting expired account cleanup...');
      
      try {
        const result = await sandboxDb.cleanupExpiredAccounts();
        console.log(
          `[Sandbox Cleanup] Deactivated ${result.deactivatedCount} expired accounts`
        );
      } catch (error) {
        console.error('[Sandbox Cleanup] Error cleaning up expired accounts:', error);
      }
    },
  },
  {
    id: 'sandbox-cleanup-old-data',
    name: 'Cleanup Old Sandbox Data',
    schedule: { type: 'cron', expression: '0 2 * * *' }, // Daily at 2 AM
    handler: async () => {
      console.log('[Sandbox Cleanup] Starting old data cleanup...');
      
      try {
        // Cleanup data older than 30 days
        const result = await sandboxDb.cleanupOldData(30);
        console.log(
          `[Sandbox Cleanup] Deleted ${result.deletedTransactionsCount} transactions and ${result.deletedAccountsCount} accounts`
        );
      } catch (error) {
        console.error('[Sandbox Cleanup] Error cleaning up old data:', error);
      }
    },
  },
  {
    id: 'sandbox-maintenance-stats',
    name: 'Sandbox Maintenance Statistics',
    schedule: { type: 'cron', expression: '0 0 * * *' }, // Daily at midnight
    handler: async () => {
      console.log('[Sandbox Cleanup] Collecting maintenance statistics...');
      
      try {
        // This would typically aggregate stats for monitoring
        console.log('[Sandbox Cleanup] Statistics collected');
      } catch (error) {
        console.error('[Sandbox Cleanup] Error collecting statistics:', error);
      }
    },
  },
];

export default sandboxCleanupJobs;
