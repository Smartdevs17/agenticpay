/**
 * Real-time audit alerting for critical events — Issue #396
 *
 * Acceptance criterion: *"Real-time audit alerting for critical events."*
 *
 * The chain verifier already alerts on hash mismatches, but nothing watches the
 * audit stream itself. This module classifies every audit event against a
 * declarative rule set and pushes anything at/above the configured severity to
 * the registered sinks (structured log by default, optional webhook).
 *
 * Alerts are de-duplicated inside a sliding window so a burst of failed logins
 * from one actor produces one alert with an occurrence count rather than
 * thousands of pages.
 */

import { logger } from '../utils/logger.js';
import type { AuditEvent } from './event-schema.js';

export type AuditSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/** Numeric ordering used for threshold comparisons. */
export const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export interface CriticalEventRule {
  /** Stable identifier, also used as the de-duplication key. */
  id: string;
  severity: AuditSeverity;
  description: string;
  match: (event: AuditEvent) => boolean;
}

/** Payment amount above which a payment event is treated as materially risky. */
const LARGE_PAYMENT_THRESHOLD = Number(process.env.AUDIT_LARGE_PAYMENT_THRESHOLD ?? 10_000);

const action = (event: AuditEvent): string => event.action.toLowerCase();
const resource = (event: AuditEvent): string => event.resource.toLowerCase();
const has = (event: AuditEvent, ...needles: string[]): boolean => {
  const haystack = `${action(event)} ${resource(event)} ${event.requestPath ?? ''}`.toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
};

function paymentAmount(event: AuditEvent): number | undefined {
  const raw = event.details?.['amount'] ?? event.details?.['amountUsd'] ?? event.details?.['total'];
  const numeric = typeof raw === 'string' ? Number(raw) : raw;
  return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : undefined;
}

/**
 * Declarative rules for security-relevant events. First match wins, so the
 * rules are ordered most-severe first.
 */
export const CRITICAL_EVENT_RULES: CriticalEventRule[] = [
  {
    id: 'audit.integrity_failure',
    severity: 'critical',
    description: 'Audit log integrity check reported a broken hash chain',
    match: (event) => has(event, 'audit.integrity', 'chain.verify', 'tamper'),
  },
  {
    id: 'audit.suspicious_flag',
    severity: 'high',
    description: 'An audit entry was flagged as suspicious',
    match: (event) => action(event).includes('audit.suspicious'),
  },
  {
    id: 'privilege.escalation',
    severity: 'critical',
    description: 'Role, permission or impersonation change',
    match: (event) => has(event, 'roles', 'permissions', 'impersonate', 'privilege'),
  },
  {
    id: 'auth.secret_rotation',
    severity: 'high',
    description: 'API key or secret created, rotated or revoked',
    match: (event) => has(event, 'api-keys', 'apikey', 'secrets', 'rotate', 'credential'),
  },
  {
    id: 'auth.failure',
    severity: 'medium',
    description: 'Failed authentication or authorization attempt',
    match: (event) => has(event, 'auth', 'login', '2fa', 'mfa', 'otp', 'token', 'oauth') && event.outcome === 'failure',
  },
  {
    id: 'payment.large_value',
    severity: 'high',
    description: `Payment, transfer payout or refund at or above the ${LARGE_PAYMENT_THRESHOLD} threshold`,
    match: (event) => {
      if (!has(event, 'payment', 'transfer', 'payout', 'withdrawal', 'refund', 'escrow')) return false;
      const amount = paymentAmount(event);
      return amount !== undefined && amount >= LARGE_PAYMENT_THRESHOLD;
    },
  },
  {
    id: 'payment.failure',
    severity: 'medium',
    description: 'Failed payment, transfer or payout operation',
    match: (event) => has(event, 'payment', 'transfer', 'payout', 'refund') && event.outcome === 'failure',
  },
  {
    id: 'compliance.sanctions_hit',
    severity: 'critical',
    description: 'Sanctions screening or AML rule produced a hit',
    match: (event) => has(event, 'sanctions', 'aml', 'ofac'),
  },
  {
    id: 'audit.mutation',
    severity: 'high',
    description: 'Audit log mutation or deletion attempt',
    match: (event) => action(event).includes('audit') && has(event, 'delete', 'clear', 'purge', 'export'),
  },
];

export interface AuditAlert {
  id: string;
  ruleId: string;
  severity: AuditSeverity;
  description: string;
  /** Number of events folded into this alert inside the de-duplication window. */
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  actor: string;
  action: string;
  resource: string;
  resourceId?: string;
  ipAddress?: string;
  correlationId?: string;
  details?: Record<string, unknown>;
}

/** Destination for dispatched alerts. */
export interface AuditAlertSink {
  name: string;
  send(alert: AuditAlert): Promise<void>;
}

/** Default sink: structured application log. */
export const loggerAlertSink: AuditAlertSink = {
  name: 'logger',
  async send(alert) {
    const level = alert.severity === 'critical' || alert.severity === 'high' ? 'error' : 'warn';
    logger[level]({ alert }, `[audit-alert] ${alert.ruleId}: ${alert.description}`);
  },
};

