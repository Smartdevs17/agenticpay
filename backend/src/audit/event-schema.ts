/**
 * Canonical audit event schema — Issue #396
 *
 * Every audit record must carry the four fields the issue requires (actor,
 * action, resource, timestamp) plus a best-effort outcome, origin and
 * correlation context. This module is the single place that:
 *
 *  1. defines that schema (`auditEventSchema`),
 *  2. normalises untrusted input into it, and
 *  3. defends the log against **log injection** and **CSV injection**.
 *
 * Log injection: a caller can smuggle `\n`, `\r` or ANSI escapes into a detail
 * value and forge additional log lines, or break the NDJSON archive format.
 * All free-text is therefore stripped of control characters and length-capped
 * before it is hashed or persisted.
 *
 * CSV injection: spreadsheet software executes cells starting with `= + - @`
 * (or tab/CR), so exported audit rows are prefixed with `'` to neutralise
 * formulas.
 */

import { z } from 'zod';

/** Hard caps keep untrusted fields from bloating storage (see issue #396 notes on storage cost). */
export const AUDIT_LIMITS = {
  actor: 256,
  action: 128,
  resource: 128,
  resourceId: 256,
  ipAddress: 64,
  userAgent: 512,
  correlationId: 128,
  detailKeys: 64,
  detailDepth: 4,
  detailString: 1_024,
  detailArray: 64,
  outcome: 16,
} as const;

// These patterns intentionally match control characters: stripping them is the
// whole point (they are what make log injection possible).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPES = /\u001B\[[0-9;]*[A-Za-z]/g;

/**
 * Strip characters that could forge log lines, corrupt NDJSON archives, or
 * inject terminal escape sequences, then truncate to `maxLength`.
 */
