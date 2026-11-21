/**
 * ComplianceRepository.ts — Issue #597 / #716
 *
 * Data access layer for compliance records.
 * Currently uses in-memory storage; swap out for Prisma/Redis via factory.ts.
 */

import { InMemoryRepository } from './InMemoryRepository.js';
import { ComplianceAlert, ComplianceReport, AuditTrailEntry } from '../services/complianceService.js';

// ─── Alert repository ─────────────────────────────────────────────────────────

export class ComplianceAlertRepository extends InMemoryRepository<ComplianceAlert> {
  protected getId(entity: ComplianceAlert): string {
    return entity.id;
  }

  protected getSortTimestamp(entity: ComplianceAlert): number {
    return new Date(entity.triggeredAt).getTime();
  }

  async create(data: Partial<ComplianceAlert>): Promise<ComplianceAlert> {
    if (!data.id) throw new Error('Alert id is required');
    return this.put(data as ComplianceAlert);
  }

  async update(id: string, data: Partial<ComplianceAlert>): Promise<ComplianceAlert | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    return this.put({ ...existing, ...data });
  }

  findByStatus(status: string): ComplianceAlert[] {
    return this.sortedValues().filter((a) => a.status === status);
  }

  findByJurisdiction(jurisdiction: string): ComplianceAlert[] {
    return this.sortedValues().filter((a) => a.jurisdiction === jurisdiction);
  }
}

// ─── Report repository ────────────────────────────────────────────────────────

export class ComplianceReportRepository extends InMemoryRepository<ComplianceReport> {
  protected getId(entity: ComplianceReport): string {
    return entity.id;
  }

  protected getSortTimestamp(entity: ComplianceReport): number {
    return new Date(entity.requestedAt).getTime();
  }

  async create(data: Partial<ComplianceReport>): Promise<ComplianceReport> {
    if (!data.id) throw new Error('Report id is required');
    return this.put(data as ComplianceReport);
  }

  async update(id: string, data: Partial<ComplianceReport>): Promise<ComplianceReport | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    return this.put({ ...existing, ...data });
  }
}

// ─── Audit trail repository ───────────────────────────────────────────────────

export class AuditTrailRepository extends InMemoryRepository<AuditTrailEntry> {
  protected getId(entity: AuditTrailEntry): string {
    return entity.id;
  }

  protected getSortTimestamp(entity: AuditTrailEntry): number {
    return new Date(entity.timestamp).getTime();
  }

  async create(data: Partial<AuditTrailEntry>): Promise<AuditTrailEntry> {
    if (!data.id) throw new Error('Entry id is required');
    return this.put(data as AuditTrailEntry);
  }

  async update(id: string, data: Partial<AuditTrailEntry>): Promise<AuditTrailEntry | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    return this.put({ ...existing, ...data });
  }
}
