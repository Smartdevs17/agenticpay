import { beforeEach, describe, expect, it } from 'vitest';
import {
  PCI_DSS_REQUIREMENTS,
  assessPciDss,
  buildPciDssDashboard,
  exportPciDssEvidenceCsv,
  getControlStatus,
  getPciDssGaps,
  resetPciDssEvidence,
  setControlStatus,
} from '../../pci-dss.js';

beforeEach(() => resetPciDssEvidence());

describe('PCI DSS catalogue (#924)', () => {
  it('defines the twelve PCI DSS v4.0 requirements', () => {
    expect(PCI_DSS_REQUIREMENTS).toHaveLength(12);
    expect(PCI_DSS_REQUIREMENTS.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(PCI_DSS_REQUIREMENTS.every((r) => r.controls.length > 0)).toBe(true);
  });
});

describe('PCI DSS dashboard (#924)', () => {
  it('builds a dashboard with the default sample posture', () => {
    const dashboard = buildPciDssDashboard({ assessedBy: 'auditor-1' });

    expect(dashboard.version).toBe('4.0');
    expect(dashboard.assessedBy).toBe('auditor-1');
    expect(dashboard.requirements).toHaveLength(12);
    expect(dashboard.requirementStatusCounts.compliant).toBe(5);
    expect(dashboard.requirementStatusCounts.in_place_with_deficiencies).toBe(3);
    expect(dashboard.requirementStatusCounts.non_compliant).toBe(4);
    expect(dashboard.controlStatusCounts.in_place).toBe(24);
    expect(dashboard.controlStatusCounts.not_in_place).toBe(4);
    expect(dashboard.controlStatusCounts.not_tested).toBe(4);
    expect(dashboard.controlStatusCounts.not_applicable).toBe(1);
    expect(dashboard.overallStatus).toBe('non_compliant');
    expect(dashboard.overallScore).toBeGreaterThan(0);
    expect(dashboard.overallScore).toBeLessThan(100);
    expect(dashboard.gaps).toHaveLength(8);
  });

  it('derives per-requirement compliance percentages', () => {
    const requirements = assessPciDss();
    const req3 = requirements.find((r) => r.id === 3);
    const req4 = requirements.find((r) => r.id === 4);
    const req9 = requirements.find((r) => r.id === 9);

    expect(req3?.status).toBe('non_compliant');
    expect(req3?.compliancePercent).toBe(75);
    expect(req4?.compliancePercent).toBe(50);
    expect(req9?.status).toBe('in_place_with_deficiencies');
    expect(req9?.compliancePercent).toBe(0);
  });

  it('orders gaps by priority and supports filtering', () => {
    const all = getPciDssGaps();
    const high = getPciDssGaps('high');
    expect(high.length).toBeGreaterThan(0);
    expect(high.every((gap) => gap.priority === 'high')).toBe(true);
    expect(all[0].priority).toBe('high');
    expect(getPciDssGaps('low')).toHaveLength(1);
  });
});

describe('PCI DSS control evidence (#924)', () => {
  it('records a status change that clears a gap', () => {
    const before = buildPciDssDashboard();
    expect(before.gaps.some((gap) => gap.controlId === '3.6.1')).toBe(true);

    const updated = setControlStatus('3.6.1', 'in_place', 'KMS rotation documented');
    expect(updated.status).toBe('in_place');
    expect(updated.evidence).toBe('KMS rotation documented');
    expect(getControlStatus('3.6.1')?.status).toBe('in_place');

    const after = buildPciDssDashboard();
    expect(after.gaps.some((gap) => gap.controlId === '3.6.1')).toBe(false);
    expect(after.requirements.find((r) => r.id === 3)?.status).toBe('compliant');
  });

  it('becomes fully compliant once every gap is remediated', () => {
    for (const gap of getPciDssGaps()) {
      setControlStatus(gap.controlId, 'in_place');
    }
    const dashboard = buildPciDssDashboard();
    expect(dashboard.gaps).toHaveLength(0);
    expect(dashboard.overallStatus).toBe('compliant');
    expect(dashboard.overallScore).toBe(100);
    expect(dashboard.requirementStatusCounts.non_compliant).toBe(0);
  });

  it('rejects unknown controls', () => {
    expect(() => setControlStatus('99.9.9', 'in_place')).toThrow(/unknown/i);
    expect(getControlStatus('99.9.9')).toBeNull();
  });

  it('resets back to the default posture', () => {
    setControlStatus('3.6.1', 'in_place');
    expect(buildPciDssDashboard().gaps).toHaveLength(7);
    resetPciDssEvidence();
    expect(buildPciDssDashboard().gaps).toHaveLength(8);
  });
});

describe('PCI DSS evidence export (#924)', () => {
  it('exports one CSV row per control', () => {
    const csv = exportPciDssEvidenceCsv();
    const lines = csv.split('\n');
    const totalControls = PCI_DSS_REQUIREMENTS.reduce((sum, r) => sum + r.controls.length, 0);
    expect(lines[0]).toContain('control_id');
    expect(lines).toHaveLength(totalControls + 1);
  });

  it('escapes evidence text in CSV output', () => {
    setControlStatus('3.6.1', 'in_place', 'evidence with "quotes"');
    expect(exportPciDssEvidenceCsv()).toContain('"evidence with ""quotes"""');
  });
});
