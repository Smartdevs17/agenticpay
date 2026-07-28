import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  generateContract,
  amendContract,
  getContract,
  listContracts,
  searchContracts,
  getContractDiff,
  type GenerateContractInput,
  type AmendmentInput,
} from '../services/contracts.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const contractsRouter = Router();

const generateSchema = z.object({
  projectId: z.string().min(1),
  type: z.enum(['service', 'milestone', 'nda', 'custom']),
  clientId: z.string().min(1),
  freelancerId: z.string().min(1),
  projectConfig: z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    budget: z.number().positive(),
    currency: z.string().min(1),
    milestones: z.array(
      z.object({
        title: z.string().min(1),
        amount: z.number().positive(),
        dueDate: z.string(),
      }),
    ),
    paymentTerms: z.string().min(1),
    startDate: z.string(),
    endDate: z.string().optional(),
  }),
  createdBy: z.string().min(1),
});

const amendSchema = z.object({
  contractId: z.string().min(1),
  changeDescription: z.string().min(1),
  newClauses: z
    .array(
      z.object({
        title: z.string().min(1),
        body: z.string().min(1),
        isRequired: z.boolean().optional(),
      }),
    )
    .optional(),
  removedClauseIds: z.array(z.string().min(1)).optional(),
  createdBy: z.string().min(1),
});

contractsRouter.post('/generate', asyncHandler(async (req: Request, res: Response) => {
  const input = generateSchema.parse(req.body) as GenerateContractInput;
  const contract = generateContract(input);
  res.status(201).json(contract);
}));

contractsRouter.post('/amend', asyncHandler(async (req: Request, res: Response) => {
  const input = amendSchema.parse(req.body) as AmendmentInput;
  const contract = amendContract(input);
  res.json(contract);
}));

contractsRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { projectId, status, type } = req.query as Record<string, string | undefined>;
  const results = searchContracts({ projectId, status, type });
  res.json({ contracts: results, total: results.length });
}));

contractsRouter.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const contract = getContract(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  res.json(contract);
}));

contractsRouter.get('/:id/diff', asyncHandler(async (req: Request, res: Response) => {
  const from = Number(req.query.from);
  const to = Number(req.query.to);
  if (!from || !to) return res.status(400).json({ error: 'from and to query params are required' });
  const diff = getContractDiff(from, to, req.params.id);
  res.json(diff);
}));
