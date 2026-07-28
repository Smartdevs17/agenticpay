import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { backupService } from '../services/backup.js';

export const backupRouter = Router();

// Create a full backup
backupRouter.post('/full', asyncHandler(async (_req: Request, res: Response) => {
  const backup = await backupService.createFullBackup();
  res.status(201).json(backup);
}));

// Create an incremental backup
backupRouter.post('/incremental/:fullBackupId', asyncHandler(async (req: Request, res: Response) => {
  const backup = await backupService.createIncrementalBackup(req.params.fullBackupId);
  res.status(201).json(backup);
}));

// List all backups
backupRouter.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const backups = backupService.getAllBackups();
  res.json({ backups });
}));

// Get a specific backup
backupRouter.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const backup = backupService.getBackup(req.params.id);
  if (!backup) {
    res.status(404).json({ error: 'Backup not found' });
    return;
  }
  res.json(backup);
}));

// Verify a backup
backupRouter.post('/:id/verify', asyncHandler(async (req: Request, res: Response) => {
  const valid = await backupService.verifyBackup(req.params.id);
  res.json({ id: req.params.id, valid });
}));

// Restore from a restore point
backupRouter.post('/restore/:restorePointId', asyncHandler(async (req: Request, res: Response) => {
  const { targetDbUrl } = req.body;
  try {
    const success = await backupService.restore(req.params.restorePointId, targetDbUrl);
    res.json({ success, restorePointId: req.params.restorePointId });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Restore failed',
    });
  }
}));

// List restore points
backupRouter.get('/restore-points', asyncHandler(async (_req: Request, res: Response) => {
  const points = backupService.getRestorePoints();
  res.json({ restorePoints: points });
}));