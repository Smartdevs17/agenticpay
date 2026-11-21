import { describe, expect, it, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { taxReportingRouter } from '../../routes/tax-reporting.js';

// Integration tests for the tax-reporting routes
describe('Tax Reporting Routes — Issues #690–#693', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/tax-reporting', taxReportingRouter);

    // Error handler
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.statusCode || 500).json({
        error: { message: err.message, code: err.code, statusCode: err.statusCode },
      });
    });
  });

  describe('POST /reports/generate', () => {
    it('generates a tax report and returns 201', async () => {
      const res = await request(app)
        .post('/api/v1/tax-reporting/reports/generate')
        .send({
          tenantId: 't_1',
          merchantId: 'm_1',
          period: 'monthly',
          year: 2025,
          periodNumber: 6,
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.period).toBe('monthly');
      expect(res.body.data.year).toBe(2025);
      expect(res.body.data.status).toBe('draft');
    });

    it('returns 400 for missing tenantId', async () => {
      const res = await request(app)
        .post('/api/v1/tax-reporting/reports/generate')
        .send({
          merchantId: 'm_1',
          period: 'monthly',
          year: 2025,
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid period', async () => {
      const res = await request(app)
        .post('/api/v1/tax-reporting/reports/generate')
        .send({
          tenantId: 't_1',
          merchantId: 'm_1',
          period: 'weekly',
          year: 2025,
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /reports/generate-batch', () => {
    it('batch generates reports', async () => {
      const res = await request(app)
        .post('/api/v1/tax-reporting/reports/generate-batch')
        .send({
          tenantId: 't_1',
          merchantIds: ['m_1', 'm_2'],
          period: 'monthly',
          year: 2025,
          periodNumber: 6,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.generated).toBe(2);
      expect(res.body.data.failed).toBe(0);
    });

    it('returns 400 for empty merchantIds', async () => {
      const res = await request(app)
        .post('/api/v1/tax-reporting/reports/generate-batch')
        .send({
          tenantId: 't_1',
          merchantIds: [],
          period: 'monthly',
          year: 2025,
        });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /reports', () => {
    it('lists reports', async () => {
      // Generate a report first
      await request(app)
        .post('/api/v1/tax-reporting/reports/generate')
        .send({
          tenantId: 't_1',
          merchantId: 'm_1',
          period: 'monthly',
          year: 2025,
          periodNumber: 6,
        });

      const res = await request(app)
        .get('/api/v1/tax-reporting/reports')
        .query({ tenantId: 't_1' });

      expect(res.status).toBe(200);
      expect(res.body.data.reports).toBeDefined();
      expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /reports/:id', () => {
    it('gets a specific report', async () => {
      const genRes = await request(app)
        .post('/api/v1/tax-reporting/reports/generate')
        .send({
          tenantId: 't_1',
          merchantId: 'm_1',
          period: 'monthly',
          year: 2025,
          periodNumber: 6,
        });

      const reportId = genRes.body.data.id;
      const res = await request(app).get(`/api/v1/tax-reporting/reports/${reportId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(reportId);
    });

    it('returns 404 for unknown report', async () => {
      const res = await request(app).get('/api/v1/tax-reporting/reports/does-not-exist');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /reports/:id/finalize', () => {
    it('finalizes a draft report', async () => {
      const genRes = await request(app)
        .post('/api/v1/tax-reporting/reports/generate')
        .send({
          tenantId: 't_1',
          merchantId: 'm_1',
          period: 'monthly',
          year: 2025,
          periodNumber: 6,
        });

      const reportId = genRes.body.data.id;
      const res = await request(app).post(`/api/v1/tax-reporting/reports/${reportId}/finalize`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('finalized');
    });
  });

  describe('POST /reports/:id/archive', () => {
    it('archives a finalized report', async () => {
      const genRes = await request(app)
        .post('/api/v1/tax-reporting/reports/generate')
        .send({
          tenantId: 't_1',
          merchantId: 'm_1',
          period: 'monthly',
          year: 2025,
          periodNumber: 6,
        });

      const reportId = genRes.body.data.id;
      await request(app).post(`/api/v1/tax-reporting/reports/${reportId}/finalize`);
      const res = await request(app).post(`/api/v1/tax-reporting/reports/${reportId}/archive`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('archived');
    });
  });

  describe('GET /reports/:id/export', () => {
    it('exports report as CSV', async () => {
      const genRes = await request(app)
        .post('/api/v1/tax-reporting/reports/generate')
        .send({
          tenantId: 't_1',
          merchantId: 'm_1',
          period: 'monthly',
          year: 2025,
          periodNumber: 6,
        });

      const reportId = genRes.body.data.id;
      const res = await request(app)
        .get(`/api/v1/tax-reporting/reports/${reportId}/export`)
        .query({ format: 'csv' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
    });

    it('exports report as JSON', async () => {
      const genRes = await request(app)
        .post('/api/v1/tax-reporting/reports/generate')
        .send({
          tenantId: 't_1',
          merchantId: 'm_1',
          period: 'monthly',
          year: 2025,
          periodNumber: 6,
        });

      const reportId = genRes.body.data.id;
      const res = await request(app)
        .get(`/api/v1/tax-reporting/reports/${reportId}/export`)
        .query({ format: 'json' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
    });

    it('returns 400 for invalid format', async () => {
      const genRes = await request(app)
        .post('/api/v1/tax-reporting/reports/generate')
        .send({
          tenantId: 't_1',
          merchantId: 'm_1',
          period: 'monthly',
          year: 2025,
          periodNumber: 6,
        });

      const reportId = genRes.body.data.id;
      const res = await request(app)
        .get(`/api/v1/tax-reporting/reports/${reportId}/export`)
        .query({ format: 'xml' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /filing', () => {
    it('generates a filing report', async () => {
      const res = await request(app)
        .post('/api/v1/tax-reporting/filing')
        .send({
          tenantId: 't_1',
          merchantId: 'm_1',
          year: 2025,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.year).toBe(2025);
      expect(res.body.data.jurisdictions).toBeDefined();
    });
  });

  describe('Calendar endpoints', () => {
    it('creates a deadline', async () => {
      const res = await request(app)
        .post('/api/v1/tax-reporting/calendar/deadlines')
        .send({
          tenantId: 't_1',
          merchantId: 'm_1',
          jurisdiction: 'US',
          name: 'Q2 Tax',
          frequency: 'quarterly',
          dueDate: '2025-07-15T23:59:59.000Z',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.jurisdiction).toBe('US');
      expect(res.body.data.name).toBe('Q2 Tax');
    });

    it('lists deadlines', async () => {
      await request(app)
        .post('/api/v1/tax-reporting/calendar/deadlines')
        .send({
          tenantId: 't_1',
          merchantId: 'm_1',
          jurisdiction: 'US',
          name: 'Q2 Tax',
          frequency: 'quarterly',
          dueDate: '2025-07-15T23:59:59.000Z',
        });

      const res = await request(app)
        .get('/api/v1/tax-reporting/calendar/deadlines')
        .query({ tenantId: 't_1' });

      expect(res.status).toBe(200);
      expect(res.body.data.deadlines).toHaveLength(1);
    });

    it('gets deadline alerts', async () => {
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      await request(app)
        .post('/api/v1/tax-reporting/calendar/deadlines')
        .send({
          tenantId: 't_1',
          merchantId: 'm_1',
          jurisdiction: 'US',
          name: 'Upcoming Tax',
          frequency: 'quarterly',
          dueDate: futureDate,
        });

      const res = await request(app)
        .get('/api/v1/tax-reporting/calendar/alerts')
        .query({ tenantId: 't_1', lookaheadDays: 30 });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('returns default templates', async () => {
      const res = await request(app)
        .get('/api/v1/tax-reporting/calendar/templates');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('applies a template to create a deadline', async () => {
      const res = await request(app)
        .post('/api/v1/tax-reporting/calendar/templates/apply')
        .send({
          tenantId: 't_1',
          merchantId: 'm_1',
          jurisdiction: 'US',
          year: 2025,
          periodNumber: 1,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.jurisdiction).toBe('US');
    });

    it('completes a deadline', async () => {
      const createRes = await request(app)
        .post('/api/v1/tax-reporting/calendar/deadlines')
        .send({
          tenantId: 't_1',
          merchantId: 'm_1',
          jurisdiction: 'US',
          name: 'Tax',
          frequency: 'quarterly',
          dueDate: '2025-07-15T23:59:59.000Z',
        });

      const id = createRes.body.data.id;
      const res = await request(app).post(`/api/v1/tax-reporting/calendar/deadlines/${id}/complete`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('completed');
    });

    it('extends a deadline', async () => {
      const createRes = await request(app)
        .post('/api/v1/tax-reporting/calendar/deadlines')
        .send({
          tenantId: 't_1',
          merchantId: 'm_1',
          jurisdiction: 'US',
          name: 'Tax',
          frequency: 'quarterly',
          dueDate: '2025-07-15T23:59:59.000Z',
        });

      const id = createRes.body.data.id;
      const res = await request(app)
        .post(`/api/v1/tax-reporting/calendar/deadlines/${id}/extend`)
        .send({ extensionUntil: '2025-08-15T23:59:59.000Z' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('extension');
    });
  });
});
