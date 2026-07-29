// reconciliation-service.ts — Issue #628
//
// Orchestrates automated payment reconciliation: ingest internal records
// (our own `Payment` ledger) and externally supplied records (bank
// statement lines, PSP settlement files, on-chain feeds), run them through
// the matching engine, and persist the resulting `ReconciliationRecord` /
// `ReconciliationMatch` / `ReconciliationException` rows plus aggregate
// `ReconciliationBatch` stats.
//
// Follows the same DB-optional pattern as `services/archival/archival-service.ts`:
// all DB access is gated behind `usePrisma()` (true only when DATABASE_URL is
// set) with a fully-featured in-memory fallback so the service — matching,
// exception workflow, reporting, and analytics — is unit-testable without a
// live Postgres connection. In-memory internal records are supplied via
// `seedPayments()` (a stand-in for querying the `Payment` table) and cleared
// with `resetForTests()`.

import { randomUUID } from 'node:crypto';
import type {
  ReconciliationBatchStatus,
  ReconciliationExceptionStatus,
} from '@prisma/client';
import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { prisma } from '../../lib/prisma.js';
import {
  runMatchingEngine,
  type MatchCandidate,
  type MatchResult,
  type MatchType,
  type ReconciliationSource,
} from './matching-engine.js';

// ─── Public DTO types ────────────────────────────────────────────────────────

export type BatchStatus = ReconciliationBatchStatus;
export type ExceptionStatus = ReconciliationExceptionStatus;

/** Stand-in for a row from the `Payment` table (used by the in-memory fallback). */
export interface InternalPaymentLike {
  id: string;
  tenantId: string;
  txHash?: string | null;
  amount: number;
  currency: string;
  createdAt: Date;
}

export interface ExternalRecordInput {
  source: Exclude<ReconciliationSource, 'internal'>;
  externalRef?: string | null;
  amount: number;
  currency: string;
  occurredAt: string | Date;
  metadata?: Record<string, unknown> | null;
}

export interface CreateBatchInput {
  tenantId: string;
  periodStart: string | Date;
  periodEnd: string | Date;
  externalRecords?: ExternalRecordInput[];
}

