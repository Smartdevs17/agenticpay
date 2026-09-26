import { Router, Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AuditService, auditService } from '../services/auditService.js';

export const auditRouter = Router();

auditRouter.post('/log', asyncHandler(async (req: Request, res: Response) => {
  const { userId, action, resource, resourceId, details, beforeState, afterState, ipAddress, userAgent, request, response } = req.body;

  if (!action || !resource) {
    res.status(400).json({ error: 'Action and resource are required' });
    return;
  }

  const entry = await auditService.logAction({
    userId,
    action,
    resource,
    resourceId,
    details,
    beforeState,
    afterState,
    ipAddress: ipAddress || req.ip,
    userAgent: userAgent || req.headers['user-agent'],
    request,
    response,
  });

  res.status(201).json(entry);
}));

auditRouter.get('/entries', asyncHandler(async (req: Request, res: Response) => {
  const { userId, action, resource, startDate, endDate, suspicious, limit, offset } = req.query;

  const result = await auditService.queryEntries({
    userId: userId as string,
    action: action as string,
    resource: resource as string,
    startDate: startDate ? Number(startDate) : undefined,
    endDate: endDate ? Number(endDate) : undefined,
    suspicious: suspicious === 'true' ? true : suspicious === 'false' ? false : undefined,
    limit: limit ? Number(limit) : 50,
    offset: offset ? Number(offset) : 0,
  });

  res.status(200).json(result);
}));

auditRouter.get('/entries/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const entry = await auditService.getEntry(id);

  if (!entry) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }

  res.status(200).json(entry);
}));

auditRouter.get('/verify', asyncHandler(async (req: Request, res: Response) => {
  const result = await auditService.verifyIntegrity();
  res.status(200).json(result);
}));

auditRouter.post('/flag/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reasons } = req.body;

  if (!reasons || !Array.isArray(reasons)) {
    res.status(400).json({ error: 'Reasons array is required' });
    return;
  }

  const entry = await auditService.flagSuspicious(id, reasons);

  if (!entry) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }

  res.status(200).json(entry);
}));

auditRouter.get('/export/csv', asyncHandler(async (req: Request, res: Response) => {
  const csv = await auditService.exportToCSV();
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="audit-log-${Date.now()}.csv"`);
  res.status(200).send(csv);
}));

auditRouter.get('/export/json', asyncHandler(async (req: Request, res: Response) => {
  const json = await auditService.exportToJSON();
  
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="audit-log-${Date.now()}.json"`);
  res.status(200).send(json);
}));

auditRouter.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  const stats = await auditService.getRetentionStats();
  res.status(200).json(stats);
}));

auditRouter.get('/count', asyncHandler(async (req: Request, res: Response) => {
  const count = await auditService.getEntryCount();
  res.status(200).json({ count });
}));

auditRouter.get('/retention', asyncHandler(async (req: Request, res: Response) => {
  const stats = await auditService.getRetentionStats();
  res.status(200).json({ policy: { 
    retentionDays: 2555,
    archiveAfterDays: 2190,
    deleteAfterDays: 3650,
  }, stats });
}));

auditRouter.delete('/clear', asyncHandler(async (req: Request, res: Response) => {
  if (req.query.confirm !== 'true') {
    res.status(400).json({ error: 'Add ?confirm=true to confirm deletion of old entries' });
    return;
  }

  const deleted = await auditService.clearOldEntries();
  res.status(200).json({ deleted, message: 'Old entries cleared' });
}));