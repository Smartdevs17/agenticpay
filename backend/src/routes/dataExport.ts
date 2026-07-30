/**
 * dataExport.ts — Issue #595
 *
 * Data export REST API routes.
 *
 * POST   /data-export                        — queue a new export
 * GET    /data-export/:id                    — get export status
 * GET    /data-export/user/:userId           — list user's exports
 * DELETE /data-export/:id                    — delete an export
 * GET    /data-export/audit                  — audit log
 *
 * POST   /data-export/schedules              — create scheduled export
 * GET    /data-export/schedules/user/:userId — list user schedules
 * PATCH  /data-export/schedules/:id          — update schedule
 * DELETE /data-export/schedules/:id          — delete schedule
 */

import { Router, type Request, type Response } from 'express';
import { dataExportService, type ExportFormat, type ExportScope, type ScheduleFrequency, type ScheduledExport } from '../services/dataExport.js';

const router = Router();

// ── POST /data-export ─────────────────────────────────────────────────────────

router.post('/', (req: Request, res: Response) => {
  const { userId, format, scope, anonymise, isGdprRequest, deliveryEmail } = req.body as {
    userId?: string;
    format?: string;
    scope?: string[];
    anonymise?: boolean;
    isGdprRequest?: boolean;
    deliveryEmail?: string;
  };

  if (!userId || !format || !scope) {
    return res.status(400).json({
      success: false,
      error: 'userId, format and scope are required',
    });
  }

  const allowedFormats = ['json', 'csv', 'pdf'];
  if (!allowedFormats.includes(format)) {
    return res.status(400).json({
      success: false,
      error: `format must be one of: ${allowedFormats.join(', ')}`,
    });
  }

  const result = dataExportService.createExport({
    userId,
    format: format as 'json' | 'csv' | 'pdf',
    scope: scope as ExportScope[],
    anonymise,
    isGdprRequest,
    deliveryEmail,
  });

  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }

  return res.status(202).json({ success: true, data: result.value });
});

// ── GET /data-export/audit ────────────────────────────────────────────────────

router.get('/audit', (req: Request, res: Response) => {
  const { userId, limit } = req.query as { userId?: string; limit?: string };
  const entries = dataExportService.getAuditLog(userId, limit ? parseInt(limit) : 100);
  return res.json({ success: true, count: entries.length, data: entries });
});

// ── GET /data-export/user/:userId ─────────────────────────────────────────────

router.get('/user/:userId', (req: Request, res: Response) => {
  const { limit } = req.query as { limit?: string };
  const exports = dataExportService.listUserExports(
    req.params.userId,
    limit ? parseInt(limit) : 50,
  );
  return res.json({ success: true, count: exports.length, data: exports });
});

// ── GET /data-export/:id ──────────────────────────────────────────────────────

router.get('/:id', (req: Request, res: Response) => {
  const result = dataExportService.getExport(req.params.id);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 404).json({
      success: false,
      error: result.error.message,
    });
  }
  return res.json({ success: true, data: result.value });
});

// ── DELETE /data-export/:id ───────────────────────────────────────────────────

router.delete('/:id', (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId is required' });
  }

  const result = dataExportService.deleteExport(req.params.id, userId);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }

  return res.status(204).send();
});

// ── Scheduled exports ─────────────────────────────────────────────────────────

// POST /data-export/schedules
router.post('/schedules', (req: Request, res: Response) => {
  const { userId, format, scope, frequency, anonymise, deliveryEmail } = req.body as {
    userId?: string;
    format?: string;
    scope?: string[];
    frequency?: string;
    anonymise?: boolean;
    deliveryEmail?: string;
  };

  if (!userId || !format || !scope || !frequency || !deliveryEmail) {
    return res.status(400).json({
      success: false,
      error: 'userId, format, scope, frequency and deliveryEmail are required',
    });
  }

  const result = dataExportService.createSchedule({
    userId,
    format: format as ExportFormat,
    scope: scope as ExportScope[],
    frequency: frequency as ScheduleFrequency,
    anonymise,
    deliveryEmail,
  });

  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }

  return res.status(201).json({ success: true, data: result.value });
});

// GET /data-export/schedules/user/:userId
router.get('/schedules/user/:userId', (req: Request, res: Response) => {
  const schedules = dataExportService.listUserSchedules(req.params.userId);
  return res.json({ success: true, count: schedules.length, data: schedules });
});

// PATCH /data-export/schedules/:id
router.patch('/schedules/:id', (req: Request, res: Response) => {
  const { userId, ...updates } = req.body as {
    userId?: string;
    enabled?: boolean;
    format?: string;
    scope?: string[];
    frequency?: string;
    deliveryEmail?: string;
    anonymise?: boolean;
  };

  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId is required' });
  }

  const result = dataExportService.updateSchedule(req.params.id, userId, updates as Partial<Pick<ScheduledExport, 'enabled' | 'format' | 'scope' | 'frequency' | 'deliveryEmail' | 'anonymise'>>);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }

  return res.json({ success: true, data: result.value });
});

// DELETE /data-export/schedules/:id
router.delete('/schedules/:id', (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId is required' });
  }

  const result = dataExportService.deleteSchedule(req.params.id, userId);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }

  return res.status(204).send();
});

export default router;