export function sanitizeAuditText(value: string, maxLength: number = AUDIT_LIMITS.detailString): string {
  const withoutEscapes = value.replace(ANSI_ESCAPES, '');
  return withoutEscapes
    .replace(CONTROL_CHARACTERS, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Recursively sanitise an arbitrary value so it is safe to persist and hash. */
export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeAuditText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();

  if (depth >= AUDIT_LIMITS.detailDepth) return '[TRUNCATED_DEPTH]';

  if (Array.isArray(value)) {
    return value.slice(0, AUDIT_LIMITS.detailArray).map((item) => sanitizeAuditValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, AUDIT_LIMITS.detailKeys);
    return Object.fromEntries(
      entries.map(([key, nested]) => [sanitizeAuditText(key, 128), sanitizeAuditValue(nested, depth + 1)])
    );
  }

  // Functions, symbols, etc. are not serialisable.
  return `[UNSERIALIZABLE:${typeof value}]`;
}

/** Deep-sanitise a detail bag, preserving `undefined` when there is nothing to record. */
export function sanitizeAuditDetails(
  details?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const sanitized = sanitizeAuditValue(details, 0);
  return typeof sanitized === 'object' && sanitized !== null ? (sanitized as Record<string, unknown>) : undefined;
}

/**
 * Escape a value for CSV output. Quoting alone does not stop spreadsheet
 * formula execution, so leading formula characters are prefixed with `'`.
 */
export function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const neutralized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${sanitizeAuditText(neutralized, 8_192).replace(/"/g, '""')}"`;
}

const timestampSchema = z.union([z.number().int().nonnegative(), z.string(), z.date()]);

/** The canonical, validated shape of an audit event. */
export const auditEventSchema = z.object({
  id: z.string().max(128).optional(),
  actor: z.string().min(1).max(AUDIT_LIMITS.actor),
  action: z
    .string()
    .min(1)
    .max(AUDIT_LIMITS.action)
    .regex(/^[A-Za-z0-9._:\-/]+$/, 'action may only contain letters, digits and . _ : - /'),
  resource: z.string().min(1).max(AUDIT_LIMITS.resource),
  resourceId: z.string().max(AUDIT_LIMITS.resourceId).optional(),
  timestamp: timestampSchema,
  outcome: z.enum(['success', 'failure']).optional(),
  ipAddress: z.string().max(AUDIT_LIMITS.ipAddress).optional(),
  userAgent: z.string().max(AUDIT_LIMITS.userAgent).optional(),
  requestMethod: z.string().max(16).optional(),
  requestPath: z.string().max(2_048).optional(),
  responseStatus: z.number().int().min(100).max(599).optional(),
  correlationId: z.string().max(AUDIT_LIMITS.correlationId).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  suspicious: z.boolean().optional(),
  flags: z.array(z.string().max(128)).max(32).optional(),
});

export type AuditEvent = Omit<z.infer<typeof auditEventSchema>, 'timestamp'> & {
  /** Always normalised to epoch milliseconds by {@link normalizeAuditEvent}. */
  timestamp: number;
};

/** Thrown when an audit event cannot be normalised into the canonical schema. */
export class AuditEventValidationError extends Error {
  constructor(
    message: string,
    readonly issues: z.ZodIssue[] = []
  ) {
    super(message);
    this.name = 'AuditEventValidationError';
  }
}

export interface AuditEventInput {
  id?: string;
  actor?: string;
  action: string;
  resource: string;
  resourceId?: string;
  timestamp?: number | string | Date;
  outcome?: 'success' | 'failure';
  ipAddress?: string;
  userAgent?: string;
  requestMethod?: string;
  requestPath?: string;
  responseStatus?: number;
  correlationId?: string;
  details?: Record<string, unknown>;
  suspicious?: boolean;
  flags?: string[];
}

/** Normalise a timestamp into epoch milliseconds. */
export function normalizeTimestamp(timestamp: number | string | Date | undefined): number {
  if (timestamp === undefined) return Date.now();
  if (typeof timestamp === 'number') return timestamp;
  if (timestamp instanceof Date) return timestamp.getTime();
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

/**
 * Sanitise then validate an event. Returns the canonical event with an epoch
 * timestamp and fully sanitised free-text fields.
 *
 * @throws {AuditEventValidationError} when required fields are missing/invalid.
 */
export function normalizeAuditEvent(input: AuditEventInput): AuditEvent {
  const candidate = {
    id: input.id ? sanitizeAuditText(input.id, 128) : undefined,
    actor: sanitizeAuditText(input.actor ?? 'system', AUDIT_LIMITS.actor) || 'system',
    action: sanitizeAuditText(input.action ?? '', AUDIT_LIMITS.action),
    resource: sanitizeAuditText(input.resource ?? '', AUDIT_LIMITS.resource),
    resourceId: input.resourceId ? sanitizeAuditText(input.resourceId, AUDIT_LIMITS.resourceId) : undefined,
    timestamp: normalizeTimestamp(input.timestamp),
    outcome: input.outcome,
    ipAddress: input.ipAddress ? sanitizeAuditText(input.ipAddress, AUDIT_LIMITS.ipAddress) : undefined,
    userAgent: input.userAgent ? sanitizeAuditText(input.userAgent, AUDIT_LIMITS.userAgent) : undefined,
    requestMethod: input.requestMethod ? sanitizeAuditText(input.requestMethod, 16) : undefined,
    requestPath: input.requestPath ? sanitizeAuditText(input.requestPath, 2_048) : undefined,
    responseStatus: input.responseStatus,
    correlationId: input.correlationId
      ? sanitizeAuditText(input.correlationId, AUDIT_LIMITS.correlationId)
      : undefined,
    details: sanitizeAuditDetails(input.details),
    suspicious: input.suspicious,
    flags: input.flags?.map((flag) => sanitizeAuditText(flag, 128)).slice(0, 32),
  };

  const result = auditEventSchema.safeParse(candidate);
  if (!result.success) {
    throw new AuditEventValidationError(
      `Invalid audit event: ${result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
      result.error.issues
    );
  }

  return { ...result.data, timestamp: normalizeTimestamp(result.data.timestamp) };
}

/**
 * Check whether an event carries every field PCI-DSS 10.3 expects to be
 * recorded (user, event type, date/time, success/failure, origin, identity).
 */
export function checkPciDssFieldCompleteness(event: AuditEvent): {
  complete: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  if (!event.actor) missing.push('userIdentification');
  if (!event.action) missing.push('typeOfEvent');
  if (!event.timestamp) missing.push('dateAndTime');
  if (!event.outcome) missing.push('successOrFailure');
  if (!event.ipAddress) missing.push('originOfEvent');
  return { complete: missing.length === 0, missing };
}
