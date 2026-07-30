/**
 * ComplianceRepository.ts — Issue #597
 *
 * Data access layer for compliance records.
 * Currently uses in-memory storage; swap out for Prisma/Redis via factory.ts.
 */

import { BaseRepository, PaginationOptions, PaginatedResult } from './BaseRepository.js';
import { ComplianceAlert, ComplianceReport, AuditTrailEntry } from '../services/complianceService.js';

// ─── Alert repository ─────────────────────────────────────────────────────────

export class ComplianceAlertRepository extends BaseRepository<ComplianceAlert> {
  private store: Map<string, ComplianceAlert> = new Map();

  async findById(id: string): Promise<ComplianceAlert | null> {
    return this.store.get(id) ?? null;
  }

  async findAll(options: PaginationOptions): Promise<PaginatedResult<ComplianceAlert>> {
    const all = Array.from(this.store.values()).sort(
      (a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime(),
    );
    let startIndex = 0;
    if (options.cursor) {
      const idx = all.findIndex((a) => a.id === options.cursor);
      startIndex = idx >= 0 ? idx + 1 : 0;
    }
    const items = all.slice(startIndex, startIndex + options.limit);
    const hasMore = startIndex + options.limit < all.length;
    return { items, hasMore, nextCursor: hasMore ? items.at(-1)?.id : undefined };
  }

  async create(data: Partial<ComplianceAlert>): Promise<ComplianceAlert> {
    if (!data.id) throw new Error('Alert id is required');
    this.store.set(data.id, data as ComplianceAlert);
    return data as ComplianceAlert;
  }

  async update(id: string, data: Partial<ComplianceAlert>): Promise<ComplianceAlert | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...data };
    this.store.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async count(filters?: Record<string, unknown>): Promise<number> {
    if (!filters) return this.store.size;
    return Array.from(this.store.values()).filter((a) =>
      Object.entries(filters).every(([k, v]) => (a as unknown as Record<string, unknown>)[k] === v),
    ).length;
  }

  findByStatus(status: string): ComplianceAlert[] {
    return Array.from(this.store.values()).filter((a) => a.status === status);
  }

  findByJurisdiction(jurisdiction: string): ComplianceAlert[] {
    return Array.from(this.store.values()).filter((a) => a.jurisdiction === jurisdiction);
  }
}

// ─── Report repository ────────────────────────────────────────────────────────

export class ComplianceReportRepository extends BaseRepository<ComplianceReport> {
  private store: Map<string, ComplianceReport> = new Map();

  async findById(id: string): Promise<ComplianceReport | null> {
    return this.store.get(id) ?? null;
  }

  async findAll(options: PaginationOptions): Promise<PaginatedResult<ComplianceReport>> {
    const all = Array.from(this.store.values()).sort(
      (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
    );
    let startIndex = 0;
    if (options.cursor) {
      const idx = all.findIndex((r) => r.id === options.cursor);
      startIndex = idx >= 0 ? idx + 1 : 0;
    }
    const items = all.slice(startIndex, startIndex + options.limit);
    const hasMore = startIndex + options.limit < all.length;
    return { items, hasMore, nextCursor: hasMore ? items.at(-1)?.id : undefined };
  }

  async create(data: Partial<ComplianceReport>): Promise<ComplianceReport> {
    if (!data.id) throw new Error('Report id is required');
    this.store.set(data.id, data as ComplianceReport);
    return data as ComplianceReport;
  }

  async update(id: string, data: Partial<ComplianceReport>): Promise<ComplianceReport | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...data };
    this.store.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async count(): Promise<number> {
    return this.store.size;
  }
}

// ─── Audit trail repository ───────────────────────────────────────────────────

export class AuditTrailRepository extends BaseRepository<AuditTrailEntry> {
  private entries: AuditTrailEntry[] = [];

  async findById(id: string): Promise<AuditTrailEntry | null> {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  async findAll(options: PaginationOptions): Promise<PaginatedResult<AuditTrailEntry>> {
    const sorted = [...this.entries].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    let startIndex = 0;
    if (options.cursor) {
      const idx = sorted.findIndex((e) => e.id === options.cursor);
      startIndex = idx >= 0 ? idx + 1 : 0;
    }
    const items = sorted.slice(startIndex, startIndex + options.limit);
    const hasMore = startIndex + options.limit < sorted.length;
    return { items, hasMore, nextCursor: hasMore ? items.at(-1)?.id : undefined };
  }

  async create(data: Partial<AuditTrailEntry>): Promise<AuditTrailEntry> {
    if (!data.id) throw new Error('Entry id is required');
    this.entries.push(data as AuditTrailEntry);
    return data as AuditTrailEntry;
  }

  async update(id: string, data: Partial<AuditTrailEntry>): Promise<AuditTrailEntry | null> {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    this.entries[idx] = { ...this.entries[idx], ...data };
    return this.entries[idx];
  }

  async delete(id: string): Promise<boolean> {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    return this.entries.length < before;
  }

  async count(): Promise<number> {
    return this.entries.length;
  }
}
