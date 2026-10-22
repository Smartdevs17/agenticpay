/**
 * report-format.ts — shared primitives for the reporting services
 * (Issues #937, #938, #939 and #940).
 *
 * Money maths, date-range parsing, CSV serialisation and the lightweight
 * PDF writer live here so every report agrees on rounding, period keys and
 * error semantics.
 */

import { AppError } from '../../middleware/errorHandler.js';

/** Every monetary value in a report is carried at 8 decimal places. */
export const REPORT_MONEY_SCALE = 8;

const MONEY_FACTOR = 10 ** REPORT_MONEY_SCALE;

/** Platform fee applied to recognised revenue when nothing is configured. */
export const DEFAULT_PLATFORM_FEE_BPS = 0;

/** Upper bound on the rows a single report will materialise in memory. */
export const MAX_REPORT_ROWS = 10_000;

/**
 * Reads the configured platform fee rate in basis points.
 *
 * `REPORT_PLATFORM_FEE_BPS` lets an operator run statements against the real
 * fee schedule without a code change. Invalid values are rejected loudly
 * rather than silently reporting a wrong number.
 */
export function platformFeeBps(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.REPORT_PLATFORM_FEE_BPS;
  if (raw === undefined || raw === '') return DEFAULT_PLATFORM_FEE_BPS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10_000) {
    throw new AppError(
      400,
      'REPORT_PLATFORM_FEE_BPS must be a number between 0 and 10000',
      'INVALID_FEE_BPS',
    );
  }
  return parsed;
}

/** Coerces Prisma Decimals, numeric strings and numbers into a JS number. */
export function toAmount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value !== null && typeof value === 'object') {
    const candidate = value as { toNumber?: () => number; toString?: () => string };
    if (typeof candidate.toNumber === 'function') {
      const parsed = candidate.toNumber();
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof candidate.toString === 'function') {
      const parsed = Number(candidate.toString());
      return Number.isFinite(parsed) ? parsed : 0;
    }
  }
  return 0;
}

/** Rounds to the report money scale so repeated sums do not drift. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * MONEY_FACTOR) / MONEY_FACTOR;
}

/** Fee charged on `amount` for the given basis-point rate. */
export function feeForAmount(amount: number, feeBps: number): number {
  return roundMoney((amount * feeBps) / 10_000);
}

export interface ReportPeriod {
  dateFrom: string;
  dateTo: string;
  from: Date;
  to: Date;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function boundary(value: string, endOfDay: boolean): Date {
  if (DATE_ONLY.test(value)) {
    return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(NaN) : parsed;
}

/**
 * Validates and normalises a report date range.
 *
 * Date-only strings are treated as UTC days so that a report for
 * `2026-01-01`..`2026-01-31` always covers the same window regardless of the
 * server timezone.
 */
export function parseReportPeriod(dateFrom: unknown, dateTo: unknown): ReportPeriod {
  if (typeof dateFrom !== 'string' || typeof dateTo !== 'string' || !dateFrom || !dateTo) {
    throw new AppError(400, 'dateFrom and dateTo are required', 'VALIDATION_ERROR');
  }

  const from = boundary(dateFrom, false);
  const to = boundary(dateTo, true);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new AppError(400, 'dateFrom and dateTo must be valid ISO dates', 'VALIDATION_ERROR');
  }
  if (from.getTime() > to.getTime()) {
    throw new AppError(400, 'dateFrom must not be after dateTo', 'VALIDATION_ERROR');
  }

  return { dateFrom, dateTo, from, to };
}

/** UTC day key, e.g. `2026-01-31`. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** UTC month key, e.g. `2026-01`. */
export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** UTC week key starting on Monday, e.g. `2026-01-26`. */
export function weekKey(date: Date): string {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - weekday);
  return start.toISOString().slice(0, 10);
}

/** Quotes a single CSV cell when it contains a separator, quote or newline. */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export interface CsvBlock {
  header: string[];
  rows: unknown[][];
}

/** Joins CSV blocks into one document, separating them with a blank line. */
export function buildCsv(blocks: CsvBlock[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    if (lines.length > 0) lines.push('');
    lines.push(block.header.map(escapeCsvCell).join(','));
    for (const row of block.rows) {
      lines.push(row.map(escapeCsvCell).join(','));
    }
  }

  return lines.join('\n');
}

/**
 * Writes a minimal, dependency-free PDF containing monospaced text.
 *
 * The reports are plain ledgers, so a text-only PDF is enough to make them
 * downloadable without pulling a PDF library into the backend.
 */
export function buildTextPdf(title: string, lines: string[]): Buffer {
  const text = [title, '='.repeat(60), ...lines].join('\n');
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  return Buffer.from(
    'PDF-1.4\n%\xFF\xFF\xFF\xFF\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n' +
      `4 0 obj\n<< /Length ${escaped.length} >>\nstream\n${escaped}\nendstream\nendobj\n` +
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
      'xref\n0 6\n' +
      '0000000000 65535 f \n' +
      '0000000009 00000 n \n' +
      '0000000058 00000 n \n' +
      '0000000115 00000 n \n' +
      '0000000266 00000 n \n' +
      '0000000378 00000 n \n' +
      'trailer\n<< /Size 6 /Root 1 0 R >>\n' +
      'startxref\n446\n%%EOF',
  );
}
