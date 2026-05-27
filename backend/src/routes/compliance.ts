import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { runComplianceChecks } from '../compliance/checks.js';
import { auditService } from '../services/auditService.js';

export const complianceRouter = Router();

complianceRouter.get(
  '/status',
  asyncHandler(async (_req: Request, res: Response) => {
    const checks = runComplianceChecks();
    res.status(200).json({ checks });
  })
);

complianceRouter.get(
  '/evidence/audit/export',
  asyncHandler(async (req: Request, res: Response) => {
    const format = String(req.query.format || 'json').toLowerCase();

    if (format === 'csv') {
      const csv = await auditService.exportToCSV();
      res.setHeader('Content-Type', 'text/csv');
      res.status(200).send(csv);
      return;
    }

    const json = await auditService.exportToJSON();
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(json);
  })
);

