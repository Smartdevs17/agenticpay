import { createHash } from 'node:crypto';
import { randomUUID as uuidv4 } from 'node:crypto';

import { AuditAlerter, auditAlerter, type AuditAlert, type AuditSeverity } from '../audit/alerting.js';
import {
  complianceReportToCsv,
  generateComplianceReport,
  type ComplianceReport,
  type ComplianceReportOptions,
} from '../audit/compliance-report.js';
import {
  escapeCsvCell,
  normalizeAuditEvent,
  sanitizeAuditDetails,
  sanitizeAuditText,
  type AuditEvent,
} from '../audit/event-schema.js';
import {
  AuditArchiveStore,
  DEFAULT_RETENTION_POLICY,
  enforceRetention,
  planRetention,
  type ArchiveManifest,
  type AuditRetentionPolicy,
  type ChainedAuditEntry,
  type RetentionEnforcementResult,
} from '../audit/retention.js';

/** Whether a sensitive operation succeeded or failed. */
export type AuditOutcome = 'success' | 'failure';

export interface AuditEntry {
  id: string;
  timestamp: number;
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  /** Result of the operation — issue #793 requires an explicit outcome. */
  outcome?: AuditOutcome;
  details?: Record<string, unknown>;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  requestMethod?: string;
  requestPath?: string;
  requestBody?: unknown;
  responseStatus?: number;
  previousHash: string;
  hash: string;
  suspicious?: boolean;
  flags?: string[];
}

export interface AuditQuery {
  userId?: string;
  action?: string;
  resource?: string;
  startDate?: number;
  endDate?: number;
  suspicious?: boolean;
  limit?: number;
  offset?: number;
}

export interface RetentionPolicy {
  retentionDays: number;
  archiveAfterDays: number;
  deleteAfterDays: number;
}

export interface AuditServiceOptions {
  policy?: Partial<RetentionPolicy>;
  /** Disable real-time critical-event alerting (enabled by default). */
  alerting?: boolean;
  alerter?: AuditAlerter;
  archiveDir?: string;
}

export class AuditService {
  private entries: AuditEntry[] = [];
  private currentHash = '0000000000000000000000000000000000000000000000000000000000000000';
  /**
   * Hash immediately preceding the oldest retained entry. Archival/eviction
   * moves this forward so `verifyIntegrity()` keeps validating the retained
   * chain instead of reporting a break at the first evicted entry (issue #396).
   */
  private chainAnchor = '0000000000000000000000000000000000000000000000000000000000000000';
  private retentionPolicy: RetentionPolicy = {
    retentionDays: 2555,
    archiveAfterDays: 2190,
    deleteAfterDays: 3650,
  };
  private readonly alerter: AuditAlerter;
  private readonly alertingEnabled: boolean;
  private archiveDir: string = DEFAULT_RETENTION_POLICY.archiveDir;

  constructor(options: Partial<RetentionPolicy> | AuditServiceOptions = {}) {
    const isOptionsObject =
      'policy' in options || 'alerting' in options || 'alerter' in options || 'archiveDir' in options;

    if (isOptionsObject) {
      const { policy, alerting, alerter, archiveDir } = options as AuditServiceOptions;
      if (policy) this.retentionPolicy = { ...this.retentionPolicy, ...policy };
      if (archiveDir) this.archiveDir = archiveDir;
      this.alerter = alerter ?? auditAlerter;
      this.alertingEnabled = alerting ?? true;
    } else {
      // Backwards-compatible constructor: `new AuditService({ retentionDays })`.
      this.retentionPolicy = { ...this.retentionPolicy, ...(options as Partial<RetentionPolicy>) };
      this.alerter = auditAlerter;
      this.alertingEnabled = true;
    }
  }

