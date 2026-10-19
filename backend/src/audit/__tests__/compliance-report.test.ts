/**
 * SOC2 / PCI-DSS compliance reporting — Issue #396
 */
import { describe, expect, it } from 'vitest';

import { COMPLIANCE_CONTROLS, complianceReportToCsv, generateComplianceReport } from '../compliance-report.js';
import { normalizeAuditEvent, type AuditEventInput } from '../event-schema.js';

function events(...inputs: AuditEventInput[]) {
  return inputs.map((input) => normalizeAuditEvent(input));
}

const FULL_EVIDENCE: AuditEventInput[] = [
  // Access provisioning (SOC2 CC6.2)
  { action: 'roles.post', resource: 'roles', outcome: 'success', ipAddress: '203.0.113.1', actor: 'admin-1' },
  // Failed auth (SOC2 CC7.3 / PCI 10.2.4)
  { action: 'auth.post', resource: 'auth', outcome: 'failure', ipAddress: '203.0.113.2', actor: 'attacker' },
  // Cardholder data access (PCI 10.2.1)
  { action: 'payments.get', resource: 'card', outcome: 'success', ipAddress: '203.0.113.3', actor: 'ops-1' },
  // Credential change (PCI 10.2.5)
  {
    action: 'api-keys.rotate',
    resource: 'secrets',
    outcome: 'success',
    ipAddress: '203.0.113.4',
    actor: 'admin-2',
  },
];

describe('COMPLIANCE_CONTROLS', () => {
  it('covers both SOC2 and PCI-DSS', () => {
    const frameworks = new Set(COMPLIANCE_CONTROLS.map((control) => control.framework));
    expect(frameworks).toEqual(new Set(['SOC2', 'PCI-DSS']));
  });

  it('uses unique control identifiers per framework', () => {
    const ids = COMPLIANCE_CONTROLS.map((control) => `${control.framework}:${control.id}`);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('generateComplianceReport', () => {
  it('marks controls with matching evidence as satisfied', () => {
    const report = generateComplianceReport(events(...FULL_EVIDENCE));

    const cc62 = report.controls.find((control) => control.framework === 'SOC2' && control.id === 'CC6.2');
    expect(cc62?.coverage).toBe('satisfied');
    // Both the role grant and the API-key rotation evidence access provisioning.
    expect(cc62?.matchedEvents).toBe(2);
    expect(cc62?.evidence.map((evidence) => evidence.actor)).toContain('admin-1');
  });

  it('marks controls with no matching evidence as gaps', () => {
    const report = generateComplianceReport(events(...FULL_EVIDENCE));

    const sanctions = report.controls.find((control) => control.id === '10.2.2');
    expect(sanctions?.coverage).toBe('gap');
    expect(sanctions?.matchedEvents).toBe(0);
    expect(sanctions?.evidence).toEqual([]);
  });

  it('summarises satisfied controls and gaps per framework', () => {
    const report = generateComplianceReport(events(...FULL_EVIDENCE));

    expect(report.summary.satisfied + report.summary.gaps).toBe(report.controls.length);
    expect(report.summary.byFramework['PCI-DSS'].satisfied).toBeGreaterThan(0);
    expect(report.summary.byFramework.SOC2.satisfied).toBeGreaterThan(0);
  });

  it('can be scoped to a single framework', () => {
    const report = generateComplianceReport(events(...FULL_EVIDENCE), { frameworks: ['PCI-DSS'] });

    expect(report.controls.every((control) => control.framework === 'PCI-DSS')).toBe(true);
    expect(report.summary.byFramework.SOC2).toEqual({ satisfied: 0, gaps: 0 });
  });

  it('honours the from/to reporting window', () => {
    const base = Date.UTC(2026, 0, 1);
    const day = 24 * 60 * 60 * 1000;
    const all = events(...FULL_EVIDENCE.map((input, index) => ({ ...input, timestamp: base + index * day })));
    const midpoint = all[1]!.timestamp;

    const report = generateComplianceReport(all, { from: midpoint });
    expect(report.totalEvents).toBe(3);

    const empty = generateComplianceReport(all, { to: all[0]!.timestamp - 1 });
    expect(empty.totalEvents).toBe(0);
  });

  it('reports PCI-DSS field completeness and the fields that are missing', () => {
    const report = generateComplianceReport([
      normalizeAuditEvent({ action: 'auth.post', resource: 'auth' }),
      ...events(...FULL_EVIDENCE),
    ]);

    expect(report.fieldCompleteness.pciDssComplete).toBe(4);
    expect(report.fieldCompleteness.missingFields.originOfEvent).toBe(1);
    expect(report.fieldCompleteness.missingFields.successOrFailure).toBe(1);
  });

  it('limits the evidence attached to each control', () => {
    const many = events(
      ...Array.from({ length: 8 }, (_, index) => ({
        action: 'roles.post',
        resource: 'roles',
        actor: `admin-${index}`,
        outcome: 'success' as const,
      }))
    );

    const report = generateComplianceReport(many, { evidenceLimit: 2 });
    const cc62 = report.controls.find((control) => control.id === 'CC6.2')!;

    expect(cc62.matchedEvents).toBe(8);
    expect(cc62.evidence).toHaveLength(2);
  });

  it('returns an in-window event count and generation metadata', () => {
    const report = generateComplianceReport(events(...FULL_EVIDENCE));

    expect(report.totalEvents).toBe(4);
    expect(new Date(report.generatedAt).toString()).not.toBe('Invalid Date');
  });
});

describe('complianceReportToCsv', () => {
  it('renders a header plus one row per control', () => {
    const report = generateComplianceReport(events(...FULL_EVIDENCE));
    const [header, ...rows] = complianceReportToCsv(report).split('\n');

    expect(header).toContain('Framework');
    expect(header).toContain('Coverage');
    expect(rows).toHaveLength(report.controls.length);
  });
});
