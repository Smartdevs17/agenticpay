import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ContractAuditService } from '../services/contractAuditService.js';

export const contractAuditRouter = Router();
const auditService = new ContractAuditService();

contractAuditRouter.post('/analyze', asyncHandler(async (req: Request, res: Response) => {
  const { source, language } = req.body;

  if (!source || typeof source !== 'string') {
    res.status(400).json({ error: 'Contract source code is required' });
    return;
  }

  const validLanguages = ['solidity', 'rust', 'vyper', 'javascript'];
  const lang = validLanguages.includes(language as string) ? language : 'solidity';

  const report = await auditService.analyze(source, lang);
  res.status(200).json(report);
}));

contractAuditRouter.get('/history', asyncHandler(async (req: Request, res: Response) => {
  const { minScore, maxScore, language, limit, offset } = req.query;
  const history = auditService.getHistory({
    minScore: minScore ? parseInt(minScore as string) : undefined,
    maxScore: maxScore ? parseInt(maxScore as string) : undefined,
    language: language as any,
    limit: limit ? parseInt(limit as string) : undefined,
    offset: offset ? parseInt(offset as string) : undefined,
  });
  res.status(200).json({ history });
}));

contractAuditRouter.get('/report/:reportId', asyncHandler(async (req: Request, res: Response) => {
  const { reportId } = req.params;
  const report = auditService.getReport(reportId);
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  res.status(200).json(report);
}));

contractAuditRouter.get('/report/:reportId/export', asyncHandler(async (req: Request, res: Response) => {
  const { reportId } = req.params;
  const format = (req.query.format as string) === 'csv' ? 'csv' : 'json';
  const exported = auditService.exportReport(reportId, format);

  if (!exported) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${reportId}.csv"`);
    res.send(exported);
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.send(exported);
  }
}));

contractAuditRouter.delete('/history', asyncHandler(async (_req: Request, res: Response) => {
  auditService.clearHistory();
  res.status(200).json({ ok: true });
}));
