/**
 * export-jobs.ts — Issue #595
 *
 * Scheduled jobs for data export:
 *  - export-processor     : processes queued export jobs every 5 min
 *  - export-scheduler     : triggers scheduled exports when due (every 30 min)
 *  - export-cleanup       : expires old completed exports daily
 */

import { randomUUID } from 'node:crypto';
import type { JobDefinition } from './types.js';
import { dataExportService } from '../services/dataExport.js';

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[export-jobs] ${new Date().toISOString()} ${msg}`);
}

// ── Simulate export processing ────────────────────────────────────────────────

async function processQueuedExports(): Promise<void> {
  const queued = dataExportService.getQueuedExports();

  if (queued.length === 0) {
    log('No queued exports.');
    return;
  }

  log(`Processing ${queued.length} queued exports...`);

  for (const job of queued) {
    // Start processing
    const startResult = dataExportService.startExport(job.id);
    if (!startResult.ok) {
      log(`[SKIP] ${job.id}: ${startResult.error.message}`);
      continue;
    }

    try {
      // Simulate data assembly (replace with real data fetching in production)
      const mockData: Record<string, unknown>[] = Array.from({ length: 10 }, (_, i) => ({
        id: randomUUID(),
        scope: job.scope[0],
        index: i,
        userId: job.userId,
        exportedAt: new Date().toISOString(),
      }));

      let processedData = mockData;
      if (job.anonymise) {
        processedData = dataExportService.anonymiseData(mockData);
      }

      let content: string;
      let fileExtension: string;

      switch (job.format) {
        case 'csv':
          content = dataExportService.toCSV(processedData);
          fileExtension = 'csv';
          break;
        case 'pdf':
          // In production, use a PDF generation library
          content = `PDF export for user ${job.userId} (${job.scope.join(', ')})`;
          fileExtension = 'pdf';
          break;
        default:
          content = JSON.stringify(processedData, null, 2);
          fileExtension = 'json';
      }

      const downloadUrl = `/exports/${job.id}.${fileExtension}`;
      const fileSizeBytes = Buffer.byteLength(content, 'utf8');

      const completeResult = dataExportService.completeExport(job.id, {
        downloadUrl,
        fileSizeBytes,
        rowCount: processedData.length,
      });

      if (!completeResult.ok) {
        log(`[ERROR] Failed to complete export ${job.id}: ${completeResult.error.message}`);
        continue;
      }

      log(`[OK] Export ${job.id} completed — ${processedData.length} rows, format: ${job.format}`);

      // If delivery email is set, schedule email send (stubbed here)
      if (job.deliveryEmail) {
        log(`[EMAIL] Would send export ${job.id} to ${job.deliveryEmail}`);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      dataExportService.failExport(job.id, errMsg);
      log(`[FAILED] Export ${job.id}: ${errMsg}`);
    }
  }
}

// ── Process scheduled exports ─────────────────────────────────────────────────

async function processScheduledExports(): Promise<void> {
  const due = dataExportService.getDueSchedules();

  if (due.length === 0) {
    log('No scheduled exports due.');
    return;
  }

  log(`Triggering ${due.length} scheduled exports...`);

  for (const schedule of due) {
    const result = dataExportService.createExport({
      userId: schedule.userId,
      format: schedule.format,
      scope: schedule.scope,
      anonymise: schedule.anonymise,
      isGdprRequest: false,
      deliveryEmail: schedule.deliveryEmail,
      scheduledExportId: schedule.id,
    });

    if (!result.ok) {
      log(`[ERROR] Could not queue export for schedule ${schedule.id}: ${result.error.message}`);
      continue;
    }

    dataExportService.advanceScheduleNextRun(schedule.id);
    log(`[QUEUED] Export job ${result.value.id} for schedule ${schedule.id} (${schedule.frequency})`);
  }
}

// ── Expire old exports ────────────────────────────────────────────────────────

async function expireOldExports(): Promise<void> {
  const count = dataExportService.expireOldExports();
  log(`Expired ${count} old export(s).`);
}

// ── Job definitions ───────────────────────────────────────────────────────────

export const exportJobs: JobDefinition[] = [
  {
    id: 'export-processor',
    name: 'Process Queued Data Exports',
    schedule: { type: 'cron', expression: '*/5 * * * *' }, // every 5 minutes
    handler: processQueuedExports,
  },
  {
    id: 'export-scheduler',
    name: 'Trigger Due Scheduled Exports',
    schedule: { type: 'cron', expression: '*/30 * * * *' }, // every 30 minutes
    handler: processScheduledExports,
  },
  {
    id: 'export-cleanup',
    name: 'Expire Old Completed Exports',
    schedule: { type: 'cron', expression: '0 2 * * *' }, // daily at 02:00 UTC
    handler: expireOldExports,
  },
];
