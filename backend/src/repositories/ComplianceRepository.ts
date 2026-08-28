/**
 * ComplianceRepository.ts — Issue #597
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

  protected getSortValue(entity: ComplianceAlert): number {
    return new Date(entity.triggeredAt).getTime();
  }

  findByStatus(status: string): ComplianceAlert[] {
    return Array.from(this.store.values()).filter((a) => a.status === status);
  }

  findByJurisdiction(jurisdiction: string): ComplianceAlert[] {
    return Array.from(this.store.values()).filter((a) => a.jurisdiction === jurisdiction);
  }
}

// ─── Report repository ────────────────────────────────────────────────────────

export class ComplianceReportRepository extends InMemoryRepository<ComplianceReport> {
  protected getId(entity: ComplianceReport): string {
    return entity.id;
  }

  protected getSortValue(entity: ComplianceReport): number {
    return new Date(entity.requestedAt).getTime();
  }
}

// ─── Audit trail repository ───────────────────────────────────────────────────

export class AuditTrailRepository extends InMemoryRepository<AuditTrailEntry> {
  protected getId(entity: AuditTrailEntry): string {
    return entity.id;
  }

  protected getSortValue(entity: AuditTrailEntry): number {
    return new Date(entity.timestamp).getTime();
  }
}
