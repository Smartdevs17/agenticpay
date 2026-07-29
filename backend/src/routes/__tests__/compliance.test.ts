import express, { type Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { complianceRouter } from '../compliance.js';
import { errorHandler } from '../../middleware/errorHandler.js';
import { complianceService } from '../../compliance/service.js';

const ORIGINAL_ENV = { ...process.env };

let server: import('node:http').Server;
let base = '';

async function call<T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: T; text: string }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text && res.headers.get('content-type')?.includes('application/json') ? (JSON.parse(text) as T) : (undefined as T),
    text,
  };
}

describe('compliance http api', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.AUDIT_PERSISTENCE = 'memory';
    const app: Express = express();
    app.use(express.json());
    app.use('/api/v1/compliance', complianceRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    process.env = { ...ORIGINAL_ENV };
  });

  beforeEach(() => {
    complianceService.resetForTests();
    delete process.env.BACKUP_ENABLED;
    delete process.env.BACKUP_PROVIDER;
  });

  it('runs automated compliance checks from the status endpoint', async () => {
    const res = await call<{ summary: { total: number; failed: number }; checks: Array<{ id: string }> }>('GET', '/api/v1/compliance/status');

    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBeGreaterThanOrEqual(10);
    expect(res.body.summary.failed).toBe(0);
    expect(res.body.checks.map((check) => check.id)).toContain('regulatory_update_monitoring');
    expect(res.body.checks.map((check) => check.id)).toContain('compliance_dashboard');
  });

  it('monitors and ingests regulatory updates', async () => {
    const monitor = await call<{ data: { sourcesChecked: number; updatesDetected: number } }>('POST', '/api/v1/compliance/regulatory-updates/monitor');
    expect(monitor.status).toBe(200);
    expect(monitor.body.data.sourcesChecked).toBeGreaterThan(0);

    const created = await call<{ data: { id: string; title: string; status: string } }>('POST', '/api/v1/compliance/regulatory-updates/ingest', {
      title: 'Updated KYC documentation rule',
      summary: 'Collect additional business ownership evidence for high-risk merchants.',
      severity: 'high',
      jurisdiction: 'NG',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('new');

    const listed = await call<{ data: Array<{ id: string }> }>('GET', '/api/v1/compliance/regulatory-updates');
    expect(listed.body.data.some((update) => update.id === created.body.data.id)).toBe(true);
  });

  it('exposes alerts, reports, audit trail, dashboard, and documentation', async () => {
    process.env.BACKUP_ENABLED = 'true';
    await call('GET', '/api/v1/compliance/status');

    const alerts = await call<{ data: Array<{ id: string; status: string }> }>('GET', '/api/v1/compliance/alerts?status=open');
    expect(alerts.status).toBe(200);
    expect(alerts.body.data.length).toBeGreaterThan(0);

    const ack = await call<{ data: { status: string } }>('POST', `/api/v1/compliance/alerts/${alerts.body.data[0].id}/acknowledge`, { actor: 'auditor' });
    expect(ack.body.data.status).toBe('acknowledged');

    const report = await call<{ data: { summary: { total: number; openAlerts: number } } }>('GET', '/api/v1/compliance/reports');
    expect(report.status).toBe(200);
    expect(report.body.data.summary.total).toBeGreaterThan(0);

    const csv = await call('GET', '/api/v1/compliance/reports?format=csv');
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Section');

    const auditTrail = await call<{ data: { total: number } }>('GET', '/api/v1/compliance/audit-trail');
    expect(auditTrail.body.data.total).toBeGreaterThan(0);

    const dashboard = await call<{ data: { complianceScore: number; alerts: { open: number } } }>('GET', '/api/v1/compliance/dashboard');
    expect(dashboard.body.data.complianceScore).toBeGreaterThanOrEqual(0);

    const docs = await call<{ data: { endpoints: Array<{ path: string }> } }>('GET', '/api/v1/compliance/documentation');
    expect(docs.body.data.endpoints.some((endpoint) => endpoint.path.includes('/dashboard'))).toBe(true);
  });
});
