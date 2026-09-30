/**
 * AuditService integration for issue #396 — alerting, compliance reporting,
 * retention/archival and log-injection defence.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuditAlerter, type AuditAlert, type AuditAlertSink } from '../alerting.js';
import { AuditService } from '../../services/auditService.js';

const DAY = 24 * 60 * 60 * 1000;

let dir: string;

function collectingSink(): AuditAlertSink & { alerts: AuditAlert[] } {
  const alerts: AuditAlert[] = [];
  return {
    name: 'test',
    alerts,
    async send(alert) {
      alerts.push(alert);
    },
  };
}

function serviceWithSink(sink: AuditAlertSink, policy = {}): AuditService {
  return new AuditService({
    policy,
    archiveDir: dir,
    alerter: new AuditAlerter({ sinks: [sink] }),
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'audit-service-396-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('AuditService log-injection defence (#396)', () => {
  it('strips newlines from details before hashing and storage', async () => {
    const service = new AuditService({ alerting: false });

    const entry = await service.logAction({
      action: 'auth.post',
      resource: 'auth',
      details: { note: 'ok\n2026-01-01 forged admin.delete' },
    });

    expect(entry.details?.note).toBe('ok 2026-01-01 forged admin.delete');
    expect(JSON.stringify(entry.details)).not.toContain('\n');
  });

  it('neutralises spreadsheet formulas in CSV exports', async () => {
    const service = new AuditService({ alerting: false });
    await service.logAction({ action: 'auth.post', resource: 'auth', userId: '=cmd|calc' });

    const csv = await service.exportToCSV();
    expect(csv).toContain('"\'=cmd|calc"');
    expect(csv).not.toMatch(/(^|,)"=cmd/m);
  });
});

describe('AuditService real-time alerting (#396)', () => {
  it('raises a critical alert when a privilege change is logged', async () => {
    const sink = collectingSink();
    const service = serviceWithSink(sink);

    await service.logAction({ action: 'roles.post', resource: 'roles', userId: 'admin-1' });

    expect(sink.alerts).toHaveLength(1);
    expect(service.getAlerts()[0]?.ruleId).toBe('privilege.escalation');
    expect(service.getAlertCounts().critical).toBe(1);
  });

  it('raises an alert for a failed authentication attempt', async () => {
    const sink = collectingSink();
    const service = serviceWithSink(sink);

    await service.logAction({ action: 'auth.post', resource: 'auth', outcome: 'failure' });

    expect(service.getAlerts()[0]?.ruleId).toBe('auth.failure');
  });

  it('does not alert for routine non-sensitive operations', async () => {
    const sink = collectingSink();
    const service = serviceWithSink(sink);

    await service.logAction({ action: 'projects.get', resource: 'projects' });

    expect(sink.alerts).toHaveLength(0);
    expect(service.getAlerts()).toEqual([]);
  });

  it('alerts when an entry is flagged as suspicious', async () => {
    const sink = collectingSink();
    const service = serviceWithSink(sink);
    const entry = await service.logAction({ action: 'projects.get', resource: 'projects' });

    await service.flagSuspicious(entry.id, ['impossible travel']);

    expect(sink.alerts.at(-1)?.action).toBe('audit.suspicious.flag');
  });

  it('can disable alerting entirely', async () => {
    const sink = collectingSink();
    const service = new AuditService({ alerting: false, alerter: new AuditAlerter({ sinks: [sink] }) });

    await service.logAction({ action: 'roles.post', resource: 'roles' });

    expect(sink.alerts).toHaveLength(0);
  });
});

describe('AuditService compliance reporting (#396)', () => {
  it('reports satisfied controls and gaps over logged entries', async () => {
    const service = new AuditService({ alerting: false });

    await service.logAction({
      action: 'roles.post',
      resource: 'roles',
      userId: 'admin-1',
      outcome: 'success',
      ipAddress: '203.0.113.9',
    });

    const report = service.getComplianceReport({ frameworks: ['SOC2'] });

    expect(report.totalEvents).toBe(1);
    expect(report.controls.find((control) => control.id === 'CC6.2')?.coverage).toBe('satisfied');
    expect(report.controls.find((control) => control.id === 'CC8.1')?.coverage).toBe('gap');
  });

  it('exports the compliance report as CSV', async () => {
    const service = new AuditService({ alerting: false });
    await service.logAction({ action: 'roles.post', resource: 'roles', userId: 'admin-1' });

    expect(service.getComplianceReportCsv().split('\n')[0]).toContain('Framework');
  });
});

describe('AuditService retention and archival (#396)', () => {
  it('reports how many entries sit in each retention tier', async () => {
    const service = serviceWithSink(collectingSink(), { archiveAfterDays: 1, deleteAfterDays: 30 });
    await service.logAction({ action: 'auth.post', resource: 'auth' });

    expect(service.getRetentionTiers()).toEqual({ hot: 1, archive: 0, purge: 0 });
  });

  it('archives entries past the horizon and keeps the chain verifiable afterwards', async () => {
    const service = serviceWithSink(collectingSink(), { archiveAfterDays: 1, deleteAfterDays: 365 });
    await service.logAction({ action: 'auth.post', resource: 'auth' });
    await service.logAction({ action: 'auth.post', resource: 'auth' });

    const result = await service.archiveOldEntries(Date.now() + 2 * DAY);

    expect(result.archived).toBe(2);
    expect(result.archiveIds).toHaveLength(1);
    expect(await service.getEntryCount()).toBe(0);
    // The evicted chain must not be reported as tampered with.
    await expect(service.verifyIntegrity()).resolves.toEqual({ valid: true });
    expect((await service.listArchives()).length).toBe(1);
  });

  it('continues the chain correctly for entries logged after an eviction', async () => {
    const service = serviceWithSink(collectingSink(), { archiveAfterDays: 1, deleteAfterDays: 365 });
    await service.logAction({ action: 'auth.post', resource: 'auth' });
    await service.archiveOldEntries(Date.now() + 2 * DAY);

    await service.logAction({ action: 'admin.get', resource: 'admin' });

    expect(await service.getEntryCount()).toBe(1);
    await expect(service.verifyIntegrity()).resolves.toEqual({ valid: true });
  });

  it('still detects genuine tampering after entries have been archived', async () => {
    const service = serviceWithSink(collectingSink(), { archiveAfterDays: 1, deleteAfterDays: 365 });
    await service.logAction({ action: 'auth.post', resource: 'auth' });
    await service.archiveOldEntries(Date.now() + 2 * DAY);
    await service.logAction({ action: 'admin.get', resource: 'admin' });

    const entry = await service.getEntry((await service.queryEntries({ limit: 1 })).entries[0]!.id);
    // Mutate the retained entry the way an attacker with storage access would.
    (entry as unknown as { action: string }).action = 'auth.post';

    await expect(service.verifyIntegrity()).resolves.toEqual({ valid: false, brokenAt: entry!.id });
  });

  it('exposes the configured retention policy', async () => {
    const service = serviceWithSink(collectingSink(), { archiveAfterDays: 7, deleteAfterDays: 14 });

    expect(service.getRetentionPolicy()).toMatchObject({ archiveAfterDays: 7, deleteAfterDays: 14 });
  });
});
