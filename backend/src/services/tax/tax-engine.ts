// tax-engine.ts — Issue #627
//
// Jurisdiction-aware tax rule engine layered on top of the pre-existing
// tax-reports service (Issue #351). Provides:
//   1. CRUD for per-jurisdiction tax rules, with effective-date windows.
//   2. Automated tax calculation (`calculate`) that resolves the applicable
//      rule for a jurisdiction at a point in time, applies any active
//      exemption, and writes an audit log entry for every calculation.
//   3. Exemption lifecycle management (create / revoke / list).
//   4. Compliance checks — missing rules, expired-but-still-active
//      exemptions, overlapping rule effective windows.
//   5. A filtered, paginated read of the calculation audit trail.
//
// Follows the same pattern as `archival-service.ts` (Issue #473): extends
// `BaseService`, gates all persistence behind `usePrisma()` (true only when
// `DATABASE_URL` is set), and falls back to in-memory arrays mirroring the
// Prisma models (`TaxJurisdictionRule`, `TaxExemption`,
// `TaxCalculationAuditLog`) otherwise. This keeps the service fully
// unit-testable without a live Postgres connection.

import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { prisma } from '../../lib/prisma.js';

export type TaxRuleType = 'vat' | 'gst' | 'sales_tax' | 'withholding';