/** Optional sink that POSTs alerts to a chat/on-call webhook. */
export function webhookAlertSink(url: string, fetchImpl: typeof fetch = fetch): AuditAlertSink {
  return {
    name: 'webhook',
    async send(alert) {
      await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `[${alert.severity.toUpperCase()}] ${alert.description}`,
          alert,
        }),
      });
    },
  };
}

export interface AuditAlerterOptions {
  sinks?: AuditAlertSink[];
  /** Minimum severity that produces an alert. Defaults to `medium`. */
  minSeverity?: AuditSeverity;
  /** Window in which identical alerts are folded together. Defaults to 60s. */
  dedupeWindowMs?: number;
  /** Cap on retained alert history. Defaults to 500. */
  maxRecentAlerts?: number;
  rules?: CriticalEventRule[];
  now?: () => number;
}

/**
 * Classifies audit events and dispatches alerts for critical ones.
 *
 * Sink failures are swallowed (logged) so alerting can never break the request
 * path that produced the audit entry.
 */
export class AuditAlerter {
  private readonly sinks: AuditAlertSink[];
  private readonly minSeverity: AuditSeverity;
  private readonly dedupeWindowMs: number;
  private readonly maxRecentAlerts: number;
  private readonly rules: CriticalEventRule[];
  private readonly now: () => number;
  private readonly recent: AuditAlert[] = [];

  constructor(options: AuditAlerterOptions = {}) {
    this.sinks = options.sinks ?? [loggerAlertSink];
    this.minSeverity = options.minSeverity ?? (process.env.AUDIT_ALERT_MIN_SEVERITY as AuditSeverity) ?? 'medium';
    this.dedupeWindowMs = options.dedupeWindowMs ?? 60_000;
    this.maxRecentAlerts = options.maxRecentAlerts ?? 500;
    this.rules = options.rules ?? CRITICAL_EVENT_RULES;
    this.now = options.now ?? (() => Date.now());
  }

  /** The highest-severity rule matching the event, if any. */
  classify(event: AuditEvent): CriticalEventRule | undefined {
    return this.rules.find((rule) => rule.match(event));
  }

  /** True when the event would raise an alert at the configured threshold. */
  isAlertable(event: AuditEvent): boolean {
    const rule = this.classify(event);
    return rule !== undefined && SEVERITY_ORDER[rule.severity] >= SEVERITY_ORDER[this.minSeverity];
  }

  /**
   * Classify and dispatch. Returns the alert when one was raised, or
   * `undefined` when the event was below threshold. A repeat of an active alert
   * increments `occurrences` and returns the same alert.
   */
  async dispatch(event: AuditEvent): Promise<AuditAlert | undefined> {
    const rule = this.classify(event);
    if (!rule || SEVERITY_ORDER[rule.severity] < SEVERITY_ORDER[this.minSeverity]) return undefined;

    const nowMs = this.now();
    const alert = this.dedupe(rule, event, nowMs);

    if (alert.occurrences > 1) {
      // Folded into an active alert: no second page, just an audit trail.
      logger.warn({ alertId: alert.id, ruleId: alert.ruleId, occurrences: alert.occurrences }, 'Audit alert repeated');
      return alert;
    }

    await this.emit(alert);
    return alert;
  }

  private dedupe(rule: CriticalEventRule, event: AuditEvent, nowMs: number): AuditAlert {
    const timestamp = new Date(nowMs).toISOString();
    const existing = this.recent.find(
      (candidate) =>
        candidate.ruleId === rule.id &&
        candidate.actor === event.actor &&
        candidate.resource === event.resource &&
        nowMs - Date.parse(candidate.lastSeenAt) <= this.dedupeWindowMs
    );

    if (existing) {
      existing.occurrences += 1;
      existing.lastSeenAt = timestamp;
      return existing;
    }

    const alert: AuditAlert = {
      id: `${rule.id}:${event.actor}:${event.resource}:${nowMs}`,
      ruleId: rule.id,
      severity: rule.severity,
      description: rule.description,
      occurrences: 1,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      actor: event.actor,
      action: event.action,
      resource: event.resource,
      resourceId: event.resourceId,
      ipAddress: event.ipAddress,
      correlationId: event.correlationId,
      details: event.details,
    };

    this.recent.unshift(alert);
    if (this.recent.length > this.maxRecentAlerts) this.recent.length = this.maxRecentAlerts;
    return alert;
  }

  private async emit(alert: AuditAlert): Promise<void> {
    await Promise.all(
      this.sinks.map((sink) =>
        sink.send(alert).catch((error: unknown) => {
          logger.error({ error, sink: sink.name, alertId: alert.id }, 'Audit alert sink failed');
        })
      )
    );
  }

  /** Most recent alerts, newest first. */
  listRecentAlerts(limit = 50): AuditAlert[] {
    return this.recent.slice(0, limit);
  }

  /** Counts of retained alerts grouped by severity. */
  alertCounts(): Record<AuditSeverity, number> {
    const counts: Record<AuditSeverity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
    for (const alert of this.recent) counts[alert.severity] += 1;
    return counts;
  }
}

/** Application-wide alerter, wired to the audit service in `services/auditService.ts`. */
export const auditAlerter = new AuditAlerter({
  sinks: process.env.AUDIT_ALERT_WEBHOOK_URL
    ? [loggerAlertSink, webhookAlertSink(process.env.AUDIT_ALERT_WEBHOOK_URL)]
    : [loggerAlertSink],
});
