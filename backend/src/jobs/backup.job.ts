/**
 * backup.job.ts — Issue #880
 *
 * Handlers for the three scheduled backup tasks:
 *  - backup-full-daily        : daily full pg_dump at 02:00 UTC
 *  - backup-incremental-6h    : incremental backup every 6 hours
 *  - backup-retention-cleanup : weekly retention cleanup (same day as
 *                               archival-retention-cleanup to batch I/O)
 *
 * These are imported into scheduled-tasks.ts and not executed directly.
 */

import { backupAutomationService } from '../services/backup/BackupAutomationService.js';

export async function runFullBackupJob(): Promise<void> {
  console.log('[backup-job] Starting daily full backup…');
  const record = await backupAutomationService.runFullBackup();
  if (record.status === 'completed') {
    console.log(
      `[backup-job] Full backup succeeded: ${record.id}  size=${(record.sizeBytes / 1024 / 1024).toFixed(2)} MB`,
    );
  } else {
    console.error(`[backup-job] Full backup FAILED: ${record.error}`);
    throw new Error(`Full backup failed: ${record.error}`);
  }
}

export async function runIncrementalBackupJob(): Promise<void> {
  console.log('[backup-job] Starting 6-hour incremental backup…');
  const record = await backupAutomationService.runIncrementalBackup();
  if (record.status === 'completed') {
    console.log(
      `[backup-job] Incremental backup succeeded: ${record.id}  size=${(record.sizeBytes / 1024 / 1024).toFixed(2)} MB`,
    );
  } else {
    console.error(`[backup-job] Incremental backup FAILED: ${record.error}`);
    throw new Error(`Incremental backup failed: ${record.error}`);
  }
}

export async function runBackupRetentionCleanup(): Promise<void> {
  console.log('[backup-job] Running backup retention cleanup…');
  const deleted = await backupAutomationService.cleanupOldBackups();
  console.log(`[backup-job] Retention cleanup complete — deleted ${deleted} backup(s)`);
}
