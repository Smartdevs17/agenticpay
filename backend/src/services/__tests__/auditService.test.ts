/**
 * AuditService outcome behaviour tests — Issue #793
 */
import { describe, expect, it } from 'vitest';
import { AuditService } from '../auditService.js';

describe('AuditService outcome logging (#793)', () => {
  it('derives a success outcome from a 2xx response status', async () => {
    const service = new AuditService();
    const entry = await service.logAction({
      userId: 'u1',
      action: 'auth.post',
      resource: 'auth',
      response: { status: 200 },
    });

    expect(entry.outcome).toBe('success');
    expect(typeof entry.timestamp).toBe('number');
  });

  it('derives a failure outcome from a 4xx/5xx response status', async () => {
    const service = new AuditService();
    const entry = await service.logAction({
      action: 'payments.post',
      resource: 'payments',
      response: { status: 500 },
    });

    expect(entry.outcome).toBe('failure');
  });

  it('honours an explicit outcome over the response status', async () => {
    const service = new AuditService();
    const entry = await service.logAction({
      action: 'auth.post',
      resource: 'auth',
      outcome: 'failure',
      response: { status: 200 },
    });

    expect(entry.outcome).toBe('failure');
  });

  it('leaves the outcome undefined when neither outcome nor status is given', async () => {
    const service = new AuditService();
    const entry = await service.logAction({ action: 'admin.get', resource: 'admin' });

    expect(entry.outcome).toBeUndefined();
  });

  it('redacts sensitive fields in the request body', async () => {
    const service = new AuditService();
    const entry = await service.logAction({
      action: 'auth.post',
      resource: 'auth',
      request: { method: 'POST', path: '/api/v1/auth/login', body: { password: 'hunter2', apiKey: 'abc' } },
    });

    expect(entry.requestBody).toEqual({ password: '[REDACTED]', apiKey: '[REDACTED]' });
  });

  it('keeps the hash chain valid after logging outcomes', async () => {
    const service = new AuditService();
    await service.logAction({ action: 'auth.post', resource: 'auth', response: { status: 200 } });
    await service.logAction({ action: 'auth.post', resource: 'auth', response: { status: 401 } });

    await expect(service.verifyIntegrity()).resolves.toEqual({ valid: true });
  });

  it('includes the Outcome column in CSV exports', async () => {
    const service = new AuditService();
    await service.logAction({ action: 'auth.post', resource: 'auth', response: { status: 201 } });

    const csv = await service.exportToCSV();
    const [header, row] = csv.split('\n');
    expect(header).toContain('Outcome');
    expect(row).toContain('success');
  });
});