  private computeHash(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  private generateEntryHash(entry: Omit<AuditEntry, 'hash'>): string {
    const data = [
      entry.id,
      entry.timestamp,
      entry.userId || '',
      entry.action,
      entry.resource,
      entry.resourceId || '',
      entry.outcome || '',
      JSON.stringify(entry.details || {}),
      JSON.stringify(entry.beforeState || {}),
      JSON.stringify(entry.afterState || {}),
      entry.ipAddress || '',
      entry.requestMethod || '',
      entry.requestPath || '',
      entry.previousHash,
    ].join('|');
    return this.computeHash(data);
  }

  async logAction(params: {
    userId?: string;
    action: string;
    resource: string;
    resourceId?: string;
    /** Explicit outcome; derived from `response.status` when omitted. */
    outcome?: AuditOutcome;
    details?: Record<string, unknown>;
    beforeState?: Record<string, unknown>;
    afterState?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    request?: {
      method?: string;
      path?: string;
      body?: unknown;
    };
    response?: {
      status?: number;
    };
  }): Promise<AuditEntry> {
    const id = uuidv4();
    const timestamp = Date.now();

    const status = params.response?.status;
    const outcome: AuditOutcome | undefined =
      params.outcome ?? (typeof status === 'number' ? (status >= 400 ? 'failure' : 'success') : undefined);

    const entry: Omit<AuditEntry, 'hash'> = {
      id,
      timestamp,
      // Sanitised on write so untrusted values cannot forge log lines or bloat
      // storage (issue #396 — log injection / high-volume storage).
      userId: params.userId ? sanitizeAuditText(params.userId, 256) : undefined,
      action: sanitizeAuditText(params.action, 128),
      resource: sanitizeAuditText(params.resource, 128),
      resourceId: params.resourceId ? sanitizeAuditText(params.resourceId, 256) : undefined,
      outcome,
      details: sanitizeAuditDetails(params.details),
      beforeState: sanitizeAuditDetails(params.beforeState),
      afterState: sanitizeAuditDetails(params.afterState),
      ipAddress: params.ipAddress ? sanitizeAuditText(params.ipAddress, 64) : undefined,
      userAgent: params.userAgent ? sanitizeAuditText(params.userAgent, 512) : undefined,
      requestMethod: params.request?.method ? sanitizeAuditText(params.request.method, 16) : undefined,
      requestPath: params.request?.path ? sanitizeAuditText(params.request.path, 2048) : undefined,
      requestBody: this.sanitizeRequestBody(params.request?.body),
      responseStatus: params.response?.status,
      previousHash: this.currentHash,
    };

    const hash = this.generateEntryHash(entry);
    const fullEntry: AuditEntry = { ...entry, hash };

    this.entries.push(fullEntry);
    this.currentHash = hash;

    // Real-time alerting for critical events (issue #396). Sink failures are
    // contained inside the alerter so auditing can never break the request.
    if (this.alertingEnabled) {
      await this.alerter.dispatch(this.toAuditEvent(fullEntry)).catch(() => undefined);
    }

    return fullEntry;
  }

  /** Adapt a stored entry to the canonical audit event shape used by alerting/compliance. */
  private toAuditEvent(entry: AuditEntry): AuditEvent {
    try {
      return normalizeAuditEvent({
        id: entry.id,
        actor: entry.userId ?? 'system',
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        timestamp: entry.timestamp,
        outcome: entry.outcome,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        requestMethod: entry.requestMethod,
        requestPath: entry.requestPath,
        responseStatus: entry.responseStatus,
        details: entry.details,
        suspicious: entry.suspicious,
        flags: entry.flags,
      });
    } catch {
      return {
        id: entry.id,
        actor: sanitizeAuditText(entry.userId ?? 'system', 256),
        action: sanitizeAuditText(entry.action, 128),
        resource: sanitizeAuditText(entry.resource, 128),
        resourceId: entry.resourceId,
        timestamp: entry.timestamp,
        outcome: entry.outcome,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        requestMethod: entry.requestMethod,
        requestPath: entry.requestPath,
        responseStatus: entry.responseStatus,
        details: entry.details,
        suspicious: entry.suspicious,
        flags: entry.flags,
      };
    }
  }

  private sanitizeRequestBody(body?: unknown): unknown {
    if (!body) return undefined;
    if (typeof body !== 'object') return body;

    const sanitized = { ...(body as Record<string, unknown>) };
    const sensitiveFields = [
      'password', 'token', 'apiKey', 'secret', 'creditCard', 'ssn',
      'documentNumber', 'fileContent', 'dateOfBirth',
    ];

    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  async queryEntries(query: AuditQuery): Promise<{ entries: AuditEntry[]; total: number }> {
    let filtered = this.entries.filter((entry) => {
      if (query.userId && entry.userId !== query.userId) return false;
      if (query.action && entry.action !== query.action) return false;
      if (query.resource && entry.resource !== query.resource) return false;
      if (query.suspicious !== undefined && entry.suspicious !== query.suspicious) return false;
      if (query.startDate && entry.timestamp < query.startDate) return false;
      if (query.endDate && entry.timestamp > query.endDate) return false;
      return true;
    });

    const total = filtered.length;
    const offset = query.offset || 0;
    const limit = query.limit || 50;

    filtered = filtered.sort((a, b) => b.timestamp - a.timestamp);
    filtered = filtered.slice(offset, offset + limit);

    return { entries: filtered, total };
  }

  async getEntry(id: string): Promise<AuditEntry | undefined> {
    return this.entries.find((entry) => entry.id === id);
  }

  async verifyIntegrity(): Promise<{ valid: boolean; brokenAt?: string }> {
    let expectedHash = this.chainAnchor;

    for (const entry of this.entries) {
      if (entry.previousHash !== expectedHash) {
        return { valid: false, brokenAt: entry.id };
      }

      const computedHash = this.generateEntryHash(entry);
      if (computedHash !== entry.hash) {
        return { valid: false, brokenAt: entry.id };
      }

      expectedHash = entry.hash;
    }

    if (this.currentHash !== expectedHash) {
      return { valid: false, brokenAt: this.entries[this.entries.length - 1]?.id };
    }

    return { valid: true };
  }

  async flagSuspicious(entryId: string, reasons: string[]): Promise<AuditEntry | undefined> {
    const entry = this.entries.find((e) => e.id === entryId);
    if (entry) {
      entry.suspicious = true;
      entry.flags = reasons;
      // Flagging is itself a critical event, so it is alerted on.
      if (this.alertingEnabled) {
        await this.alerter
          .dispatch({
            ...this.toAuditEvent(entry),
            action: 'audit.suspicious.flag',
            outcome: 'failure',
          })
          .catch(() => undefined);
      }
    }
    return entry;
  }

  async exportToCSV(): Promise<string> {
    const headers = [
      'ID', 'Timestamp', 'User ID', 'Action', 'Resource', 'Resource ID',
      'Outcome', 'IP Address', 'Request Method', 'Request Path', 'Response Status',
      'Previous Hash', 'Hash', 'Suspicious', 'Flags'
    ].map(escapeCsvCell).join(',');

    const rows = this.entries.map((entry) =>
      [
        entry.id,
        new Date(entry.timestamp).toISOString(),
        entry.userId || '',
        entry.action,
        entry.resource,
        entry.resourceId || '',
        entry.outcome || '',
        entry.ipAddress || '',
        entry.requestMethod || '',
        entry.requestPath || '',
        entry.responseStatus ?? '',
        entry.previousHash,
        entry.hash,
        entry.suspicious ? 'YES' : 'NO',
        (entry.flags || []).join(';'),
      ]
        .map(escapeCsvCell)
        .join(',')
    );

    return [headers, ...rows].join('\n');
  }

  async exportToJSON(): Promise<string> {
    return JSON.stringify({
      exportedAt: Date.now(),
      entryCount: this.entries.length,
      retentionPolicy: this.retentionPolicy,
      integrity: await this.verifyIntegrity(),
      entries: this.entries,
    }, null, 2);
  }

  setRetentionPolicy(policy: Partial<RetentionPolicy>): void {
    this.retentionPolicy = { ...this.retentionPolicy, ...policy };
  }

  getRetentionPolicy(): RetentionPolicy {
    return { ...this.retentionPolicy };
  }

  async getRetentionStats(): Promise<{
    totalEntries: number;
    byResource: Record<string, number>;
    suspiciousCount: number;
    dateRange: { oldest: number; newest: number };
  }> {
    const byResource: Record<string, number> = {};
    let suspiciousCount = 0;

    for (const entry of this.entries) {
      byResource[entry.resource] = (byResource[entry.resource] || 0) + 1;
      if (entry.suspicious) suspiciousCount++;
    }

    const timestamps = this.entries.map((e) => e.timestamp);
    timestamps.sort((a, b) => a - b);

    return {
      totalEntries: this.entries.length,
      byResource,
      suspiciousCount,
      dateRange: {
        oldest: timestamps[0] || 0,
        newest: timestamps[timestamps.length - 1] || 0,
      },
    };
  }

  async getEntryCount(): Promise<number> {
    return this.entries.length;
  }

  async clearOldEntries(): Promise<number> {
    const cutoff = Date.now() - (this.retentionPolicy.deleteAfterDays * 24 * 60 * 60 * 1000);
    const toDelete = this.entries.filter((e) => e.timestamp < cutoff);

    this.entries = this.entries.filter((e) => e.timestamp >= cutoff);
    this.advanceChainAnchor(toDelete);

    return toDelete.length;
  }

  // ── Issue #396 additions ────────────────────────────────────────────────

  /** Alerts raised for critical events, newest first. */
  getAlerts(limit = 50): AuditAlert[] {
    return this.alerter.listRecentAlerts(limit);
  }

  /** Retained alert totals grouped by severity. */
  getAlertCounts(): Record<AuditSeverity, number> {
    return this.alerter.alertCounts();
  }

  /** SOC2 / PCI-DSS control-by-control report over the retained audit entries. */
  getComplianceReport(options: ComplianceReportOptions = {}): ComplianceReport {
    return generateComplianceReport(this.entries.map((entry) => this.toAuditEvent(entry)), options);
  }

  /** The compliance report rendered as CSV for auditor hand-off. */
  getComplianceReportCsv(options: ComplianceReportOptions = {}): string {
    return complianceReportToCsv(this.getComplianceReport(options));
  }

  private asRetentionPolicy(): AuditRetentionPolicy {
    return {
      retentionDays: this.retentionPolicy.retentionDays,
      archiveAfterDays: this.retentionPolicy.archiveAfterDays,
      deleteAfterDays: this.retentionPolicy.deleteAfterDays,
      archiveDir: this.archiveDir,
    };
  }

  /** How many entries sit in each retention tier right now. */
  getRetentionTiers(now = Date.now()): { hot: number; archive: number; purge: number } {
    const plan = planRetention(this.entries as unknown as ChainedAuditEntry[], now, this.asRetentionPolicy());
    return { hot: plan.hot.length, archive: plan.archive.length, purge: plan.purge.length };
  }

  /**
   * Apply the archival policy: write entries past `archiveAfterDays` to
   * append-only cold storage, drop entries past `deleteAfterDays`, and keep the
   * rest hot. Surviving entries are re-anchored so integrity verification still
   * passes (issue #396).
   */
  async archiveOldEntries(now = Date.now()): Promise<RetentionEnforcementResult & { manifests: ArchiveManifest[] }> {
    const policy = this.asRetentionPolicy();
    const store = new AuditArchiveStore(policy.archiveDir);
    const { result, remaining } = await enforceRetention({
      entries: this.entries as unknown as ChainedAuditEntry[],
      now,
      policy,
      store,
    });

    const keptIds = new Set(remaining.map((entry) => entry.id));
    const evicted = this.entries.filter((entry) => !keptIds.has(entry.id));
    this.entries = this.entries.filter((entry) => keptIds.has(entry.id));
    this.advanceChainAnchor(evicted);

    return { ...result, manifests: await store.listArchives() };
  }

  /** Archives currently held in cold storage. */
  async listArchives(): Promise<ArchiveManifest[]> {
    return new AuditArchiveStore(this.archiveDir).listArchives();
  }

  /**
   * Move the verify-anchor past evicted entries so the retained chain stays
   * verifiable. The oldest retained entry's `previousHash` is by definition the
   * resume point; when nothing is retained the anchor becomes the current head
   * so an emptied chain still verifies.
   */
  private advanceChainAnchor(evicted: AuditEntry[]): void {
    if (evicted.length === 0) return;
    this.chainAnchor = this.entries.length > 0 ? this.entries[0]!.previousHash : this.currentHash;
  }
}

export const auditService = new AuditService();
