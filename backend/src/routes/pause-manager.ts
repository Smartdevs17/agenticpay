import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { pauseManagerService } from '../services/contracts/pause-manager.js';
import type { ChainType, PauseStatus } from '../services/contracts/pause-manager.js';

export const pauseManagerRouter = Router();

pauseManagerRouter.post('/request', asyncHandler(async (req: Request, res: Response) => {
  const { chain, contractAddress, pauseImplementation, requestedBy, threshold, timeoutSeconds } = req.body;

  if (!chain || !contractAddress || !pauseImplementation || !requestedBy) {
    res.status(400).json({ error: 'chain, contractAddress, pauseImplementation, and requestedBy are required' });
    return;
  }

  const result = await pauseManagerService.requestPause({
    chain: chain as ChainType,
    contractAddress,
    pauseImplementation,
    requestedBy,
    threshold,
    timeoutSeconds,
  });

  if (!result.ok) {
    res.status(result.error.statusCode).json({ error: result.error });
    return;
  }

  res.status(201).json(result.value);
}));

pauseManagerRouter.post('/:pauseId/approve', asyncHandler(async (req: Request, res: Response) => {
  const { pauseId } = req.params;
  const { guardianAddress } = req.body;

  if (!guardianAddress) {
    res.status(400).json({ error: 'guardianAddress is required' });
    return;
  }

  const result = await pauseManagerService.approvePause({ pauseId, guardianAddress });

  if (!result.ok) {
    res.status(result.error.statusCode).json({ error: result.error });
    return;
  }

  res.status(200).json(result.value);
}));

pauseManagerRouter.post('/:pauseId/resolve', asyncHandler(async (req: Request, res: Response) => {
  const { pauseId } = req.params;
  const { resolvedBy } = req.body;

  if (!resolvedBy) {
    res.status(400).json({ error: 'resolvedBy is required' });
    return;
  }

  const result = await pauseManagerService.resolvePause({ pauseId, resolvedBy });

  if (!result.ok) {
    res.status(result.error.statusCode).json({ error: result.error });
    return;
  }

  res.status(200).json(result.value);
}));

pauseManagerRouter.get('/:pauseId', asyncHandler(async (req: Request, res: Response) => {
  const { pauseId } = req.params;
  const result = pauseManagerService.getPauseRecord(pauseId);

  if (!result.ok) {
    res.status(result.error.statusCode).json({ error: result.error });
    return;
  }

  res.status(200).json(result.value);
}));

pauseManagerRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { status, chain, contractAddress } = req.query;

  const result = pauseManagerService.listPauses({
    status: status as PauseStatus | undefined,
    chain: chain as ChainType | undefined,
    contractAddress: contractAddress as string | undefined,
  });

  if (!result.ok) {
    res.status(result.error.statusCode).json({ error: result.error });
    return;
  }

  res.status(200).json(result.value);
}));

pauseManagerRouter.post('/check-expiry', asyncHandler(async (_req: Request, res: Response) => {
  const expired = await pauseManagerService.checkExpiry();
  res.status(200).json({ expired, count: expired.length });
}));

// ── Guardian Management ────────────────────────────────────────────────

pauseManagerRouter.post('/guardians', asyncHandler(async (req: Request, res: Response) => {
  const { address, chain } = req.body;

  if (!address || !chain) {
    res.status(400).json({ error: 'address and chain are required' });
    return;
  }

  const result = pauseManagerService.addGuardian(address, chain as ChainType);

  if (!result.ok) {
    res.status(result.error.statusCode).json({ error: result.error });
    return;
  }

  res.status(201).json(result.value);
}));

pauseManagerRouter.delete('/guardians/:address', asyncHandler(async (req: Request, res: Response) => {
  const { address } = req.params;
  const result = pauseManagerService.removeGuardian(address);

  if (!result.ok) {
    res.status(result.error.statusCode).json({ error: result.error });
    return;
  }

  res.status(200).json({ message: 'Guardian deactivated' });
}));

pauseManagerRouter.get('/guardians/list', asyncHandler(async (_req: Request, res: Response) => {
  const guardians = pauseManagerService.listGuardians();
  res.status(200).json({ guardians });
}));
