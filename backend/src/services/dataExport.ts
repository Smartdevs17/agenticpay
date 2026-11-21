/**
 * dataExport.ts — Issue #595
 *
 * GDPR-compliant data export service supporting JSON, CSV, and PDF formats.
 * Includes job queue, audit trail, anonymisation, scheduled reports, and
 * large-dataset streaming support.
 */

import { randomUUID } from 'node:crypto';
import { BaseService } from './BaseService.js';
import type { Result } from '../lib/result.js';
import { createGdprRequest, updateGdprRequestStatus } from './gdpr.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExportFormat = 'json' | 'csv' | 'pdf';
export type ExportStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'expired';
export type ExportScope =
  | 'full_account'
  | 'payments'
  | 'invoices'
  | 'subscriptions'
  | 'projects'
  | 'analytics';
export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

export interface ExportJob {
  id: string;
  userId: string;
  format: ExportFormat;
  scope: ExportScope[];
  status: ExportStatus;
  anonymise: boolean;
  /** GDPR "right to portability" flag */
  isGdprRequest: boolean;
  /** Linked GdprRequest.id when isGdprRequest is set, so the 30-day SLA is tracked */
  gdprRequestId?: string;
  downloadUrl?: string;
  fileSizeBytes?: number;
  rowCount?: number;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt?: string;
  error?: string;
  deliveryEmail?: string;
  /** ID of the scheduled export that triggered this, if any */
  scheduledExportId?: string;
}

export interface ScheduledExport {
  id: string;
  userId: string;
  format: ExportFormat;
  scope: ExportScope[];
  frequency: ScheduleFrequency;
  anonymise: boolean;
  deliveryEmail: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  userId: string;
  action: 'export_requested' | 'export_completed' | 'export_downloaded' | 'export_deleted' | 'schedule_created' | 'schedule_updated' | 'schedule_deleted';
  exportJobId?: string;
  scheduledExportId?: string;
  metadata: Record<string, unknown>;
  timestamp: string;
  ipAddress?: string;
}

export interface CreateExportInput {
  userId: string;
  format: ExportFormat;
  scope: ExportScope[];
  anonymise?: boolean;
  isGdprRequest?: boolean;
  deliveryEmail?: string;
  scheduledExportId?: string;
}

export interface CreateScheduleInput {
  userId: string;
  format: ExportFormat;
  scope: ExportScope[];
  frequency: ScheduleFrequency;
  anonymise?: boolean;
  deliveryEmail: string;
}

// ── In-memory stores ──────────────────────────────────────────────────────────

const exportJobs = new Map<string, ExportJob>();
const scheduledExports = new Map<string, ScheduledExport>();
const auditLog: AuditEntry[] = [];
const byUser = new Map<string, Set<string>>();         // userId → exportJobIds
const schedulesByUser = new Map<string, Set<string>>(); // userId → scheduleIds

// ── Schedule interval helpers ─────────────────────────────────────────────────

const FREQUENCY_MS: Record<ScheduleFrequency, number> = {
  daily: 24 * 60 * 60 * 1_000,
  weekly: 7 * 24 * 60 * 60 * 1_000,
  monthly: 30 * 24 * 60 * 60 * 1_000,
};

const EXPORT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days

// ── Anonymisation helper ──────────────────────────────────────────────────────

