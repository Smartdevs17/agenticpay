import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';

const { increment, timing, info } = vi.hoisted(() => ({
  increment: vi.fn(),
  timing: vi.fn(),
  info: vi.fn(),
}));

// Vitest would otherwise pick up the stale compiled CommonJS error handler.
vi.mock('../../middleware/errorHandler.js', () => import('../../middleware/errorHandler.ts'));
vi.mock('../../utils/logger.js', () => ({ logger: { info, warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../services/auditService.js', () => ({
  auditService: { exportToCSV: vi.fn(async () => 'id\n'), exportToJSON: vi.fn(async () => '[]') },
}));
vi.mock('../../compliance/checks.js', () => ({ runComplianceChecks: () => [] }));

import { complianceRouter, setComplianceExportMetrics } from '../compliance.js';
import { errorHandler } from '../../middleware/errorHandler.js';
import { ComplianceService } from '../../services/complianceService.js';

let server: import('node:http').Server;
let base = '';

describe('compliance routes', () => {
  beforeAll(async () => {
    setComplianceExportMetrics({ increment, timing });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/compliance', complianceRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/compliance`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    increment.mockClear();
    timing.mockClear();
    info.mockClear();
  });

  describe('dashboard endpoints', () => {
    it('serves the dashboard payload the frontend reads', async () => {
      const res = await fetch(`${base}/dashboard`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.metrics).toHaveProperty('kycVerificationRate');
      expect(Array.isArray(body.data.jurisdictionStatus)).toBe(true);
    });

    it('serves metrics, jurisdictions and alerts lists', async () => {
      for (const path of ['/metrics?jurisdiction=US', '/jurisdictions', '/alerts?status=open']) {
        const res = await fetch(`${base}${path}`);
        expect(res.status).toBe(200);
        expect(Array.isArray((await res.json()).data)).toBe(true);
      }
    });

    it('evaluates thresholds and acknowledges an alert', async () => {
      const alert = ComplianceService.createAlert(
        'aml_flag_rate',
        'warning',
        'AML flag rate above warning level',
        'EU',
        { value: 3 },
      );

      const evaluated = await fetch(`${base}/alerts/evaluate`, { method: 'POST' });
      expect(evaluated.status).toBe(200);

      const ack = await fetch(`${base}/alerts/${alert.id}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'officer-1' }),
      });
      expect(ack.status).toBe(200);
      expect((await ack.json()).data.status).toBe('acknowledged');
    });

    it('requires a period when requesting a report', async () => {
      const res = await fetch(`${base}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jurisdiction: 'US' }),
      });
      expect(res.status).toBe(400);
    });

    it('accepts a report request and lists it', async () => {
      const res = await fetch(`${base}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: '2026-10', jurisdiction: 'US' }),
      });
      expect(res.status).toBe(202);
      const { data } = await res.json();

      const list = await (await fetch(`${base}/reports`)).json();
      expect(list.data.map((r: { id: string }) => r.id)).toContain(data.id);
    });

    it('exports metrics as a CSV download', async () => {
      const res = await fetch(`${base}/export/csv?jurisdiction=US`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(res.headers.get('content-disposition')).toContain('compliance-metrics-US');
      expect((await res.text()).split('\n')[0]).toMatch(/^metric,value/);
    });
  });

  describe('GET /regulator/export', () => {
    it('returns a live JSON snapshot scoped to the jurisdiction', async () => {
      ComplianceService.createAlert('sanctions_hit_rate', 'critical', 'Sanctions hit', 'UK');
      ComplianceService.createAlert('pep_hit_rate', 'warning', 'PEP hit', 'SG');

      const res = await fetch(`${base}/regulator/export?jurisdiction=uk`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('content-disposition')).toMatch(/regulator-export-UK-.*\.json/);
      expect(res.headers.get('cache-control')).toBe('no-store');

      const body = await res.json();
      expect(body.jurisdiction).toBe('UK');
      expect(body.exportId).toMatch(/^regexp_/);
      expect(Date.parse(body.generatedAt)).not.toBeNaN();
      expect(body.openAlerts.length).toBeGreaterThan(0);
      expect(body.openAlerts.every((a: { jurisdiction: string }) => a.jurisdiction === 'UK')).toBe(true);
      expect(body.jurisdictions.every((j: { jurisdiction: string }) => j.jurisdiction === 'UK')).toBe(true);
    });

    it('returns metrics and audit trail sections as CSV', async () => {
      const res = await fetch(`${base}/regulator/export?jurisdiction=US&format=csv`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      const text = await res.text();
      expect(text).toContain('# metrics');
      expect(text).toContain('# audit_trail');
      expect(text).toContain('jurisdiction=US');
    });

    it('writes each export to the audit trail', async () => {
      const res = await fetch(`${base}/regulator/export?jurisdiction=EU&requestedBy=auditor-7`);
      const { exportId } = await res.json();

      const entry = ComplianceService.getAuditTrailByAction('regulator_export').find((e) => e.entityId === exportId);
      expect(entry).toMatchObject({ userId: 'auditor-7', jurisdiction: 'EU', automated: false });
      expect(entry?.details).toMatchObject({ format: 'json' });
    });

    it('emits metrics and a log line', async () => {
      await fetch(`${base}/regulator/export?format=csv`);
      const tags = { jurisdiction: 'GLOBAL', format: 'csv' };
      expect(increment).toHaveBeenCalledWith('compliance.regulator_export', 1, tags);
      expect(timing).toHaveBeenCalledWith('compliance.regulator_export.duration', expect.any(Number), tags);
      expect(info).toHaveBeenCalledWith(
        '[compliance] regulator export generated',
        expect.objectContaining({ jurisdiction: 'GLOBAL', format: 'csv' }),
      );
    });

    it('rejects an unknown jurisdiction', async () => {
      const res = await fetch(`${base}/regulator/export?jurisdiction=MARS`);
      expect(res.status).toBe(400);
      expect((await res.json()).error.message).toContain('MARS');
      expect(increment).not.toHaveBeenCalled();
    });

    it('rejects an unknown format', async () => {
      const res = await fetch(`${base}/regulator/export?format=xml`);
      expect(res.status).toBe(400);
      expect(increment).not.toHaveBeenCalled();
    });
  });
});