export interface TaxJurisdictionRule {
  id: string;
  /** ISO 3166-1 alpha-2 jurisdiction code, e.g. 'US', 'GB', 'DE'. */
  jurisdiction: string;
  name: string;
  ruleType: TaxRuleType;
  /** Rate as a fraction, e.g. 0.20 for 20%. */
  rate: number;
  /** Rule only applies to amounts at/above this threshold (transaction currency). Null = always applies. */
  appliesAbove: number | null;
  active: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRuleInput {
  jurisdiction: string;
  name: string;
  ruleType: TaxRuleType;
  rate: number;
  appliesAbove?: number | null;
  active?: boolean;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateRuleInput {
  name?: string;
  ruleType?: TaxRuleType;
  rate?: number;
  appliesAbove?: number | null;
  active?: boolean;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface ListRulesOptions {
  jurisdiction?: string;
  ruleType?: TaxRuleType;
  /** Only rules active as booleans (does not consider effective dates). */
  activeOnly?: boolean;
  /** Only rules whose effective window covers this instant. */
  at?: Date;
}

export interface TaxExemption {
  id: string;
  tenantId: string;
  merchantId: string;
  jurisdiction: string;
  certificateId: string | null;
  reason: string;
  validFrom: Date;
  validTo: Date | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateExemptionInput {
  tenantId: string;
  merchantId: string;
  jurisdiction: string;
  certificateId?: string | null;
  reason: string;
  validFrom?: Date;
  validTo?: Date | null;
}

export interface ListExemptionsOptions {
  tenantId?: string;
  merchantId?: string;
  jurisdiction?: string;
  activeOnly?: boolean;
}

export interface TaxCalculationAuditLog {
  id: string;
  tenantId: string;
  merchantId: string;
  paymentId: string | null;
  jurisdiction: string;
  taxableAmount: number;
  taxAmount: number;
  rate: number;
  ruleId: string | null;
  exemptionId: string | null;
  exempt: boolean;
  currency: string;
  createdAt: Date;
}

export interface CalculateTaxInput {
  tenantId: string;
  merchantId: string;
  jurisdiction: string;
  amount: number;
  currency: string;
  paymentId?: string;
  /** Point in time the calculation applies at. Defaults to now. */
  at?: Date;
}

export interface TaxCalculationResult {
  taxableAmount: number;
  taxAmount: number;
  totalAmount: number;
  rate: number;
  currency: string;
  jurisdiction: string;
  exempt: boolean;
  exemptionId: string | null;
  ruleId: string | null;
  ruleName: string | null;
  /** False when no applicable rule was found (tax defaults to 0, surfaced via compliance checks). */
  ruleFound: boolean;
  auditLogId: string;
  createdAt: Date;
}

export interface AuditTrailQuery {
  tenantId: string;
  merchantId?: string;
  jurisdiction?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditTrailResult {
  entries: TaxCalculationAuditLog[];
  total: number;
}

export type ComplianceSeverity = 'info' | 'warning' | 'critical';

export interface ComplianceFinding {
  code: string;
  severity: ComplianceSeverity;
  message: string;
  jurisdiction?: string;
  details?: Record<string, unknown>;
}

export interface ComplianceCheckInput {
  tenantId: string;
  merchantId: string;
  jurisdiction?: string;
}

export interface ComplianceCheckResult {
  tenantId: string;
  merchantId: string;
  jurisdiction: string | null;
  checkedAt: string;
  findings: ComplianceFinding[];
  /** True when there are no `critical` findings. */
  compliant: boolean;
}

const DEFAULT_AUDIT_PAGE_SIZE = 50;
const MAX_AUDIT_PAGE_SIZE = 500;

export class TaxRuleEngine extends BaseService {
  // In-memory fallback store, used whenever DATABASE_URL is unset. Mirrors
  // the shape of the Prisma models so behavior is identical either way.
  private rules: TaxJurisdictionRule[] = [];
  private exemptions: TaxExemption[] = [];
  private auditLogs: TaxCalculationAuditLog[] = [];

  private usePrisma(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  // ─── Jurisdiction rules ──────────────────────────────────────────────

  async createRule(input: CreateRuleInput): Promise<Result<TaxJurisdictionRule>> {
    if (!input.jurisdiction || input.jurisdiction.trim().length === 0) {
      return this.validationFailure('jurisdiction is required');
    }
    if (!input.name || input.name.trim().length === 0) {
      return this.validationFailure('name is required');
    }
    if (typeof input.rate !== 'number' || Number.isNaN(input.rate) || input.rate < 0 || input.rate > 1) {
      return this.validationFailure('rate must be a fraction between 0 and 1');
    }
    const effectiveFrom = input.effectiveFrom ?? new Date();
    if (input.effectiveTo && input.effectiveTo <= effectiveFrom) {
      return this.validationFailure('effectiveTo must be after effectiveFrom');
    }

    const now = new Date();
    const record: TaxJurisdictionRule = {
      id: randomUUID(),
      jurisdiction: input.jurisdiction.toUpperCase(),
      name: input.name,
      ruleType: input.ruleType,
      rate: input.rate,
      appliesAbove: input.appliesAbove ?? null,
      active: input.active ?? true,
      effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      metadata: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    };

    if (this.usePrisma()) {
      const row = await prisma.taxJurisdictionRule.create({
        data: {
          id: record.id,
          jurisdiction: record.jurisdiction,
          name: record.name,
          ruleType: record.ruleType,
          rate: new Prisma.Decimal(record.rate),
          appliesAbove: record.appliesAbove !== null ? new Prisma.Decimal(record.appliesAbove) : undefined,
          active: record.active,
          effectiveFrom: record.effectiveFrom,
          effectiveTo: record.effectiveTo,
          metadata: (record.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      return this.ok(fromRuleRow(row));
    }

    this.rules.push(record);
    return this.ok(record);
  }

  async updateRule(id: string, patch: UpdateRuleInput): Promise<Result<TaxJurisdictionRule>> {
    if (patch.rate !== undefined && (Number.isNaN(patch.rate) || patch.rate < 0 || patch.rate > 1)) {
      return this.validationFailure('rate must be a fraction between 0 and 1');
    }

    if (this.usePrisma()) {
      const existing = await prisma.taxJurisdictionRule.findUnique({ where: { id } });
      if (!existing) return this.notFoundFailure('TaxJurisdictionRule', id);

      const effectiveFrom = patch.effectiveFrom ?? existing.effectiveFrom;
      const effectiveTo = patch.effectiveTo === undefined ? existing.effectiveTo : patch.effectiveTo;
      if (effectiveTo && effectiveTo <= effectiveFrom) {
        return this.validationFailure('effectiveTo must be after effectiveFrom');
      }

      const row = await prisma.taxJurisdictionRule.update({
        where: { id },
        data: {
          name: patch.name,
          ruleType: patch.ruleType,
          rate: patch.rate !== undefined ? new Prisma.Decimal(patch.rate) : undefined,
          appliesAbove:
            patch.appliesAbove === undefined
              ? undefined
              : patch.appliesAbove === null
                ? null
                : new Prisma.Decimal(patch.appliesAbove),
          active: patch.active,
          effectiveFrom: patch.effectiveFrom,
          effectiveTo: patch.effectiveTo,
          metadata: patch.metadata === undefined ? undefined : ((patch.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue),
        },
      });
      return this.ok(fromRuleRow(row));
    }

    const existing = this.rules.find((r) => r.id === id);
    if (!existing) return this.notFoundFailure('TaxJurisdictionRule', id);

    const effectiveFrom = patch.effectiveFrom ?? existing.effectiveFrom;
    const effectiveTo = patch.effectiveTo === undefined ? existing.effectiveTo : patch.effectiveTo;
    if (effectiveTo && effectiveTo <= effectiveFrom) {
      return this.validationFailure('effectiveTo must be after effectiveFrom');
    }

    Object.assign(existing, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.ruleType !== undefined ? { ruleType: patch.ruleType } : {}),
      ...(patch.rate !== undefined ? { rate: patch.rate } : {}),
      ...(patch.appliesAbove !== undefined ? { appliesAbove: patch.appliesAbove } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.effectiveFrom !== undefined ? { effectiveFrom: patch.effectiveFrom } : {}),
      ...(patch.effectiveTo !== undefined ? { effectiveTo: patch.effectiveTo } : {}),
      ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
      updatedAt: new Date(),
    });
    return this.ok(existing);
  }

  async deactivateRule(id: string): Promise<Result<TaxJurisdictionRule>> {
    return this.updateRule(id, { active: false });
  }

  async listRules(options: ListRulesOptions = {}): Promise<Result<TaxJurisdictionRule[]>> {
    if (this.usePrisma()) {
      const where: Prisma.TaxJurisdictionRuleWhereInput = {};
      if (options.jurisdiction) where.jurisdiction = options.jurisdiction.toUpperCase();
      if (options.ruleType) where.ruleType = options.ruleType;
      if (options.activeOnly) where.active = true;
      if (options.at) {
        where.effectiveFrom = { lte: options.at };
        where.OR = [{ effectiveTo: null }, { effectiveTo: { gte: options.at } }];
      }
      const rows = await prisma.taxJurisdictionRule.findMany({
        where,
        orderBy: [{ jurisdiction: 'asc' }, { effectiveFrom: 'desc' }],
      });
      return this.ok(rows.map(fromRuleRow));
    }

    let rules = [...this.rules];
    if (options.jurisdiction) {
      const j = options.jurisdiction.toUpperCase();
      rules = rules.filter((r) => r.jurisdiction === j);
    }
    if (options.ruleType) rules = rules.filter((r) => r.ruleType === options.ruleType);
    if (options.activeOnly) rules = rules.filter((r) => r.active);
    if (options.at) {
      const at = options.at;
      rules = rules.filter((r) => r.effectiveFrom <= at && (r.effectiveTo === null || r.effectiveTo >= at));
    }
    rules.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction) || b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
    return this.ok(rules);
  }

  /**
   * The single applicable rule for a jurisdiction at a point in time: active,
   * within its effective window, optionally matching `ruleType`. When more
   * than one rule matches (e.g. a rate change mid-period), the rule with the
   * latest `effectiveFrom` wins; ties break on `createdAt` (most recently
   * created wins). Stacking multiple simultaneously-applicable rule types
   * (e.g. VAT + withholding) is out of scope — see TAX_ENGINE.md.
   */
  private async findApplicableRule(
    jurisdiction: string,
    at: Date,
    ruleType?: TaxRuleType,
  ): Promise<TaxJurisdictionRule | null> {
    const result = await this.listRules({ jurisdiction, ruleType, activeOnly: true, at });
    if (!result.ok) return null;
    const candidates = result.value;
    if (candidates.length === 0) return null;

    return candidates.reduce((best, candidate) => {
      if (candidate.effectiveFrom.getTime() !== best.effectiveFrom.getTime()) {
        return candidate.effectiveFrom > best.effectiveFrom ? candidate : best;
      }
      return candidate.createdAt >= best.createdAt ? candidate : best;
    });
  }

  // ─── Exemptions ──────────────────────────────────────────────────────

  async createExemption(input: CreateExemptionInput): Promise<Result<TaxExemption>> {
    if (!input.tenantId) return this.validationFailure('tenantId is required');
    if (!input.merchantId) return this.validationFailure('merchantId is required');
    if (!input.jurisdiction) return this.validationFailure('jurisdiction is required');
    if (!input.reason || input.reason.trim().length === 0) return this.validationFailure('reason is required');

    const validFrom = input.validFrom ?? new Date();
    if (input.validTo && input.validTo <= validFrom) {
      return this.validationFailure('validTo must be after validFrom');
    }

    const now = new Date();
    const record: TaxExemption = {
      id: randomUUID(),
      tenantId: input.tenantId,
      merchantId: input.merchantId,
      jurisdiction: input.jurisdiction.toUpperCase(),
      certificateId: input.certificateId ?? null,
      reason: input.reason,
      validFrom,
      validTo: input.validTo ?? null,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    if (this.usePrisma()) {
      const row = await prisma.taxExemption.create({
        data: {
          id: record.id,
          tenantId: record.tenantId,
          merchantId: record.merchantId,
          jurisdiction: record.jurisdiction,
          certificateId: record.certificateId,
          reason: record.reason,
          validFrom: record.validFrom,
          validTo: record.validTo,
          active: record.active,
        },
      });
      return this.ok(fromExemptionRow(row));
    }

    this.exemptions.push(record);
    return this.ok(record);
  }

  async revokeExemption(id: string): Promise<Result<TaxExemption>> {
    if (this.usePrisma()) {
      const existing = await prisma.taxExemption.findUnique({ where: { id } });
      if (!existing) return this.notFoundFailure('TaxExemption', id);
      const row = await prisma.taxExemption.update({ where: { id }, data: { active: false } });
      return this.ok(fromExemptionRow(row));
    }

    const existing = this.exemptions.find((e) => e.id === id);
    if (!existing) return this.notFoundFailure('TaxExemption', id);
    existing.active = false;
    existing.updatedAt = new Date();
    return this.ok(existing);
  }

  async listExemptions(options: ListExemptionsOptions = {}): Promise<Result<TaxExemption[]>> {
    if (this.usePrisma()) {
      const where: Prisma.TaxExemptionWhereInput = {};
      if (options.tenantId) where.tenantId = options.tenantId;
      if (options.merchantId) where.merchantId = options.merchantId;
      if (options.jurisdiction) where.jurisdiction = options.jurisdiction.toUpperCase();
      if (options.activeOnly) where.active = true;
      const rows = await prisma.taxExemption.findMany({ where, orderBy: { createdAt: 'desc' } });
      return this.ok(rows.map(fromExemptionRow));
    }

    let exemptions = [...this.exemptions];
    if (options.tenantId) exemptions = exemptions.filter((e) => e.tenantId === options.tenantId);
    if (options.merchantId) exemptions = exemptions.filter((e) => e.merchantId === options.merchantId);
    if (options.jurisdiction) {
      const j = options.jurisdiction.toUpperCase();
      exemptions = exemptions.filter((e) => e.jurisdiction === j);
    }
    if (options.activeOnly) exemptions = exemptions.filter((e) => e.active);
    exemptions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return this.ok(exemptions);
  }

  /** Active exemption covering tenant+merchant+jurisdiction at `at`, if any. */
  private async findActiveExemption(
    tenantId: string,
    merchantId: string,
    jurisdiction: string,
    at: Date,
  ): Promise<TaxExemption | null> {
    const result = await this.listExemptions({ tenantId, merchantId, jurisdiction, activeOnly: true });
    if (!result.ok) return null;
    const valid = result.value.filter((e) => e.validFrom <= at && (e.validTo === null || e.validTo >= at));
    if (valid.length === 0) return null;
    // Most recently created active exemption wins if more than one applies.
    return valid.reduce((best, candidate) => (candidate.createdAt >= best.createdAt ? candidate : best));
  }

  // ─── Calculation ─────────────────────────────────────────────────────

  async calculate(input: CalculateTaxInput): Promise<Result<TaxCalculationResult>> {
    if (!input.tenantId) return this.validationFailure('tenantId is required');
    if (!input.merchantId) return this.validationFailure('merchantId is required');
    if (!input.jurisdiction) return this.validationFailure('jurisdiction is required');
    if (typeof input.amount !== 'number' || Number.isNaN(input.amount) || input.amount < 0) {
      return this.validationFailure('amount must be a non-negative number');
    }
    if (!input.currency) return this.validationFailure('currency is required');

    const at = input.at ?? new Date();
    const jurisdiction = input.jurisdiction.toUpperCase();

    const exemption = await this.findActiveExemption(input.tenantId, input.merchantId, jurisdiction, at);

    let taxAmount = 0;
    let rate = 0;
    let ruleId: string | null = null;
    let ruleName: string | null = null;
    let ruleFound = false;

    if (!exemption) {
      const rule = await this.findApplicableRule(jurisdiction, at);
      if (rule) {
        ruleFound = true;
        ruleId = rule.id;
        ruleName = rule.name;
        const belowThreshold = rule.appliesAbove !== null && input.amount < rule.appliesAbove;
        if (!belowThreshold) {
          rate = rule.rate;
          taxAmount = round2(input.amount * rule.rate);
        }
      }
    }

    const auditRecord: TaxCalculationAuditLog = {
      id: randomUUID(),
      tenantId: input.tenantId,
      merchantId: input.merchantId,
      paymentId: input.paymentId ?? null,
      jurisdiction,
      taxableAmount: input.amount,
      taxAmount,
      rate,
      ruleId,
      exemptionId: exemption?.id ?? null,
      exempt: Boolean(exemption),
      currency: input.currency.toUpperCase(),
      createdAt: new Date(),
    };

    if (this.usePrisma()) {
      const row = await prisma.taxCalculationAuditLog.create({
        data: {
          id: auditRecord.id,
          tenantId: auditRecord.tenantId,
          merchantId: auditRecord.merchantId,
          paymentId: auditRecord.paymentId,
          jurisdiction: auditRecord.jurisdiction,
          taxableAmount: new Prisma.Decimal(auditRecord.taxableAmount),
          taxAmount: new Prisma.Decimal(auditRecord.taxAmount),
          rate: new Prisma.Decimal(auditRecord.rate),
          ruleId: auditRecord.ruleId,
          exemptionId: auditRecord.exemptionId,
          exempt: auditRecord.exempt,
          currency: auditRecord.currency,
        },
      });
      auditRecord.id = row.id;
      auditRecord.createdAt = row.createdAt;
    } else {
      this.auditLogs.push(auditRecord);
    }

    return this.ok({
      taxableAmount: input.amount,
      taxAmount,
      totalAmount: round2(input.amount + taxAmount),
      rate,
      currency: auditRecord.currency,
      jurisdiction,
      exempt: Boolean(exemption),
      exemptionId: exemption?.id ?? null,
      ruleId,
      ruleName,
      ruleFound,
      auditLogId: auditRecord.id,
      createdAt: auditRecord.createdAt,
    });
  }

  // ─── Audit trail ─────────────────────────────────────────────────────

  async getAuditTrail(query: AuditTrailQuery): Promise<Result<AuditTrailResult>> {
    if (!query.tenantId) return this.validationFailure('tenantId is required');
    const limit = Math.min(query.limit ?? DEFAULT_AUDIT_PAGE_SIZE, MAX_AUDIT_PAGE_SIZE);
    const offset = query.offset ?? 0;

    if (this.usePrisma()) {
      const where: Prisma.TaxCalculationAuditLogWhereInput = { tenantId: query.tenantId };
      if (query.merchantId) where.merchantId = query.merchantId;
      if (query.jurisdiction) where.jurisdiction = query.jurisdiction.toUpperCase();
      if (query.since || query.until) {
        where.createdAt = {
          ...(query.since ? { gte: query.since } : {}),
          ...(query.until ? { lte: query.until } : {}),
        };
      }
      const [rows, total] = await Promise.all([
        prisma.taxCalculationAuditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
        }),
        prisma.taxCalculationAuditLog.count({ where }),
      ]);
      return this.ok({ entries: rows.map(fromAuditRow), total });
    }

    let entries = this.auditLogs.filter((a) => a.tenantId === query.tenantId);
    if (query.merchantId) entries = entries.filter((a) => a.merchantId === query.merchantId);
    if (query.jurisdiction) {
      const j = query.jurisdiction.toUpperCase();
      entries = entries.filter((a) => a.jurisdiction === j);
    }
    if (query.since) entries = entries.filter((a) => a.createdAt >= query.since!);
    if (query.until) entries = entries.filter((a) => a.createdAt <= query.until!);
    entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = entries.length;
    const page = entries.slice(offset, offset + limit);
    return this.ok({ entries: page, total });
  }

  // ─── Compliance ──────────────────────────────────────────────────────

  async checkCompliance(input: ComplianceCheckInput): Promise<Result<ComplianceCheckResult>> {
    if (!input.tenantId) return this.validationFailure('tenantId is required');
    if (!input.merchantId) return this.validationFailure('merchantId is required');

    const now = new Date();
    const findings: ComplianceFinding[] = [];

    // 1. Jurisdictions with recorded activity but no currently active rule.
    const trail = await this.getAuditTrail({
      tenantId: input.tenantId,
      merchantId: input.merchantId,
      jurisdiction: input.jurisdiction,
      limit: MAX_AUDIT_PAGE_SIZE,
    });
    if (trail.ok) {
      const jurisdictions = new Set(trail.value.entries.map((e) => e.jurisdiction));
      for (const jurisdiction of jurisdictions) {
        const rule = await this.findApplicableRule(jurisdiction, now);
        if (!rule) {
          findings.push({
            code: 'NO_ACTIVE_RULE',
            severity: 'warning',
            message: `No active tax rule found for jurisdiction ${jurisdiction}, but transactions have been recorded there.`,
            jurisdiction,
          });
        }
      }
    }

    // 2. Exemptions that are still marked active but whose validTo has passed.
    const exemptions = await this.listExemptions({
      tenantId: input.tenantId,
      merchantId: input.merchantId,
      jurisdiction: input.jurisdiction,
      activeOnly: true,
    });
    if (exemptions.ok) {
      for (const exemption of exemptions.value) {
        if (exemption.validTo && exemption.validTo < now) {
          findings.push({
            code: 'EXPIRED_EXEMPTION_ACTIVE',
            severity: 'critical',
            message: `Exemption ${exemption.id} for jurisdiction ${exemption.jurisdiction} expired on ${exemption.validTo.toISOString()} but is still marked active.`,
            jurisdiction: exemption.jurisdiction,
            details: { exemptionId: exemption.id, certificateId: exemption.certificateId },
          });
        }
      }
    }

    // 3. Rules with overlapping effective windows for the same jurisdiction + ruleType.
    const rulesResult = await this.listRules({ jurisdiction: input.jurisdiction, activeOnly: true });
    if (rulesResult.ok) {
      const groups = new Map<string, TaxJurisdictionRule[]>();
      for (const rule of rulesResult.value) {
        const key = `${rule.jurisdiction}:${rule.ruleType}`;
        const group = groups.get(key) ?? [];
        group.push(rule);
        groups.set(key, group);
      }
      for (const group of groups.values()) {
        const sorted = [...group].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
        for (let i = 0; i < sorted.length; i++) {
          for (let j = i + 1; j < sorted.length; j++) {
            if (rangesOverlap(sorted[i], sorted[j])) {
              findings.push({
                code: 'OVERLAPPING_RULE_WINDOWS',
                severity: 'critical',
                message: `Tax rules ${sorted[i].id} and ${sorted[j].id} for ${sorted[i].jurisdiction}/${sorted[i].ruleType} have overlapping effective windows.`,
                jurisdiction: sorted[i].jurisdiction,
                details: { ruleIds: [sorted[i].id, sorted[j].id] },
              });
            }
          }
        }
      }
    }

    return this.ok({
      tenantId: input.tenantId,
      merchantId: input.merchantId,
      jurisdiction: input.jurisdiction ?? null,
      checkedAt: now.toISOString(),
      findings,
      compliant: !findings.some((f) => f.severity === 'critical'),
    });
  }

  resetForTests(): void {
    this.rules = [];
    this.exemptions = [];
    this.auditLogs = [];
  }
}

function rangesOverlap(a: TaxJurisdictionRule, b: TaxJurisdictionRule): boolean {
  const aEnd = a.effectiveTo?.getTime() ?? Infinity;
  const bEnd = b.effectiveTo?.getTime() ?? Infinity;
  return a.effectiveFrom.getTime() <= bEnd && b.effectiveFrom.getTime() <= aEnd;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type PrismaRuleRow = Awaited<ReturnType<typeof prisma.taxJurisdictionRule.create>>;
type PrismaExemptionRow = Awaited<ReturnType<typeof prisma.taxExemption.create>>;
type PrismaAuditRow = Awaited<ReturnType<typeof prisma.taxCalculationAuditLog.create>>;

function fromRuleRow(row: PrismaRuleRow): TaxJurisdictionRule {
  return {
    id: row.id,
    jurisdiction: row.jurisdiction,
    name: row.name,
    ruleType: row.ruleType as TaxRuleType,
    rate: row.rate.toNumber(),
    appliesAbove: row.appliesAbove ? row.appliesAbove.toNumber() : null,
    active: row.active,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function fromExemptionRow(row: PrismaExemptionRow): TaxExemption {
  return {
    id: row.id,
    tenantId: row.tenantId,
    merchantId: row.merchantId,
    jurisdiction: row.jurisdiction,
    certificateId: row.certificateId,
    reason: row.reason,
    validFrom: row.validFrom,
    validTo: row.validTo,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function fromAuditRow(row: PrismaAuditRow): TaxCalculationAuditLog {
  return {
    id: row.id,
    tenantId: row.tenantId,
    merchantId: row.merchantId,
    paymentId: row.paymentId,
    jurisdiction: row.jurisdiction,
    taxableAmount: row.taxableAmount.toNumber(),
    taxAmount: row.taxAmount.toNumber(),
    rate: row.rate.toNumber(),
    ruleId: row.ruleId,
    exemptionId: row.exemptionId,
    exempt: row.exempt,
    currency: row.currency,
    createdAt: row.createdAt,
  };
}

let instance: TaxRuleEngine | null = null;

export function getTaxRuleEngine(): TaxRuleEngine {
  if (!instance) instance = new TaxRuleEngine();
  return instance;
}
