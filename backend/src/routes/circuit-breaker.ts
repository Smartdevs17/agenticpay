import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getAllCircuits, getCircuitState, resetCircuit } from '../middleware/circuit-breaker.js';

const router = Router();

router.get('/', asyncHandler(async (_req, res) => {
  const circuits = getAllCircuits();
  res.json({ circuits, count: circuits.length });
}));

router.get('/:name', asyncHandler(async (req, res) => {
  const name = req.params.name as string;
  const state = getCircuitState(name);
  if (!state) {
    res.status(404).json({ error: { code: 'CIRCUIT_NOT_FOUND', message: `Circuit ${name} not found` } });
    return;
  }
  res.json(state);
}));

router.post('/:name/reset', asyncHandler(async (req, res) => {
  const name = req.params.name as string;
  const success = resetCircuit(name);
  if (!success) {
    res.status(404).json({ error: { code: 'CIRCUIT_NOT_FOUND', message: `Circuit ${name} not found` } });
    return;
  }
  res.json({ message: `Circuit ${name} reset to closed state`, name });
}));

export { router as circuitBreakerRouter };
