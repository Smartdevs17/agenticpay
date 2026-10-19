/**
 * PCI DSS compliance dashboard API — Issue #924
 *
 * Endpoints:
 * - GET   /pci-dss/dashboard                 → full dashboard (score, requirements, gaps)
 * - GET   /pci-dss/requirements              → per-requirement assessments
 * - GET   /pci-dss/gaps                      → prioritised gaps (filter by ?priority=)
 * - GET   /pci-dss/controls/:id              → a single control assessment
 * - PATCH /pci-dss/controls/:id              → record a control's status/evidence
 * - POST  /pci-dss/reset                     → restore the default sample posture
 * - GET   /pci-dss/export/evidence.csv       → control evidence export
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  PciDssPriority,
  assessPciDss,
  buildPciDssDashboard,
  exportPciDssEvidenceCsv,
  getControlStatus,
  getPciDssGaps,
  resetPciDssEvidence,
  setControlStatus,
} from '../services/pci-dss.js';

export const pciDssRouter = Router();

const controlUpdateSchema = z.object({
  status: z.enum(['in_place', 'not_in_place', 'not_tested', 'not_applicable']),
  evidence: z.string().optional(),
});

pciDssRouter.get(
  '/dashboard',
  asyncHandler(async (req: Request, res: Response) => {
    const assessedBy = req.query.assessedBy as string | undefined;
    res.status(200).json({ success: true, data: buildPciDssDashboard({ assessedBy }) });
  }),
);

pciDssRouter.get(
  '/requirements',
  asyncHandler(async (_req: Request, res: Response) => {
    res.status(200).json({ success: true, data: assessPciDss() });
  }),
);

pciDssRouter.get(
  '/gaps',
  asyncHandler(async (req: Request, res: Response) => {
    const priority = req.query.priority as PciDssPriority | undefined;
    res.status(200).json({ success: true, data: getPciDssGaps(priority) });
  }),
);

pciDssRouter.get(
  '/controls/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const control = getControlStatus(req.params.id);
    if (!control) {
      res.status(404).json({ success: false, error: { message: 'Unknown PCI DSS control' } });
      return;
    }
    res.status(200).json({ success: true, data: control });
  }),
);

pciDssRouter.patch(
  '/controls/:id',
  validate(controlUpdateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { status, evidence } = req.body as z.infer<typeof controlUpdateSchema>;
    try {
      const updated = setControlStatus(req.params.id, status, evidence);
      res.status(200).json({ success: true, data: updated });
    } catch (error) {
      res.status(404).json({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Unable to update control' },
      });
    }
  }),
);

pciDssRouter.post(
  '/reset',
  asyncHandler(async (_req: Request, res: Response) => {
    resetPciDssEvidence();
    res.status(200).json({ success: true, data: buildPciDssDashboard() });
  }),
);

pciDssRouter.get(
  '/export/evidence.csv',
  asyncHandler(async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/csv');
    res.status(200).send(exportPciDssEvidenceCsv());
  }),
);
