import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { complianceService } from './service.js';

const ORIGINAL_ENV = { ...process.env };

describe('ComplianceService', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test', AUDIT_PERSISTENCE: 'memory' };
    delete process.env.BACKUP_ENABLED;
    delete process.env.BACKUP_PROVIDER;
    delete process.env.COMPLIANCE_REGULATORY_FEEDS;
    delete process.env.COMPLIANCE_ALERT_WEBHOOK_URL;
    delete process.env.ALERT_WEBHOOK_URL;
    complianceService.resetForTests();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    complianceService.resetForTests();
  });

  it('runs automated checks for the compliance acceptance controls', async () => {
    const run = await complianceService.runAutomatedChecks({ source: 'test', emitAlerts: true });

    expect(run.summary.total).toBeGreaterThanOrEqual(10);
    expect(run.summary.failed).toBe(0);
    expect(run.summary.compliant).toBe(true);
    expect(run.checks.map((check) => check.id)).toEqual(expect.arrayContaining([
      'regulatory_update_monitoring',
      'compliance_reporting',
      'compliance_alerting',
      'audit_integrity',
      'compliance_dashboard',
      'compliance_documentation',
    ]));

    const dashboard = await complianceService.getDashboard();
    expect(dashboard.complianceScore).toBe(run.summary.complianceScore);
    expect(dashboard.regulatoryMonitoring.sources).toBeGreaterThan(0);

    const auditTrail = await complianceService.getAuditTrail();
    expect(auditTrail.total).toBeGreaterThan(0);
  });

  it('creates and manages alerts for failed compliance checks', async () => {
    process.env.BACKUP_ENABLED = 'true';

    const run = await complianceService.runAutomatedChecks({ source: 'test', emitAlerts: true });
    expect(run.summary.failed).toBeGreaterThan(0);

    const openAlerts = complianceService.listAlerts({ status: 'open' });
    expect(openAlerts.some((alert) => alert.checkId === 'backup_configuration')).toBe(true);

    const acknowledged = await complianceService.acknowledgeAlert(openAlerts[0].id, 'auditor@example.com');
    expect(acknowledged?.status).toBe('acknowledged');
    expect(acknowledged?.acknowledgedBy).toBe('auditor@example.com');

    const resolved = await complianceService.resolveAlert(openAlerts[0].id, 'auditor@example.com');
    expect(resolved?.status).toBe('resolved');
  });

  it('ingests regulatory updates and includes them in reports', async () => {
    const update = await complianceService.ingestRegulatoryUpdate({
      title: 'New sanctions screening guidance',
      summary: 'Payment providers must review updated sanctions screening expectations.',
      jurisdiction: 'global',
      severity: 'high',
      tags: ['sanctions', 'payments'],
    });

    expect(update.status).toBe('new');
    expect(complianceService.listAlerts({ status: 'open' }).some((alert) => alert.regulatoryUpdateId === update.id)).toBe(true);

    const report = await complianceService.generateReport();
    expect(report.regulatoryUpdates.some((entry) => entry.id === update.id)).toBe(true);

    const csv = complianceService.reportToCsv(report);
    expect(csv).toContain('regulatory_update');
    expect(csv).toContain('New sanctions screening guidance');
  });

  it('records regulatory monitoring runs even when no external feeds are configured', async () => {
    const result = await complianceService.monitorRegulatoryUpdates();

    expect(result.sourcesChecked).toBeGreaterThan(0);
    expect(result.updatesDetected).toBe(0);
    expect(complianceService.listRegulatorySources().every((source) => source.lastCheckedAt)).toBe(true);
  });
});
