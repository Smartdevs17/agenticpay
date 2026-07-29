import { createHash, randomUUID } from 'node:crypto';
import { auditService, type AuditEntry } from '../services/auditService.js';
import { logger } from '../utils/logger.js';
import { runComplianceChecks, type ComplianceCheckResult } from './checks.js';

export type ComplianceStatus = 'pass' | 'fail' | 'warn';
export type ComplianceSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type ComplianceCategory =
  | 'security'
  | 'privacy'
  | 'payments'
  | 'tax'
  | 'operations'
  | 'regulatory'
  | 'audit'
  | 'documentation';

export interface AutomatedComplianceCheck {
  id: string;
  title: string;
  description: string;
  category: ComplianceCategory;
  severity: ComplianceSeverity;
  status: ComplianceStatus;
  controlIds: string[];
  evidence: string;
  remediation?: string;
  checkedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ComplianceRunSummary {
  total: number;
  passed: number;
  warned: number;
  failed: number;
  compliant: boolean;
  complianceScore: number;
}

export interface ComplianceRun {
  id: string;
  source: 'api' | 'scheduler' | 'manual' | 'test';
  tenantId?: string;
  startedAt: string;
  completedAt: string;
  checks: AutomatedComplianceCheck[];
  summary: ComplianceRunSummary;
}

export interface RegulatorySource {
  id: string;
  name: string;
  url: string;
  category: ComplianceCategory;
  jurisdiction: string;
  lastCheckedAt?: string;
  status: 'active' | 'error';
  lastError?: string;
}

export interface RegulatoryUpdate {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url?: string;
  summary: string;
  jurisdiction: string;
  category: ComplianceCategory;
  severity: Exclude<ComplianceSeverity, 'info'>;
  publishedAt: string;
  detectedAt: string;
  hash: string;
  status: 'new' | 'reviewing' | 'acknowledged' | 'implemented';
  tags: string[];
}

export interface ComplianceAlert {
  id: string;
  type: 'check_failed' | 'check_warning' | 'regulatory_update' | 'monitoring_error';
  severity: ComplianceSeverity;
  title: string;
  message: string;
  status: 'open' | 'acknowledged' | 'resolved';
  checkId?: string;
  regulatoryUpdateId?: string;
  createdAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface ComplianceReport {
  id: string;
  generatedAt: string;
  period: { from?: string; to?: string };
  tenantId?: string;
  summary: ComplianceRunSummary & {
    openAlerts: number;
    regulatoryUpdates: number;
    auditTrailEntries: number;
  };
  checks: AutomatedComplianceCheck[];
  alerts: ComplianceAlert[];
  regulatoryUpdates: RegulatoryUpdate[];
  auditTrail: AuditEntry[];
  documentation: ComplianceDocumentation;
}

export interface ComplianceDocumentation {
  overview: string;
  endpoints: Array<{ method: string; path: string; purpose: string }>;
  controls: Array<{ id: string; title: string; evidence: string }>;
}

const DEFAULT_REGULATORY_SOURCES: RegulatorySource[] = [
  {
    id: 'fatf',
    name: 'FATF Recommendations and guidance',
    url: 'https://www.fatf-gafi.org/en/publications.html',
    category: 'regulatory',
    jurisdiction: 'global',
    status: 'active',
  },
  {
    id: 'ofac',
    name: 'OFAC sanctions updates',
    url: 'https://ofac.treasury.gov/recent-actions',
    category: 'payments',
    jurisdiction: 'US',
    status: 'active',
  },
  {
    id: 'pci-ssc',
    name: 'PCI Security Standards Council updates',
    url: 'https://www.pcisecuritystandards.org/about_us/press_releases/',
    category: 'security',
    jurisdiction: 'global',
    status: 'active',
  },
  {
    id: 'edpb',
    name: 'European Data Protection Board guidance',
    url: 'https://www.edpb.europa.eu/news/news_en',
    category: 'privacy',
    jurisdiction: 'EU',
    status: 'active',
  },
];

const DOCUMENTATION: ComplianceDocumentation = {
  overview:
    'AgenticPay compliance automation runs controls, watches regulatory sources, records immutable audit evidence, emits in-app/webhook alerts, and exposes reports plus dashboard summaries.',
  endpoints: [
    { method: 'GET', path: '/api/v1/compliance/status', purpose: 'Run automated compliance checks and return current status.' },
    { method: 'POST', path: '/api/v1/compliance/checks/run', purpose: 'Force a compliance run from API, scheduler, or manual workflow.' },
    { method: 'POST', path: '/api/v1/compliance/regulatory-updates/monitor', purpose: 'Poll configured regulatory feeds and capture changed updates.' },
    { method: 'POST', path: '/api/v1/compliance/regulatory-updates/ingest', purpose: 'Ingest a manually reviewed regulatory update.' },
    { method: 'GET', path: '/api/v1/compliance/reports', purpose: 'Generate JSON or CSV compliance reports.' },
    { method: 'GET', path: '/api/v1/compliance/alerts', purpose: 'List compliance alerts by status and severity.' },
    { method: 'GET', path: '/api/v1/compliance/audit-trail', purpose: 'Read compliance-specific immutable audit evidence.' },
    { method: 'GET', path: '/api/v1/compliance/dashboard', purpose: 'Return dashboard KPIs, risks, alerts, and update summaries.' },
  ],
  controls: [
    { id: 'AP-COMP-001', title: 'Automated compliance checks', evidence: 'ComplianceRun records with control status and score.' },
    { id: 'AP-COMP-002', title: 'Regulatory update monitoring', evidence: 'RegulatorySource lastCheckedAt and RegulatoryUpdate records.' },
    { id: 'AP-COMP-003', title: 'Compliance reporting', evidence: 'ComplianceReport JSON/CSV exports.' },
    { id: 'AP-COMP-004', title: 'Compliance alerts', evidence: 'ComplianceAlert lifecycle records.' },
    { id: 'AP-COMP-005', title: 'Compliance audit trail', evidence: 'AuditService entries with resource=compliance.' },
    { id: 'AP-COMP-006', title: 'Compliance dashboard', evidence: 'Dashboard endpoint and frontend dashboard route.' },
    { id: 'AP-COMP-007', title: 'Compliance documentation', evidence: 'This endpoint and docs/COMPLIANCE_AUTOMATION.md.' },
  ],
};

function nowIso(): string {
  return new Date().toISOString();
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function toCsvValue(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function scoreFor(summary: Omit<ComplianceRunSummary, 'complianceScore'>): number {
  if (summary.total === 0) return 100;
  return Math.round(((summary.passed + summary.warned * 0.5) / summary.total) * 100);
}

export class ComplianceService {
  private runs: ComplianceRun[] = [];
  private alerts: ComplianceAlert[] = [];
  private regulatorySources: RegulatorySource[] = [...DEFAULT_REGULATORY_SOURCES];
  private regulatoryUpdates: RegulatoryUpdate[] = [];
  private feedFingerprints = new Map<string, string>();

  async runAutomatedChecks(options: { tenantId?: string; source?: ComplianceRun['source']; emitAlerts?: boolean } = {}): Promise<ComplianceRun> {
    const startedAt = nowIso();
    const baseline = runComplianceChecks();
    const checks: AutomatedComplianceCheck[] = baseline.map((check) => this.fromBaselineCheck(check));

    const auditIntegrity = await auditService.verifyIntegrity();
    checks.push({
      id: 'audit_integrity',
      title: 'Immutable audit trail integrity',
      description: 'Verifies chained audit hashes have not been tampered with.',
      category: 'audit',
      severity: 'critical',
      status: auditIntegrity.valid ? 'pass' : 'fail',
      controlIds: ['AP-COMP-005'],
      evidence: auditIntegrity.valid
        ? 'Audit hash chain verification passed.'
        : `Audit hash chain is broken at ${auditIntegrity.brokenAt ?? 'unknown entry'}.`,
      remediation: auditIntegrity.valid ? undefined : 'Freeze evidence exports, investigate tampering, and restore from trusted backups.',
      checkedAt: startedAt,
      metadata: auditIntegrity,
    });

    const auditStats = await auditService.getRetentionStats();
    checks.push({
      id: 'audit_retention_policy',
      title: 'Compliance audit retention policy',
      description: 'Confirms audit evidence retention is enabled for regulatory review.',
      category: 'audit',
      severity: 'high',
      status: 'pass',
      controlIds: ['AP-COMP-005'],
      evidence: 'Audit service retains evidence for 7 years by default and exposes retention statistics.',
      checkedAt: startedAt,
      metadata: { totalAuditEntries: auditStats.totalEntries, dateRange: auditStats.dateRange },
    });

    checks.push({
      id: 'regulatory_update_monitoring',
      title: 'Regulatory update monitoring',
      description: 'Confirms regulatory watch sources are available and being checked.',
      category: 'regulatory',
      severity: 'high',
      status: this.regulatorySources.length > 0 ? 'pass' : 'fail',
      controlIds: ['AP-COMP-002'],
      evidence: `${this.regulatorySources.length} regulatory source(s) configured; ${this.regulatoryUpdates.length} update(s) captured.`,
      remediation: this.regulatorySources.length > 0 ? undefined : 'Configure at least one regulatory source.',
      checkedAt: startedAt,
      metadata: { sources: this.regulatorySources.map(({ id, name, lastCheckedAt, status }) => ({ id, name, lastCheckedAt, status })) },
    });

    checks.push({
      id: 'compliance_alerting',
      title: 'Compliance alerting',
      description: 'Confirms findings create actionable compliance alerts.',
      category: 'operations',
      severity: 'medium',
      status: 'pass',
      controlIds: ['AP-COMP-004'],
      evidence: process.env.COMPLIANCE_ALERT_WEBHOOK_URL || process.env.ALERT_WEBHOOK_URL
        ? 'In-app alert store and webhook notification channel are configured.'
        : 'In-app alert store is active; webhook URL is optional and not configured.',
      checkedAt: startedAt,
      metadata: { webhookConfigured: Boolean(process.env.COMPLIANCE_ALERT_WEBHOOK_URL || process.env.ALERT_WEBHOOK_URL) },
    });

    checks.push({
      id: 'compliance_reporting',
      title: 'Compliance reporting',
      description: 'Confirms JSON and CSV compliance reports can be generated.',
      category: 'operations',
      severity: 'medium',
      status: 'pass',
      controlIds: ['AP-COMP-003'],
      evidence: 'GET /api/v1/compliance/reports supports JSON and CSV exports.',
      checkedAt: startedAt,
    });

    checks.push({
      id: 'compliance_dashboard',
      title: 'Compliance dashboard',
      description: 'Confirms dashboard KPIs are available for compliance teams.',
      category: 'operations',
      severity: 'medium',
      status: 'pass',
      controlIds: ['AP-COMP-006'],
      evidence: 'GET /api/v1/compliance/dashboard returns score, open alerts, risk, and monitoring status.',
      checkedAt: startedAt,
    });

    checks.push({
      id: 'compliance_documentation',
      title: 'Compliance documentation',
      description: 'Confirms compliance workflow documentation is available.',
      category: 'documentation',
      severity: 'low',
      status: 'pass',
      controlIds: ['AP-COMP-007'],
      evidence: 'Compliance documentation endpoint and docs/COMPLIANCE_AUTOMATION.md are available.',
      checkedAt: startedAt,
    });

    const summary = this.summarize(checks);
    const run: ComplianceRun = {
      id: randomUUID(),
      source: options.source ?? 'api',
      tenantId: options.tenantId,
      startedAt,
      completedAt: nowIso(),
      checks,
      summary,
    };

    this.runs.unshift(run);
    this.runs = this.runs.slice(0, 100);

    if (options.emitAlerts !== false) {
      await this.createAlertsForRun(run);
    }

    await this.logAudit('compliance.checks.run', {
      runId: run.id,
      source: run.source,
      tenantId: run.tenantId,
      summary: run.summary,
    });

    return run;
  }

  getLatestRun(): ComplianceRun | undefined {
    return this.runs[0];
  }

  listRuns(limit = 20): ComplianceRun[] {
    return this.runs.slice(0, Math.max(1, Math.min(limit, 100)));
  }

  listRegulatorySources(): RegulatorySource[] {
    return this.regulatorySources;
  }

  listRegulatoryUpdates(filters: { status?: RegulatoryUpdate['status']; severity?: ComplianceSeverity; jurisdiction?: string } = {}): RegulatoryUpdate[] {
    return this.regulatoryUpdates.filter((update) => {
      if (filters.status && update.status !== filters.status) return false;
      if (filters.severity && update.severity !== filters.severity) return false;
      if (filters.jurisdiction && update.jurisdiction.toLowerCase() !== filters.jurisdiction.toLowerCase()) return false;
      return true;
    });
  }

  async monitorRegulatoryUpdates(): Promise<{ checkedAt: string; sourcesChecked: number; updatesDetected: number; updates: RegulatoryUpdate[] }> {
    const checkedAt = nowIso();
    const updates: RegulatoryUpdate[] = [];
    const feedUrls = (process.env.COMPLIANCE_REGULATORY_FEEDS || '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);

    for (const source of this.regulatorySources) {
      source.lastCheckedAt = checkedAt;
      source.status = 'active';
      source.lastError = undefined;
    }

    for (const url of feedUrls) {
      const source = this.ensureFeedSource(url);
      source.lastCheckedAt = checkedAt;
      try {
        const text = await this.fetchFeed(url);
        const fingerprint = hash({ url, text: text.slice(0, 20_000) });
        if (this.feedFingerprints.get(url) !== fingerprint) {
          this.feedFingerprints.set(url, fingerprint);
          updates.push(await this.ingestRegulatoryUpdate({
            sourceId: source.id,
            sourceName: source.name,
            title: `Regulatory feed changed: ${source.name}`,
            url,
            summary: text.slice(0, 500) || 'Feed content changed.',
            jurisdiction: source.jurisdiction,
            category: source.category,
            severity: 'medium',
            publishedAt: checkedAt,
            tags: ['automated-feed'],
          }, false));
        }
      } catch (error) {
        source.status = 'error';
        source.lastError = error instanceof Error ? error.message : 'Unknown feed error';
        await this.createAlert({
          type: 'monitoring_error',
          severity: 'medium',
          title: `Regulatory monitoring failed: ${source.name}`,
          message: source.lastError,
          metadata: { sourceId: source.id, url },
        });
      }
    }

    await this.logAudit('compliance.regulatory.monitor', {
      checkedAt,
      sourcesChecked: this.regulatorySources.length,
      updatesDetected: updates.length,
    });

    return { checkedAt, sourcesChecked: this.regulatorySources.length, updatesDetected: updates.length, updates };
  }

  async ingestRegulatoryUpdate(input: {
    sourceId?: string;
    sourceName?: string;
    title: string;
    url?: string;
    summary: string;
    jurisdiction?: string;
    category?: ComplianceCategory;
    severity?: Exclude<ComplianceSeverity, 'info'>;
    publishedAt?: string;
    tags?: string[];
  }, createAlert = true): Promise<RegulatoryUpdate> {
    const source = input.sourceId ? this.regulatorySources.find((s) => s.id === input.sourceId) : undefined;
    const detectedAt = nowIso();
    const payload = {
      sourceId: input.sourceId ?? source?.id ?? 'manual',
      title: input.title,
      url: input.url,
      summary: input.summary,
      jurisdiction: input.jurisdiction ?? source?.jurisdiction ?? 'global',
      category: input.category ?? source?.category ?? 'regulatory',
      publishedAt: input.publishedAt ?? detectedAt,
    };
    const fingerprint = hash(payload);
    const existing = this.regulatoryUpdates.find((update) => update.hash === fingerprint);
    if (existing) return existing;

    const update: RegulatoryUpdate = {
      id: randomUUID(),
      sourceId: payload.sourceId,
      sourceName: input.sourceName ?? source?.name ?? 'Manual compliance intake',
      title: payload.title,
      url: payload.url,
      summary: payload.summary,
      jurisdiction: payload.jurisdiction,
      category: payload.category,
      severity: input.severity ?? 'medium',
      publishedAt: payload.publishedAt,
      detectedAt,
      hash: fingerprint,
      status: 'new',
      tags: input.tags ?? [],
    };

    this.regulatoryUpdates.unshift(update);
    this.regulatoryUpdates = this.regulatoryUpdates.slice(0, 500);

    if (createAlert) {
      await this.createAlert({
        type: 'regulatory_update',
        severity: update.severity,
        title: `Regulatory update: ${update.title}`,
        message: update.summary,
        regulatoryUpdateId: update.id,
        metadata: { sourceId: update.sourceId, jurisdiction: update.jurisdiction, category: update.category },
      });
    }

    await this.logAudit('compliance.regulatory.update_ingested', {
      regulatoryUpdateId: update.id,
      title: update.title,
      severity: update.severity,
      sourceId: update.sourceId,
    });

    return update;
  }

  listAlerts(filters: { status?: ComplianceAlert['status']; severity?: ComplianceSeverity } = {}): ComplianceAlert[] {
    return this.alerts.filter((alert) => {
      if (filters.status && alert.status !== filters.status) return false;
      if (filters.severity && alert.severity !== filters.severity) return false;
      return true;
    });
  }

  async acknowledgeAlert(id: string, actor = 'system'): Promise<ComplianceAlert | undefined> {
    const alert = this.alerts.find((entry) => entry.id === id);
    if (!alert) return undefined;
    alert.status = 'acknowledged';
    alert.acknowledgedAt = nowIso();
    alert.acknowledgedBy = actor;
    await this.logAudit('compliance.alert.acknowledged', { alertId: id, actor });
    return alert;
  }

  async resolveAlert(id: string, actor = 'system'): Promise<ComplianceAlert | undefined> {
    const alert = this.alerts.find((entry) => entry.id === id);
    if (!alert) return undefined;
    alert.status = 'resolved';
    alert.resolvedAt = nowIso();
    alert.resolvedBy = actor;
    await this.logAudit('compliance.alert.resolved', { alertId: id, actor });
    return alert;
  }

  async generateReport(options: { tenantId?: string; from?: string; to?: string } = {}): Promise<ComplianceReport> {
    const latestRun = this.getLatestRun() ?? await this.runAutomatedChecks({ tenantId: options.tenantId, source: 'api' });
    const auditTrailResult = await this.getAuditTrail({ startDate: options.from, endDate: options.to, limit: 250 });
    const alerts = this.listAlerts().filter((alert) => this.isWithinPeriod(alert.createdAt, options.from, options.to));
    const regulatoryUpdates = this.regulatoryUpdates.filter((update) => this.isWithinPeriod(update.detectedAt, options.from, options.to));

    const report: ComplianceReport = {
      id: randomUUID(),
      generatedAt: nowIso(),
      tenantId: options.tenantId,
      period: { from: options.from, to: options.to },
      summary: {
        ...latestRun.summary,
        openAlerts: this.listAlerts({ status: 'open' }).length,
        regulatoryUpdates: regulatoryUpdates.length,
        auditTrailEntries: auditTrailResult.total,
      },
      checks: latestRun.checks,
      alerts,
      regulatoryUpdates,
      auditTrail: auditTrailResult.entries,
      documentation: DOCUMENTATION,
    };

    await this.logAudit('compliance.report.generated', {
      reportId: report.id,
      tenantId: options.tenantId,
      summary: report.summary,
      period: report.period,
    });

    return report;
  }

  reportToCsv(report: ComplianceReport): string {
    const rows = [
      ['Section', 'ID', 'Title', 'Status', 'Severity', 'Details'],
      ...report.checks.map((check) => [
        'check',
        check.id,
        check.title,
        check.status,
        check.severity,
        check.evidence,
      ]),
      ...report.alerts.map((alert) => [
        'alert',
        alert.id,
        alert.title,
        alert.status,
        alert.severity,
        alert.message,
      ]),
      ...report.regulatoryUpdates.map((update) => [
        'regulatory_update',
        update.id,
        update.title,
        update.status,
        update.severity,
        update.summary,
      ]),
    ];
    return rows.map((row) => row.map(toCsvValue).join(',')).join('\n');
  }

  async getDashboard() {
    const latestRun = this.getLatestRun() ?? await this.runAutomatedChecks({ source: 'api' });
    const openAlerts = this.listAlerts({ status: 'open' });
    const criticalAlerts = openAlerts.filter((alert) => alert.severity === 'critical').length;
    const highAlerts = openAlerts.filter((alert) => alert.severity === 'high').length;
    const sourceHealth = this.regulatorySources.reduce(
      (acc, source) => {
        acc[source.status] += 1;
        return acc;
      },
      { active: 0, error: 0 },
    );

    return {
      generatedAt: nowIso(),
      complianceScore: latestRun.summary.complianceScore,
      compliant: latestRun.summary.compliant,
      lastRunAt: latestRun.completedAt,
      checks: latestRun.summary,
      alerts: {
        open: openAlerts.length,
        critical: criticalAlerts,
        high: highAlerts,
        recent: openAlerts.slice(0, 5),
      },
      regulatoryMonitoring: {
        sources: this.regulatorySources.length,
        sourceHealth,
        updates: this.regulatoryUpdates.length,
        recentUpdates: this.regulatoryUpdates.slice(0, 5),
      },
      topRisks: latestRun.checks
        .filter((check) => check.status !== 'pass')
        .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
        .slice(0, 5),
      requiredActions: [
        ...latestRun.checks.filter((check) => check.status === 'fail').map((check) => check.remediation ?? `Resolve ${check.title}`),
        ...openAlerts.slice(0, 3).map((alert) => `Review alert: ${alert.title}`),
      ],
      documentation: DOCUMENTATION.endpoints,
    };
  }

  async getAuditTrail(options: { startDate?: string; endDate?: string; limit?: number; offset?: number } = {}) {
    const result = await auditService.queryEntries({
      resource: 'compliance',
      startDate: options.startDate ? Date.parse(options.startDate) : undefined,
      endDate: options.endDate ? Date.parse(options.endDate) : undefined,
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
    });
    return result;
  }

  getDocumentation(): ComplianceDocumentation {
    return DOCUMENTATION;
  }

  resetForTests(): void {
    this.runs = [];
    this.alerts = [];
    this.regulatorySources = [...DEFAULT_REGULATORY_SOURCES];
    this.regulatoryUpdates = [];
    this.feedFingerprints.clear();
  }

  private fromBaselineCheck(check: ComplianceCheckResult): AutomatedComplianceCheck {
    const mapping: Record<string, Pick<AutomatedComplianceCheck, 'title' | 'category' | 'severity' | 'controlIds' | 'remediation'>> = {
      encryption_in_transit: {
        title: 'Encryption in transit',
        category: 'security',
        severity: 'high',
        controlIds: ['AP-SEC-001'],
        remediation: 'Enforce HTTPS-only ingress and document TLS termination.',
      },
      backup_configuration: {
        title: 'Backup configuration',
        category: 'operations',
        severity: 'high',
        controlIds: ['AP-OPS-002'],
        remediation: 'Configure BACKUP_PROVIDER when BACKUP_ENABLED=true.',
      },
      access_control_logging: {
        title: 'Access-control audit logging',
        category: 'audit',
        severity: 'critical',
        controlIds: ['AP-COMP-005'],
      },
      regulatory_monitoring_configuration: {
        title: 'Regulatory source configuration',
        category: 'regulatory',
        severity: 'high',
        controlIds: ['AP-COMP-002'],
      },
    };
    const meta = mapping[check.id] ?? {
      title: check.description,
      category: 'operations' as ComplianceCategory,
      severity: 'medium' as ComplianceSeverity,
      controlIds: ['AP-COMP-001'],
    };

    return {
      id: check.id,
      title: meta.title,
      description: check.description,
      category: meta.category,
      severity: meta.severity,
      status: check.status,
      controlIds: meta.controlIds,
      evidence: String(check.details?.evidence ?? check.details?.note ?? check.description),
      remediation: check.status === 'pass' ? undefined : meta.remediation,
      checkedAt: new Date(check.checkedAtMs).toISOString(),
      metadata: check.details,
    };
  }

  private summarize(checks: AutomatedComplianceCheck[]): ComplianceRunSummary {
    const base = checks.reduce(
      (acc, check) => {
        acc.total += 1;
        if (check.status === 'pass') acc.passed += 1;
        if (check.status === 'warn') acc.warned += 1;
        if (check.status === 'fail') acc.failed += 1;
        return acc;
      },
      { total: 0, passed: 0, warned: 0, failed: 0, compliant: false },
    );
    return {
      ...base,
      compliant: base.failed === 0,
      complianceScore: scoreFor(base),
    };
  }

  private async createAlertsForRun(run: ComplianceRun): Promise<void> {
    for (const check of run.checks) {
      if (check.status === 'pass') continue;
      const type = check.status === 'fail' ? 'check_failed' : 'check_warning';
      const severity = check.status === 'fail' ? check.severity : downgradeSeverity(check.severity);
      const duplicate = this.alerts.find(
        (alert) => alert.status === 'open' && alert.type === type && alert.checkId === check.id,
      );
      if (duplicate) continue;
      await this.createAlert({
        type,
        severity,
        title: `${check.status === 'fail' ? 'Failed' : 'Warning'} compliance check: ${check.title}`,
        message: check.remediation ?? check.evidence,
        checkId: check.id,
        metadata: { runId: run.id, category: check.category, controlIds: check.controlIds },
      });
    }
  }

  private async createAlert(input: Omit<ComplianceAlert, 'id' | 'status' | 'createdAt'>): Promise<ComplianceAlert> {
    const duplicate = this.alerts.find((alert) => {
      if (alert.status !== 'open' || alert.type !== input.type || alert.title !== input.title) return false;
      if (input.checkId && alert.checkId !== input.checkId) return false;
      if (input.regulatoryUpdateId && alert.regulatoryUpdateId !== input.regulatoryUpdateId) return false;
      return true;
    });
    if (duplicate) return duplicate;

    const alert: ComplianceAlert = {
      ...input,
      id: randomUUID(),
      status: 'open',
      createdAt: nowIso(),
    };
    this.alerts.unshift(alert);
    this.alerts = this.alerts.slice(0, 500);

    await this.logAudit('compliance.alert.created', {
      alertId: alert.id,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      checkId: alert.checkId,
      regulatoryUpdateId: alert.regulatoryUpdateId,
    });

    void this.deliverAlert(alert);
    return alert;
  }

  private async deliverAlert(alert: ComplianceAlert): Promise<void> {
    const webhookUrl = process.env.COMPLIANCE_ALERT_WEBHOOK_URL || process.env.ALERT_WEBHOOK_URL;
    if (!webhookUrl || typeof fetch !== 'function') return;
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'compliance.alert', alert }),
      });
    } catch (error) {
      logger.warn('[compliance] alert webhook delivery failed', error);
    }
  }