export interface ReconciliationRecordDTO {
  id: string;
  batchId: string;
  tenantId: string;
  source: ReconciliationSource;
  externalRef: string | null;
  paymentId: string | null;
  amount: number;
  currency: string;
  occurredAt: string;
  matched: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ReconciliationMatchDTO {
  id: string;
  batchId: string;
  internalRecordId: string;
  externalRecordId: string;
  matchType: MatchType;
  confidence: number;
  amountDelta: number;
  createdAt: string;
}

export interface ReconciliationExceptionDTO {
  id: string;
  batchId: string;
  tenantId: string;
  recordId: string | null;
  reason: string;
  status: ExceptionStatus;
  amount: number;
  currency: string;
  assignedTo: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReconciliationBatchDTO {
  id: string;
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  status: BatchStatus;
  totalRecords: number;
  matchedCount: number;
  exceptionCount: number;
  matchedAmount: number;
  unmatchedAmount: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReconciliationBatchDetail extends ReconciliationBatchDTO {
  records: ReconciliationRecordDTO[];
  matches: ReconciliationMatchDTO[];
  exceptions: ReconciliationExceptionDTO[];
}

export interface ReconciliationReport {
  batchId: string;
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  status: BatchStatus;
  totalRecords: number;
  matchedCount: number;
  exceptionCount: number;
  matchRatePct: number;
  matchedAmount: number;
  unmatchedAmount: number;
  bySource: Array<{ source: ReconciliationSource; total: number; matched: number; unmatched: number }>;
  exceptionsByReason: Array<{ reason: string; count: number; amount: number }>;
  generatedAt: string;
}

export interface ExceptionUpdateInput {
  status?: ExceptionStatus;
  assignedTo?: string | null;
  resolutionNote?: string | null;
}

export interface ExceptionListParams {
  tenantId: string;
  status?: ExceptionStatus;
}

export interface BatchListParams {
  tenantId: string;
  from?: Date;
  to?: Date;
}

export interface ReconciliationAnalytics {
  tenantId: string;
  periodStart: string | null;
  periodEnd: string | null;
  totalBatches: number;
  totalRecords: number;
  matchRatePct: number;
  meanTimeToResolveExceptionsHours: number | null;
  openExceptionCount: number;
  exceptionReasons: Array<{ reason: string; count: number }>;
  trend: Array<{
    batchId: string;
    periodStart: string;
    periodEnd: string;
    matchRatePct: number;
    totalRecords: number;
    exceptionCount: number;
  }>;
  generatedAt: string;
}

const NO_EXTERNAL_MATCH_REASON = 'no_matching_external_record';
const NO_INTERNAL_MATCH_REASON = 'no_matching_internal_record';

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

class ReconciliationService extends BaseService {
  private usePrisma(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  // ── In-memory fallback state ────────────────────────────────────────────
  private memBatches = new Map<string, ReconciliationBatchDTO>();
  private memRecords = new Map<string, ReconciliationRecordDTO>();
  private memMatches = new Map<string, ReconciliationMatchDTO>();
  private memExceptions = new Map<string, ReconciliationExceptionDTO>();
  private memPayments: InternalPaymentLike[] = [];

  /** Seed in-memory internal payment records — stand-in for the `Payment` table in tests. */
  seedPayments(payments: InternalPaymentLike[]): void {
    this.memPayments.push(...payments);
  }

  resetForTests(): void {
    this.memBatches.clear();
    this.memRecords.clear();
    this.memMatches.clear();
    this.memExceptions.clear();
    this.memPayments = [];
  }

  // ── Batch creation / matching run ───────────────────────────────────────

  async runBatch(input: CreateBatchInput): Promise<Result<ReconciliationBatchDetail>> {
    if (!input.tenantId) return this.validationFailure('tenantId is required');

    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
      return this.validationFailure('periodStart and periodEnd must be valid dates');
    }
    if (periodStart >= periodEnd) {
      return this.validationFailure('periodStart must be before periodEnd');
    }

    const externalInputs = input.externalRecords ?? [];
    for (const [i, e] of externalInputs.entries()) {
      if (typeof e.amount !== 'number' || !Number.isFinite(e.amount) || e.amount <= 0) {
        return this.validationFailure(`externalRecords[${i}].amount must be a positive number`);
      }
      if (typeof e.currency !== 'string' || e.currency.length === 0) {
        return this.validationFailure(`externalRecords[${i}].currency is required`);
      }
      if (Number.isNaN(new Date(e.occurredAt).getTime())) {
        return this.validationFailure(`externalRecords[${i}].occurredAt must be a valid date`);
      }
    }

    const batchId = randomUUID();
    const startedAt = new Date();

    if (this.usePrisma()) {
      await prisma.reconciliationBatch.create({
        data: {
          id: batchId,
          tenantId: input.tenantId,
          periodStart,
          periodEnd,
          status: 'running',
          startedAt,
        },
      });
    } else {
      this.memBatches.set(batchId, {
        id: batchId,
        tenantId: input.tenantId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        status: 'running',
        totalRecords: 0,
        matchedCount: 0,
        exceptionCount: 0,
        matchedAmount: 0,
        unmatchedAmount: 0,
        startedAt: startedAt.toISOString(),
        completedAt: null,
        createdAt: startedAt.toISOString(),
        updatedAt: startedAt.toISOString(),
      });
    }

    try {
      const internalPayments = this.usePrisma()
        ? await prisma.payment.findMany({
            where: {
              tenantId: input.tenantId,
              createdAt: { gte: periodStart, lt: periodEnd },
              deletedAt: null,
            },
          })
        : this.memPayments.filter(
            (p) => p.tenantId === input.tenantId && p.createdAt >= periodStart && p.createdAt < periodEnd,
          );

      const internalCandidates: MatchCandidate[] = internalPayments.map((p, i) => ({
        id: `int-${i}`,
        source: 'internal',
        externalRef: p.txHash ?? null,
        paymentId: p.id,
        amount: typeof p.amount === 'number' ? p.amount : Number(p.amount),
        currency: p.currency,
        occurredAt: p.createdAt,
      }));

      const externalCandidates: MatchCandidate[] = externalInputs.map((e, i) => ({
        id: `ext-${i}`,
        source: e.source,
        externalRef: e.externalRef ?? null,
        paymentId: null,
        amount: e.amount,
        currency: e.currency,
        occurredAt: new Date(e.occurredAt),
      }));

      const outcome = runMatchingEngine(internalCandidates, externalCandidates);

      const recordIdByCandidateId = new Map<string, string>();
      const recordsToCreate: ReconciliationRecordDTO[] = [];
      const createdAt = new Date();

      internalCandidates.forEach((c, i) => {
        const recordId = randomUUID();
        recordIdByCandidateId.set(c.id, recordId);
        recordsToCreate.push({
          id: recordId,
          batchId,
          tenantId: input.tenantId,
          source: 'internal',
          externalRef: c.externalRef ?? null,
          paymentId: c.paymentId ?? null,
          amount: c.amount,
          currency: c.currency,
          occurredAt: c.occurredAt.toISOString(),
          matched: outcome.matches.some((m) => m.internalId === c.id),
          metadata: null,
          createdAt: createdAt.toISOString(),
        });
        void i;
      });

      externalCandidates.forEach((c, i) => {
        const recordId = randomUUID();
        recordIdByCandidateId.set(c.id, recordId);
        recordsToCreate.push({
          id: recordId,
          batchId,
          tenantId: input.tenantId,
          source: c.source,
          externalRef: c.externalRef ?? null,
          paymentId: null,
          amount: c.amount,
          currency: c.currency,
          occurredAt: c.occurredAt.toISOString(),
          matched: outcome.matches.some((m) => m.externalId === c.id),
          metadata: externalInputs[i]?.metadata ?? null,
          createdAt: createdAt.toISOString(),
        });
      });

      const matchRows: ReconciliationMatchDTO[] = outcome.matches.map((m: MatchResult) => ({
        id: randomUUID(),
        batchId,
        internalRecordId: recordIdByCandidateId.get(m.internalId)!,
        externalRecordId: recordIdByCandidateId.get(m.externalId)!,
        matchType: m.matchType,
        confidence: m.confidence,
        amountDelta: m.amountDelta,
        createdAt: createdAt.toISOString(),
      }));

      const exceptionRows: ReconciliationExceptionDTO[] = [
        ...outcome.unmatchedInternal.map((c) => ({
          id: randomUUID(),
          batchId,
          tenantId: input.tenantId,
          recordId: recordIdByCandidateId.get(c.id) ?? null,
          reason: NO_EXTERNAL_MATCH_REASON,
          status: 'open' as ExceptionStatus,
          amount: c.amount,
          currency: c.currency,
          assignedTo: null,
          resolutionNote: null,
          resolvedAt: null,
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
        })),
        ...outcome.unmatchedExternal.map((c) => ({
          id: randomUUID(),
          batchId,
          tenantId: input.tenantId,
          recordId: recordIdByCandidateId.get(c.id) ?? null,
          reason: NO_INTERNAL_MATCH_REASON,
          status: 'open' as ExceptionStatus,
          amount: c.amount,
          currency: c.currency,
          assignedTo: null,
          resolutionNote: null,
          resolvedAt: null,
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
        })),
      ];

      const totalRecords = recordsToCreate.length;
      const matchedCount = matchRows.length;
      const exceptionCount = exceptionRows.length;
      const matchedAmount = round(
        matchRows.reduce((sum, m) => {
          const rec = recordsToCreate.find((r) => r.id === m.internalRecordId);
          return sum + (rec?.amount ?? 0);
        }, 0),
        8,
      );
      const unmatchedAmount = round(
        exceptionRows.reduce((sum, e) => sum + e.amount, 0),
        8,
      );
      const status: BatchStatus = exceptionCount > 0 ? 'completed_with_exceptions' : 'completed';
      const completedAt = new Date();

      if (this.usePrisma()) {
        if (recordsToCreate.length) {
          await prisma.reconciliationRecord.createMany({
            data: recordsToCreate.map((r) => ({
              id: r.id,
              batchId: r.batchId,
              tenantId: r.tenantId,
              source: r.source,
              externalRef: r.externalRef ?? undefined,
              paymentId: r.paymentId ?? undefined,
              amount: r.amount,
              currency: r.currency,
              occurredAt: new Date(r.occurredAt),
              matched: r.matched,
              metadata: r.metadata ?? undefined,
            })),
          });
        }
        if (matchRows.length) {
          await prisma.reconciliationMatch.createMany({
            data: matchRows.map((m) => ({
              id: m.id,
              batchId: m.batchId,
              internalRecordId: m.internalRecordId,
              externalRecordId: m.externalRecordId,
              matchType: m.matchType,
              confidence: m.confidence,
              amountDelta: m.amountDelta,
            })),
          });
        }
        if (exceptionRows.length) {
          await prisma.reconciliationException.createMany({
            data: exceptionRows.map((e) => ({
              id: e.id,
              batchId: e.batchId,
              tenantId: e.tenantId,
              recordId: e.recordId ?? undefined,
              reason: e.reason,
              status: e.status,
              amount: e.amount,
              currency: e.currency,
            })),
          });
        }
        await prisma.reconciliationBatch.update({
          where: { id: batchId },
          data: { status, totalRecords, matchedCount, exceptionCount, matchedAmount, unmatchedAmount, completedAt },
        });

        return this.getBatchDetail(batchId);
      }

      for (const r of recordsToCreate) this.memRecords.set(r.id, r);
      for (const m of matchRows) this.memMatches.set(m.id, m);
      for (const e of exceptionRows) this.memExceptions.set(e.id, e);

      const existingBatch = this.memBatches.get(batchId)!;
      const updatedBatch: ReconciliationBatchDTO = {
        ...existingBatch,
        status,
        totalRecords,
        matchedCount,
        exceptionCount,
        matchedAmount,
        unmatchedAmount,
        completedAt: completedAt.toISOString(),
        updatedAt: completedAt.toISOString(),
      };
      this.memBatches.set(batchId, updatedBatch);

      return this.ok({ ...updatedBatch, records: recordsToCreate, matches: matchRows, exceptions: exceptionRows });
    } catch (err) {
      if (this.usePrisma()) {
        await prisma.reconciliationBatch
          .update({ where: { id: batchId }, data: { status: 'failed', completedAt: new Date() } })
          .catch(() => undefined);
      } else {
        const existing = this.memBatches.get(batchId);
        if (existing) {
          this.memBatches.set(batchId, { ...existing, status: 'failed', completedAt: new Date().toISOString() });
        }
      }
      return this.unexpectedFailure(err);
    }
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async getBatchDetail(id: string): Promise<Result<ReconciliationBatchDetail>> {
    if (this.usePrisma()) {
      const batch = await prisma.reconciliationBatch.findUnique({
        where: { id },
        include: { records: true, matches: true, exceptions: true },
      });
      if (!batch) return this.notFoundFailure('ReconciliationBatch', id);
      return this.ok({
        id: batch.id,
        tenantId: batch.tenantId,
        periodStart: batch.periodStart.toISOString(),
        periodEnd: batch.periodEnd.toISOString(),
        status: batch.status,
        totalRecords: batch.totalRecords,
        matchedCount: batch.matchedCount,
        exceptionCount: batch.exceptionCount,
        matchedAmount: Number(batch.matchedAmount),
        unmatchedAmount: Number(batch.unmatchedAmount),
        startedAt: batch.startedAt?.toISOString() ?? null,
        completedAt: batch.completedAt?.toISOString() ?? null,
        createdAt: batch.createdAt.toISOString(),
        updatedAt: batch.updatedAt.toISOString(),
        records: batch.records.map((r) => ({
          id: r.id,
          batchId: r.batchId,
          tenantId: r.tenantId,
          source: r.source,
          externalRef: r.externalRef,
          paymentId: r.paymentId,
          amount: Number(r.amount),
          currency: r.currency,
          occurredAt: r.occurredAt.toISOString(),
          matched: r.matched,
          metadata: (r.metadata as Record<string, unknown> | null) ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
        matches: batch.matches.map((m) => ({
          id: m.id,
          batchId: m.batchId,
          internalRecordId: m.internalRecordId,
          externalRecordId: m.externalRecordId,
          matchType: m.matchType,
          confidence: Number(m.confidence),
          amountDelta: Number(m.amountDelta),
          createdAt: m.createdAt.toISOString(),
        })),
        exceptions: batch.exceptions.map((e) => ({
          id: e.id,
          batchId: e.batchId,
          tenantId: e.tenantId,
          recordId: e.recordId,
          reason: e.reason,
          status: e.status,
          amount: Number(e.amount),
          currency: e.currency,
          assignedTo: e.assignedTo,
          resolutionNote: e.resolutionNote,
          resolvedAt: e.resolvedAt?.toISOString() ?? null,
          createdAt: e.createdAt.toISOString(),
          updatedAt: e.updatedAt.toISOString(),
        })),
      });
    }

    const batch = this.memBatches.get(id);
    if (!batch) return this.notFoundFailure('ReconciliationBatch', id);
    const records = [...this.memRecords.values()].filter((r) => r.batchId === id);
    const matches = [...this.memMatches.values()].filter((m) => m.batchId === id);
    const exceptions = [...this.memExceptions.values()].filter((e) => e.batchId === id);
    return this.ok({ ...batch, records, matches, exceptions });
  }

  async listBatches(params: BatchListParams): Promise<Result<ReconciliationBatchDTO[]>> {
    if (!params.tenantId) return this.validationFailure('tenantId is required');

    if (this.usePrisma()) {
      const batches = await prisma.reconciliationBatch.findMany({
        where: {
          tenantId: params.tenantId,
          ...(params.from ? { periodStart: { gte: params.from } } : {}),
          ...(params.to ? { periodEnd: { lte: params.to } } : {}),
        },
        orderBy: { periodStart: 'desc' },
      });
      return this.ok(
        batches.map((b) => ({
          id: b.id,
          tenantId: b.tenantId,
          periodStart: b.periodStart.toISOString(),
          periodEnd: b.periodEnd.toISOString(),
          status: b.status,
          totalRecords: b.totalRecords,
          matchedCount: b.matchedCount,
          exceptionCount: b.exceptionCount,
          matchedAmount: Number(b.matchedAmount),
          unmatchedAmount: Number(b.unmatchedAmount),
          startedAt: b.startedAt?.toISOString() ?? null,
          completedAt: b.completedAt?.toISOString() ?? null,
          createdAt: b.createdAt.toISOString(),
          updatedAt: b.updatedAt.toISOString(),
        })),
      );
    }

    let batches = [...this.memBatches.values()].filter((b) => b.tenantId === params.tenantId);
    if (params.from) batches = batches.filter((b) => new Date(b.periodStart) >= params.from!);
    if (params.to) batches = batches.filter((b) => new Date(b.periodEnd) <= params.to!);
    batches.sort((a, b) => new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime());
    return this.ok(batches);
  }

  async getBatchReport(id: string): Promise<Result<ReconciliationReport>> {
    const detail = await this.getBatchDetail(id);
    if (!detail.ok) return detail;
    const b = detail.value;

    const bySourceMap = new Map<ReconciliationSource, { total: number; matched: number; unmatched: number }>();
    for (const r of b.records) {
      const agg = bySourceMap.get(r.source) ?? { total: 0, matched: 0, unmatched: 0 };
      agg.total += 1;
      if (r.matched) agg.matched += 1;
      else agg.unmatched += 1;
      bySourceMap.set(r.source, agg);
    }

    const reasonMap = new Map<string, { count: number; amount: number }>();
    for (const e of b.exceptions) {
      const agg = reasonMap.get(e.reason) ?? { count: 0, amount: 0 };
      agg.count += 1;
      agg.amount = round(agg.amount + e.amount, 8);
      reasonMap.set(e.reason, agg);
    }

    const matchedRecords = b.totalRecords - b.exceptionCount;
    const matchRatePct = b.totalRecords === 0 ? 0 : round((matchedRecords / b.totalRecords) * 100, 2);

    return this.ok({
      batchId: b.id,
      tenantId: b.tenantId,
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
      status: b.status,
      totalRecords: b.totalRecords,
      matchedCount: b.matchedCount,
      exceptionCount: b.exceptionCount,
      matchRatePct,
      matchedAmount: b.matchedAmount,
      unmatchedAmount: b.unmatchedAmount,
      bySource: [...bySourceMap.entries()].map(([source, agg]) => ({ source, ...agg })),
      exceptionsByReason: [...reasonMap.entries()].map(([reason, agg]) => ({ reason, ...agg })),
      generatedAt: new Date().toISOString(),
    });
  }

  /** Regulatory/ops CSV export of a batch reconciliation report. */
  reportToCsv(report: ReconciliationReport): string {
    const rows: string[][] = [
      ['Field', 'Value'],
      ['Batch', report.batchId],
      ['Tenant', report.tenantId],
      ['Period Start', report.periodStart],
      ['Period End', report.periodEnd],
      ['Status', report.status],
      ['Total Records', String(report.totalRecords)],
      ['Matched Pairs', String(report.matchedCount)],
      ['Exceptions', String(report.exceptionCount)],
      ['Match Rate %', report.matchRatePct.toFixed(2)],
      ['Matched Amount', report.matchedAmount.toFixed(8)],
      ['Unmatched Amount', report.unmatchedAmount.toFixed(8)],
      [],
      ['Source', 'Total', 'Matched', 'Unmatched'],
      ...report.bySource.map((s) => [s.source, String(s.total), String(s.matched), String(s.unmatched)]),
      [],
      ['Exception Reason', 'Count', 'Amount'],
      ...report.exceptionsByReason.map((r) => [r.reason, String(r.count), r.amount.toFixed(8)]),
    ];
    return toCsv(rows);
  }

  // ── Exception workflow ───────────────────────────────────────────────────

  async listExceptions(params: ExceptionListParams): Promise<Result<ReconciliationExceptionDTO[]>> {
    if (!params.tenantId) return this.validationFailure('tenantId is required');

    if (this.usePrisma()) {
      const rows = await prisma.reconciliationException.findMany({
        where: { tenantId: params.tenantId, ...(params.status ? { status: params.status } : {}) },
        orderBy: { createdAt: 'desc' },
      });
      return this.ok(
        rows.map((e) => ({
          id: e.id,
          batchId: e.batchId,
          tenantId: e.tenantId,
          recordId: e.recordId,
          reason: e.reason,
          status: e.status,
          amount: Number(e.amount),
          currency: e.currency,
          assignedTo: e.assignedTo,
          resolutionNote: e.resolutionNote,
          resolvedAt: e.resolvedAt?.toISOString() ?? null,
          createdAt: e.createdAt.toISOString(),
          updatedAt: e.updatedAt.toISOString(),
        })),
      );
    }

    let rows = [...this.memExceptions.values()].filter((e) => e.tenantId === params.tenantId);
    if (params.status) rows = rows.filter((e) => e.status === params.status);
    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return this.ok(rows);
  }

  private isTerminalStatus(status: ExceptionStatus): boolean {
    return status === 'resolved' || status === 'written_off';
  }

  async updateException(id: string, updates: ExceptionUpdateInput): Promise<Result<ReconciliationExceptionDTO>> {
    const now = new Date();

    if (this.usePrisma()) {
      const existing = await prisma.reconciliationException.findUnique({ where: { id } });
      if (!existing) return this.notFoundFailure('ReconciliationException', id);

      const resolvedAt = updates.status
        ? this.isTerminalStatus(updates.status)
          ? now
          : null
        : existing.resolvedAt;

      const updated = await prisma.reconciliationException.update({
        where: { id },
        data: {
          status: updates.status ?? undefined,
          assignedTo: updates.assignedTo !== undefined ? updates.assignedTo : undefined,
          resolutionNote: updates.resolutionNote !== undefined ? updates.resolutionNote : undefined,
          resolvedAt,
        },
      });

      return this.ok({
        id: updated.id,
        batchId: updated.batchId,
        tenantId: updated.tenantId,
        recordId: updated.recordId,
        reason: updated.reason,
        status: updated.status,
        amount: Number(updated.amount),
        currency: updated.currency,
        assignedTo: updated.assignedTo,
        resolutionNote: updated.resolutionNote,
        resolvedAt: updated.resolvedAt?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      });
    }

    const existing = this.memExceptions.get(id);
    if (!existing) return this.notFoundFailure('ReconciliationException', id);

    const nextStatus = updates.status ?? existing.status;
    const merged: ReconciliationExceptionDTO = {
      ...existing,
      status: nextStatus,
      assignedTo: updates.assignedTo !== undefined ? updates.assignedTo : existing.assignedTo,
      resolutionNote: updates.resolutionNote !== undefined ? updates.resolutionNote : existing.resolutionNote,
      resolvedAt: updates.status ? (this.isTerminalStatus(updates.status) ? now.toISOString() : null) : existing.resolvedAt,
      updatedAt: now.toISOString(),
    };
    this.memExceptions.set(id, merged);
    return this.ok(merged);
  }

  // ── Analytics ────────────────────────────────────────────────────────────

  async getAnalytics(params: BatchListParams): Promise<Result<ReconciliationAnalytics>> {
    const batchesResult = await this.listBatches(params);
    if (!batchesResult.ok) return batchesResult;
    const batches = batchesResult.value;

    const exceptionsResult = await this.listExceptions({ tenantId: params.tenantId });
    if (!exceptionsResult.ok) return exceptionsResult;
    let exceptions = exceptionsResult.value;
    if (params.from) exceptions = exceptions.filter((e) => new Date(e.createdAt) >= params.from!);
    if (params.to) exceptions = exceptions.filter((e) => new Date(e.createdAt) <= params.to!);

    const totalRecords = batches.reduce((s, b) => s + b.totalRecords, 0);
    const totalExceptionSlots = batches.reduce((s, b) => s + b.exceptionCount, 0);
    const matchRatePct = totalRecords === 0 ? 0 : round(((totalRecords - totalExceptionSlots) / totalRecords) * 100, 2);

    const resolved = exceptions.filter((e) => e.resolvedAt);
    const meanTimeToResolveExceptionsHours =
      resolved.length === 0
        ? null
        : round(
            resolved.reduce((sum, e) => sum + (new Date(e.resolvedAt!).getTime() - new Date(e.createdAt).getTime()), 0) /
              resolved.length /
              3_600_000,
            2,
          );

    const reasonMap = new Map<string, number>();
    for (const e of exceptions) reasonMap.set(e.reason, (reasonMap.get(e.reason) ?? 0) + 1);
    const exceptionReasons = [...reasonMap.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    const sortedBatches = [...batches].sort((a, b) => new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime());
    const trend = sortedBatches.map((b) => ({
      batchId: b.id,
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
      matchRatePct: b.totalRecords === 0 ? 0 : round(((b.totalRecords - b.exceptionCount) / b.totalRecords) * 100, 2),
      totalRecords: b.totalRecords,
      exceptionCount: b.exceptionCount,
    }));

    return this.ok({
      tenantId: params.tenantId,
      periodStart: params.from?.toISOString() ?? sortedBatches[0]?.periodStart ?? null,
      periodEnd: params.to?.toISOString() ?? sortedBatches[sortedBatches.length - 1]?.periodEnd ?? null,
      totalBatches: batches.length,
      totalRecords,
      matchRatePct,
      meanTimeToResolveExceptionsHours,
      openExceptionCount: exceptions.filter((e) => e.status === 'open' || e.status === 'investigating').length,
      exceptionReasons,
      trend,
      generatedAt: new Date().toISOString(),
    });
  }

  // ── Scheduling support ───────────────────────────────────────────────────

  /** Distinct tenant ids with Payment activity in [periodStart, periodEnd). */
  async getTenantsWithActivity(periodStart: Date, periodEnd: Date): Promise<string[]> {
    if (!this.usePrisma()) {
      return [
        ...new Set(
          this.memPayments
            .filter((p) => p.createdAt >= periodStart && p.createdAt < periodEnd)
            .map((p) => p.tenantId),
        ),
      ];
    }

    const rows = await prisma.payment.findMany({
      where: { createdAt: { gte: periodStart, lt: periodEnd }, deletedAt: null },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    return rows.map((r) => r.tenantId);
  }
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export { ReconciliationService };
export const reconciliationService = new ReconciliationService();