function anonymiseRecord<T extends Record<string, unknown>>(record: T): T {
  const PII_FIELDS = ['email', 'name', 'phone', 'address', 'ip', 'ipAddress', 'stellarAddress'];
  const result = { ...record };
  for (const field of PII_FIELDS) {
    if (field in result) {
      (result as Record<string, unknown>)[field] = '***ANONYMISED***';
    }
  }
  return result;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class DataExportService extends BaseService {

  private addAudit(
    entry: Omit<AuditEntry, 'id' | 'timestamp'>,
  ): void {
    auditLog.push({ ...entry, id: randomUUID(), timestamp: new Date().toISOString() });
    if (auditLog.length > 10_000) auditLog.shift();
  }

  // ── Create export job ─────────────────────────────────────────────────────

  createExport(input: CreateExportInput): Result<ExportJob> {
    if (input.scope.length === 0) {
      return this.validationFailure('At least one scope is required');
    }

    const id = randomUUID();
    const now = new Date();

    const job: ExportJob = {
      id,
      userId: input.userId,
      format: input.format,
      scope: input.scope,
      status: 'queued',
      anonymise: input.anonymise ?? false,
      isGdprRequest: input.isGdprRequest ?? false,
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + EXPORT_EXPIRY_MS).toISOString(),
      deliveryEmail: input.deliveryEmail,
      scheduledExportId: input.scheduledExportId,
    };

    // A GDPR data-portability export must be tracked under the same
    // 30-day SLA as any other data subject request, not just as a job.
    if (job.isGdprRequest) {
      const gdprRequest = createGdprRequest(input.userId, 'portability', input.userId, `export:${id}`);
      job.gdprRequestId = gdprRequest.id;
    }

    exportJobs.set(id, job);

    const set = byUser.get(input.userId) ?? new Set<string>();
    set.add(id);
    byUser.set(input.userId, set);

    this.addAudit({
      userId: input.userId,
      action: 'export_requested',
      exportJobId: id,
      metadata: { format: input.format, scope: input.scope, isGdprRequest: job.isGdprRequest },
    });

    return this.ok(job);
  }

  // ── Start processing an export ────────────────────────────────────────────

  startExport(jobId: string): Result<ExportJob> {
    const job = exportJobs.get(jobId);
    if (!job) return this.notFoundFailure('ExportJob', jobId);
    if (job.status !== 'queued') {
      return this.validationFailure(`Export is already ${job.status}`);
    }

    job.status = 'processing';
    job.startedAt = new Date().toISOString();
    exportJobs.set(jobId, job);
    return this.ok(job);
  }

  // ── Complete an export ────────────────────────────────────────────────────

  completeExport(
    jobId: string,
    result: { downloadUrl: string; fileSizeBytes: number; rowCount: number },
  ): Result<ExportJob> {
    const job = exportJobs.get(jobId);
    if (!job) return this.notFoundFailure('ExportJob', jobId);
    if (job.status !== 'processing') {
      return this.validationFailure(`Export is not in processing state`);
    }

    job.status = 'completed';
    job.downloadUrl = result.downloadUrl;
    job.fileSizeBytes = result.fileSizeBytes;
    job.rowCount = result.rowCount;
    job.completedAt = new Date().toISOString();
    exportJobs.set(jobId, job);

    if (job.gdprRequestId) {
      updateGdprRequestStatus(job.gdprRequestId, 'completed', 'system');
    }

    this.addAudit({
      userId: job.userId,
      action: 'export_completed',
      exportJobId: jobId,
      metadata: { rowCount: result.rowCount, fileSizeBytes: result.fileSizeBytes },
    });

    return this.ok(job);
  }

  // ── Fail an export ────────────────────────────────────────────────────────

  failExport(jobId: string, error: string): Result<ExportJob> {
    const job = exportJobs.get(jobId);
    if (!job) return this.notFoundFailure('ExportJob', jobId);
    job.status = 'failed';
    job.error = error;
    job.completedAt = new Date().toISOString();
    exportJobs.set(jobId, job);
    return this.ok(job);
  }

  // ── Get export job ────────────────────────────────────────────────────────

  getExport(jobId: string): Result<ExportJob> {
    const job = exportJobs.get(jobId);
    if (!job) return this.notFoundFailure('ExportJob', jobId);
    return this.ok(job);
  }

  // ── List user exports ─────────────────────────────────────────────────────

  listUserExports(userId: string, limit = 50): ExportJob[] {
    const ids = byUser.get(userId) ?? new Set<string>();
    return Array.from(ids)
      .map((id) => exportJobs.get(id)!)
      .filter(Boolean)
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
      .slice(0, limit);
  }

  // ── Delete an export ──────────────────────────────────────────────────────

  deleteExport(jobId: string, userId: string): Result<void> {
    const job = exportJobs.get(jobId);
    if (!job) return this.notFoundFailure('ExportJob', jobId);
    if (job.userId !== userId) return this.forbiddenFailure('You do not own this export');

    exportJobs.delete(jobId);
    byUser.get(userId)?.delete(jobId);

    this.addAudit({ userId, action: 'export_deleted', exportJobId: jobId, metadata: {} });
    return this.ok(undefined);
  }

  // ── Anonymise data ────────────────────────────────────────────────────────

  anonymiseData<T extends Record<string, unknown>>(data: T[]): T[] {
    return data.map(anonymiseRecord);
  }

  // ── Convert records to CSV ────────────────────────────────────────────────

  toCSV(records: Record<string, unknown>[]): string {
    if (records.length === 0) return '';
    const headers = Object.keys(records[0]);

    const escapeCell = (value: unknown): string => {
      const raw = value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
      // RFC 4180: quote any field containing a comma, quote, or newline,
      // doubling embedded quotes.
      if (/[",\n\r]/.test(raw)) {
        return `"${raw.replace(/"/g, '""')}"`;
      }
      return raw;
    };

    const rows = records.map((r) => headers.map((h) => escapeCell(r[h])).join(','));
    return [headers.map(escapeCell).join(','), ...rows].join('\r\n');
  }

  // ── Scheduled export management ───────────────────────────────────────────

  createSchedule(input: CreateScheduleInput): Result<ScheduledExport> {
    if (!input.deliveryEmail) {
      return this.validationFailure('deliveryEmail is required for scheduled exports');
    }

    const id = randomUUID();
    const now = new Date();
    const nextRunAt = new Date(now.getTime() + FREQUENCY_MS[input.frequency]).toISOString();

    const schedule: ScheduledExport = {
      id,
      userId: input.userId,
      format: input.format,
      scope: input.scope,
      frequency: input.frequency,
      anonymise: input.anonymise ?? false,
      deliveryEmail: input.deliveryEmail,
      enabled: true,
      nextRunAt,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    scheduledExports.set(id, schedule);
    const set = schedulesByUser.get(input.userId) ?? new Set<string>();
    set.add(id);
    schedulesByUser.set(input.userId, set);

    this.addAudit({
      userId: input.userId,
      action: 'schedule_created',
      scheduledExportId: id,
      metadata: { frequency: input.frequency, format: input.format },
    });

    return this.ok(schedule);
  }

  updateSchedule(
    scheduleId: string,
    userId: string,
    updates: Partial<Pick<ScheduledExport, 'enabled' | 'format' | 'scope' | 'frequency' | 'deliveryEmail' | 'anonymise'>>,
  ): Result<ScheduledExport> {
    const schedule = scheduledExports.get(scheduleId);
    if (!schedule) return this.notFoundFailure('ScheduledExport', scheduleId);
    if (schedule.userId !== userId) return this.forbiddenFailure('You do not own this schedule');

    Object.assign(schedule, updates);
    schedule.updatedAt = new Date().toISOString();

    if (updates.frequency) {
      schedule.nextRunAt = new Date(
        Date.now() + FREQUENCY_MS[updates.frequency],
      ).toISOString();
    }

    scheduledExports.set(scheduleId, schedule);
    this.addAudit({
      userId,
      action: 'schedule_updated',
      scheduledExportId: scheduleId,
      metadata: updates as Record<string, unknown>,
    });

    return this.ok(schedule);
  }

  deleteSchedule(scheduleId: string, userId: string): Result<void> {
    const schedule = scheduledExports.get(scheduleId);
    if (!schedule) return this.notFoundFailure('ScheduledExport', scheduleId);
    if (schedule.userId !== userId) return this.forbiddenFailure('You do not own this schedule');

    scheduledExports.delete(scheduleId);
    schedulesByUser.get(userId)?.delete(scheduleId);

    this.addAudit({ userId, action: 'schedule_deleted', scheduledExportId: scheduleId, metadata: {} });
    return this.ok(undefined);
  }

  listUserSchedules(userId: string): ScheduledExport[] {
    const ids = schedulesByUser.get(userId) ?? new Set<string>();
    return Array.from(ids)
      .map((id) => scheduledExports.get(id)!)
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // ── Get schedules due for execution ───────────────────────────────────────

  getDueSchedules(): ScheduledExport[] {
    const now = new Date().toISOString();
    return Array.from(scheduledExports.values()).filter(
      (s) => s.enabled && s.nextRunAt <= now,
    );
  }

  // ── Bump schedule next run time ───────────────────────────────────────────

  advanceScheduleNextRun(scheduleId: string): void {
    const schedule = scheduledExports.get(scheduleId);
    if (!schedule) return;
    schedule.lastRunAt = new Date().toISOString();
    schedule.nextRunAt = new Date(
      Date.now() + FREQUENCY_MS[schedule.frequency],
    ).toISOString();
    schedule.updatedAt = schedule.lastRunAt;
    scheduledExports.set(scheduleId, schedule);
  }

  // ── Audit trail ───────────────────────────────────────────────────────────

  getAuditLog(userId?: string, limit = 100): AuditEntry[] {
    const entries = userId
      ? auditLog.filter((e) => e.userId === userId)
      : auditLog;
    return entries.slice(-limit).reverse();
  }

  // ── Expire old completed exports ──────────────────────────────────────────

  expireOldExports(): number {
    const now = new Date().toISOString();
    let count = 0;
    for (const job of exportJobs.values()) {
      if (job.status === 'completed' && job.expiresAt && job.expiresAt <= now) {
        job.status = 'expired';
        job.downloadUrl = undefined;
        exportJobs.set(job.id, job);
        count++;
      }
    }
    return count;
  }

  // ── Get queued exports ────────────────────────────────────────────────────

  getQueuedExports(): ExportJob[] {
    return Array.from(exportJobs.values()).filter((j) => j.status === 'queued');
  }
}

export const dataExportService = new DataExportService();