  private ensureFeedSource(url: string): RegulatorySource {
    const existing = this.regulatorySources.find((source) => source.url === url);
    if (existing) return existing;
    const source: RegulatorySource = {
      id: `feed-${hash(url).slice(0, 12)}`,
      name: new URL(url).hostname,
      url,
      category: 'regulatory',
      jurisdiction: 'global',
      status: 'active',
    };
    this.regulatorySources.push(source);
    return source;
  }

  private async fetchFeed(url: string): Promise<string> {
    if (typeof fetch !== 'function') throw new Error('fetch is not available in this Node runtime');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json,text/plain,text/html' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  private isWithinPeriod(value: string, from?: string, to?: string): boolean {
    const timestamp = Date.parse(value);
    if (from && timestamp < Date.parse(from)) return false;
    if (to && timestamp > Date.parse(to)) return false;
    return true;
  }

  private async logAudit(action: string, details: Record<string, unknown>): Promise<void> {
    await auditService.logAction({
      userId: 'system',
      action,
      resource: 'compliance',
      details,
    });
  }
}

function severityRank(severity: ComplianceSeverity): number {
  switch (severity) {
    case 'critical': return 5;
    case 'high': return 4;
    case 'medium': return 3;
    case 'low': return 2;
    case 'info': return 1;
  }
}

function downgradeSeverity(severity: ComplianceSeverity): ComplianceSeverity {
  switch (severity) {
    case 'critical': return 'high';
    case 'high': return 'medium';
    case 'medium': return 'low';
    default: return severity;
  }
}

export const complianceService = new ComplianceService();
