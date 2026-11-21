// tax-calendar.ts — Issue #693
//
// Tax filing deadline tracking and management. Provides:
//   1. CRUD for tax filing deadlines per jurisdiction.
//   2. Upcoming deadline queries with configurable lookahead.
//   3. Overdue deadline detection and alerting.
//   4. Default deadline templates for common jurisdictions.
//   5. Integration with the filing report for deadline-aware generation.
//
// Follows the same Prisma/in-memory dual-mode pattern.

import { randomUUID } from 'node:crypto';
import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { prisma } from '../../lib/prisma.js';

export type DeadlineFrequency = 'monthly' | 'quarterly' | 'semi_annual' | 'annual';
export type DeadlineStatus = 'upcoming' | 'due_soon' | 'overdue' | 'completed' | 'extension';

export interface TaxDeadline {
  id: string;
  tenantId: string;
  merchantId: string;
  jurisdiction: string;
  name: string;
  description: string;
  frequency: DeadlineFrequency;
  dueDate: Date;
  status: DeadlineStatus;
  /** Days before due date to flag as "due soon". Default 14. */
  dueSoonThresholdDays: number;
  completedAt: Date | null;
  extensionUntil: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDeadlineInput {
  tenantId: string;
  merchantId: string;
  jurisdiction: string;
  name: string;
  description?: string;
  frequency: DeadlineFrequency;
  dueDate: Date;
  dueSoonThresholdDays?: number;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateDeadlineInput {
  name?: string;
  description?: string;
  frequency?: DeadlineFrequency;
  dueDate?: Date;
  status?: DeadlineStatus;
  dueSoonThresholdDays?: number;
  extensionUntil?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface ListDeadlinesOptions {
  tenantId?: string;
  merchantId?: string;
  jurisdiction?: string;
  status?: DeadlineStatus;
  frequency?: DeadlineFrequency;
  /** Only deadlines due before this date. */
  dueBefore?: Date;
  /** Only deadlines due on or after this date. */
  dueAfter?: Date;
  limit?: number;
  offset?: number;
}

export interface DeadlineListResult {
  deadlines: TaxDeadline[];
  total: number;
}

export interface DeadlineAlert {
  deadline: TaxDeadline;
  daysUntilDue: number;
  severity: 'info' | 'warning' | 'critical' | 'overdue';
  message: string;
}

export interface DefaultDeadlineTemplate {
  jurisdiction: string;
  name: string;
  description: string;
  frequency: DeadlineFrequency;
  /** Day of month the deadline falls on (1-based). */
  dayOfMonth: number;
  /** Month offset from period end (0 = same month, 1 = next month). */
  monthOffset: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const DEFAULT_DUE_SOON_THRESHOLD = 14;

const DEFAULT_TEMPLATES: DefaultDeadlineTemplate[] = [
  { jurisdiction: 'US', name: 'Federal Estimated Tax (Q1)', description: 'Q1 estimated tax payment due', frequency: 'quarterly', dayOfMonth: 15, monthOffset: 1 },
  { jurisdiction: 'US', name: 'Federal Estimated Tax (Q2)', description: 'Q2 estimated tax payment due', frequency: 'quarterly', dayOfMonth: 15, monthOffset: 1 },
  { jurisdiction: 'US', name: 'Federal Estimated Tax (Q3)', description: 'Q3 estimated tax payment due', frequency: 'quarterly', dayOfMonth: 15, monthOffset: 1 },
  { jurisdiction: 'US', name: 'Federal Estimated Tax (Q4)', description: 'Q4 estimated tax payment due', frequency: 'quarterly', dayOfMonth: 15, monthOffset: 1 },
  { jurisdiction: 'US', name: 'Annual Tax Return', description: 'Annual federal tax return (Form 1040)', frequency: 'annual', dayOfMonth: 15, monthOffset: 3 },
  { jurisdiction: 'GB', name: 'VAT Return', description: 'UK VAT return submission', frequency: 'quarterly', dayOfMonth: 7, monthOffset: 1 },
  { jurisdiction: 'DE', name: 'USt-Voranmeldung', description: 'German VAT advance notification', frequency: 'monthly', dayOfMonth: 10, monthOffset: 1 },
  { jurisdiction: 'FR', name: 'TVA Déclaration', description: 'French VAT declaration', frequency: 'monthly', dayOfMonth: 24, monthOffset: 1 },
  { jurisdiction: 'CA', name: 'GST/HST Return', description: 'Canadian GST/HST filing', frequency: 'quarterly', dayOfMonth: 15, monthOffset: 1 },
  { jurisdiction: 'AU', name: 'BAS Lodgement', description: 'Australian Business Activity Statement', frequency: 'quarterly', dayOfMonth: 28, monthOffset: 1 },
  { jurisdiction: 'JP', name: 'Consum Tax Return', description: 'Japanese consumption tax return', frequency: 'annual', dayOfMonth: 31, monthOffset: 2 },
  { jurisdiction: 'IN', name: 'GST Return', description: 'Indian GST return filing', frequency: 'monthly', dayOfMonth: 20, monthOffset: 1 },
];

export class TaxCalendarService extends BaseService {
  private deadlines: TaxDeadline[] = [];

  private usePrisma(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────

  async createDeadline(input: CreateDeadlineInput): Promise<Result<TaxDeadline>> {
    if (!input.tenantId) return this.validationFailure('tenantId is required');
    if (!input.merchantId) return this.validationFailure('merchantId is required');
    if (!input.jurisdiction) return this.validationFailure('jurisdiction is required');
    if (!input.name || input.name.trim().length === 0) return this.validationFailure('name is required');

    const now = new Date();
    const deadline: TaxDeadline = {
      id: randomUUID(),
      tenantId: input.tenantId,
      merchantId: input.merchantId,
      jurisdiction: input.jurisdiction.toUpperCase(),
      name: input.name,
      description: input.description ?? '',
      frequency: input.frequency,
      dueDate: input.dueDate,
      status: this.computeStatus(input.dueDate, input.dueSoonThresholdDays ?? DEFAULT_DUE_SOON_THRESHOLD),
      dueSoonThresholdDays: input.dueSoonThresholdDays ?? DEFAULT_DUE_SOON_THRESHOLD,
      completedAt: null,
      extensionUntil: null,
      metadata: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    };

    if (this.usePrisma()) {
      const row = await (prisma as any).taxDeadline.create({
        data: {
          id: deadline.id,
          tenantId: deadline.tenantId,
          merchantId: deadline.merchantId,
          jurisdiction: deadline.jurisdiction,
          name: deadline.name,
          description: deadline.description,
          frequency: deadline.frequency,
          dueDate: deadline.dueDate,
          status: deadline.status,
          dueSoonThresholdDays: deadline.dueSoonThresholdDays,
          metadata: deadline.metadata,
        },
      });
      deadline.createdAt = row.createdAt;
      deadline.updatedAt = row.updatedAt;
    } else {
      this.deadlines.push(deadline);
    }

    return this.ok(deadline);
  }

  async updateDeadline(id: string, patch: UpdateDeadlineInput): Promise<Result<TaxDeadline>> {
    const deadline = this.findDeadline(id);
    if (!deadline) return this.notFoundFailure('TaxDeadline', id);

    if (patch.name !== undefined) deadline.name = patch.name;
    if (patch.description !== undefined) deadline.description = patch.description;
    if (patch.frequency !== undefined) deadline.frequency = patch.frequency;
    if (patch.dueDate !== undefined) deadline.dueDate = patch.dueDate;
    if (patch.status !== undefined) deadline.status = patch.status;
    if (patch.dueSoonThresholdDays !== undefined) deadline.dueSoonThresholdDays = patch.dueSoonThresholdDays;
    if (patch.extensionUntil !== undefined) deadline.extensionUntil = patch.extensionUntil;
    if (patch.metadata !== undefined) deadline.metadata = patch.metadata;
    deadline.updatedAt = new Date();

    // Recompute status if dueDate changed and status was not explicitly set
    if (patch.dueDate !== undefined && patch.status === undefined) {
      deadline.status = this.computeStatus(deadline.dueDate, deadline.dueSoonThresholdDays);
    }

    return this.ok(deadline);
  }

  async completeDeadline(id: string): Promise<Result<TaxDeadline>> {
    const deadline = this.findDeadline(id);
    if (!deadline) return this.notFoundFailure('TaxDeadline', id);

    deadline.status = 'completed';
    deadline.completedAt = new Date();
    deadline.updatedAt = new Date();
    return this.ok(deadline);
  }

  async extendDeadline(id: string, extensionUntil: Date): Promise<Result<TaxDeadline>> {
    const deadline = this.findDeadline(id);
    if (!deadline) return this.notFoundFailure('TaxDeadline', id);

    if (extensionUntil <= deadline.dueDate) {
      return this.validationFailure('extensionUntil must be after the original due date');
    }

    deadline.extensionUntil = extensionUntil;
    deadline.status = 'extension';
    deadline.updatedAt = new Date();
    return this.ok(deadline);
  }

  async deleteDeadline(id: string): Promise<Result<void>> {
    const idx = this.deadlines.findIndex((d) => d.id === id);
    if (idx === -1) return this.notFoundFailure('TaxDeadline', id);
    this.deadlines.splice(idx, 1);
    return this.ok(undefined as unknown as void);
  }

  // ─── Queries ──────────────────────────────────────────────────────────

  async getDeadline(id: string): Promise<Result<TaxDeadline>> {
    const deadline = this.findDeadline(id);
    if (!deadline) return this.notFoundFailure('TaxDeadline', id);
    return this.ok(deadline);
  }

  async listDeadlines(options: ListDeadlinesOptions = {}): Promise<Result<DeadlineListResult>> {
    const limit = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = options.offset ?? 0;

    let deadlines = [...this.deadlines];

    if (options.tenantId) deadlines = deadlines.filter((d) => d.tenantId === options.tenantId);
    if (options.merchantId) deadlines = deadlines.filter((d) => d.merchantId === options.merchantId);
    if (options.jurisdiction) {
      const j = options.jurisdiction.toUpperCase();
      deadlines = deadlines.filter((d) => d.jurisdiction === j);
    }
    if (options.status) deadlines = deadlines.filter((d) => d.status === options.status);
    if (options.frequency) deadlines = deadlines.filter((d) => d.frequency === options.frequency);
    if (options.dueBefore) deadlines = deadlines.filter((d) => d.dueDate <= options.dueBefore!);
    if (options.dueAfter) deadlines = deadlines.filter((d) => d.dueDate >= options.dueAfter!);

    deadlines.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    const total = deadlines.length;
    const page = deadlines.slice(offset, offset + limit);

    return this.ok({ deadlines: page, total });
  }

  // ─── Alerts ───────────────────────────────────────────────────────────

  async getUpcomingAlerts(input: {
    tenantId: string;
    merchantId?: string;
    lookaheadDays?: number;
  }): Promise<Result<DeadlineAlert[]>> {
    if (!input.tenantId) return this.validationFailure('tenantId is required');

    const now = new Date();
    const lookahead = input.lookaheadDays ?? 30;
    const cutoff = new Date(now.getTime() + lookahead * 24 * 60 * 60 * 1000);

    const result = await this.listDeadlines({
      tenantId: input.tenantId,
      merchantId: input.merchantId,
      dueBefore: cutoff,
    });
    if (!result.ok) {
      return this.fail(result.error.message, result.error.statusCode, result.error.code);
    }

    const alerts: DeadlineAlert[] = [];
    for (const deadline of result.value.deadlines) {
      if (deadline.status === 'completed') continue;

      const effectiveDue = deadline.extensionUntil ?? deadline.dueDate;
      const daysUntilDue = Math.ceil((effectiveDue.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      const severity = this.alertSeverity(daysUntilDue);
      const message = this.alertMessage(deadline.name, daysUntilDue, deadline.jurisdiction);

      alerts.push({ deadline, daysUntilDue, severity, message });
    }

    return this.ok(alerts);
  }

  async getOverdueDeadlines(input: {
    tenantId: string;
    merchantId?: string;
  }): Promise<Result<TaxDeadline[]>> {
    const result = await this.listDeadlines({
      tenantId: input.tenantId,
      merchantId: input.merchantId,
      status: 'overdue',
    });
    if (!result.ok) {
      return this.fail(result.error.message, result.error.statusCode, result.error.code);
    }
    return this.ok(result.value.deadlines);
  }

  // ─── Default Templates ────────────────────────────────────────────────

  getDefaultTemplates(jurisdiction?: string): DefaultDeadlineTemplate[] {
    if (jurisdiction) {
      return DEFAULT_TEMPLATES.filter((t) => t.jurisdiction === jurisdiction.toUpperCase());
    }
    return [...DEFAULT_TEMPLATES];
  }

  async createDeadlineFromTemplate(input: {
    tenantId: string;
    merchantId: string;
    template: DefaultDeadlineTemplate;
    year: number;
    periodNumber: number;
  }): Promise<Result<TaxDeadline>> {
    const { template, year, periodNumber } = input;

    // Calculate the due date based on frequency and period
    let periodStartMonth: number;
    switch (template.frequency) {
      case 'monthly':
        periodStartMonth = periodNumber - 1;
        break;
      case 'quarterly':
        periodStartMonth = (periodNumber - 1) * 3;
        break;
      case 'semi_annual':
        periodStartMonth = (periodNumber - 1) * 6;
        break;
      case 'annual':
        periodStartMonth = 0;
        break;
    }

    const dueDate = new Date(Date.UTC(
      year,
      periodStartMonth + template.monthOffset,
      template.dayOfMonth,
      23, 59, 59,
    ));

    return this.createDeadline({
      tenantId: input.tenantId,
      merchantId: input.merchantId,
      jurisdiction: template.jurisdiction,
      name: template.name,
      description: template.description,
      frequency: template.frequency,
      dueDate,
    });
  }

  // ─── Refresh Statuses ─────────────────────────────────────────────────

  refreshStatuses(): number {
    let refreshed = 0;
    for (const deadline of this.deadlines) {
      if (deadline.status === 'completed' || deadline.status === 'extension') continue;
      const newStatus = this.computeStatus(deadline.dueDate, deadline.dueSoonThresholdDays);
      if (newStatus !== deadline.status) {
        deadline.status = newStatus;
        deadline.updatedAt = new Date();
        refreshed += 1;
      }
    }
    return refreshed;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private findDeadline(id: string): TaxDeadline | undefined {
    return this.deadlines.find((d) => d.id === id);
  }

  private computeStatus(dueDate: Date, thresholdDays: number): DeadlineStatus {
    const now = new Date();
    const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    if (daysUntilDue < 0) return 'overdue';
    if (daysUntilDue <= thresholdDays) return 'due_soon';
    return 'upcoming';
  }

  private alertSeverity(daysUntilDue: number): DeadlineAlert['severity'] {
    if (daysUntilDue < 0) return 'overdue';
    if (daysUntilDue <= 3) return 'critical';
    if (daysUntilDue <= 14) return 'warning';
    return 'info';
  }

  private alertMessage(name: string, daysUntilDue: number, jurisdiction: string): string {
    if (daysUntilDue < 0) {
      return `${name} (${jurisdiction}) is ${Math.abs(daysUntilDue)} day(s) overdue`;
    }
    if (daysUntilDue === 0) {
      return `${name} (${jurisdiction}) is due today`;
    }
    return `${name} (${jurisdiction}) is due in ${daysUntilDue} day(s)`;
  }

  resetForTests(): void {
    this.deadlines = [];
  }
}

export const taxCalendarService = new TaxCalendarService();
