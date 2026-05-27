import { Router } from 'express';
import { z } from 'zod';
import {
  fetchAllowances,
  approveToken,
  revokeAllowance,
  batchRevoke,
  estimateGasForApproval,
  getRecommendedAllowance,
  getApprovalLogs,
  getAllowanceStats,
} from '../../services/allowances.js';

const router = Router();

const fetchQuerySchema = z.object({
  owner: z.string(),
  tokens: z.string().optional(),
  spenders: z.string().optional(),
});

const approvalBodySchema = z.object({
  token: z.string(),
  spender: z.string(),
  amount: z.string(),
  unlimited: z.boolean().optional(),
  expiresAt: z.number().optional(),
});

const revokeBodySchema = z.object({
  token: z.string(),
  spender: z.string(),
});

const batchRevokeBodySchema = z.array(
  z.object({
    token: z.string(),
    spender: z.string(),
  })
);

router.get('/', async (req, res) => {
  try {
    const { owner, tokens, spenders } = fetchQuerySchema.parse(req.query);
    const tokensList = tokens ? tokens.split(',') : undefined;
    const spendersList = spenders ? spenders.split(',') : undefined;

    const allowances = await fetchAllowances(owner, tokensList, spendersList);
    res.json({ success: true, data: allowances });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch allowances';
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/approve', async (req, res) => {
  try {
    const body = approvalBodySchema.parse(req.body);
    const result = await approveToken(
      body.token,
      body.spender,
      body.amount,
      body.unlimited,
      body.expiresAt
    );

    if (result.success) {
      res.json({ success: true, txHash: result.txHash });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Approval failed';
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/revoke', async (req, res) => {
  try {
    const body = revokeBodySchema.parse(req.body);
    const result = await revokeAllowance(body.token, body.spender);

    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Revocation failed';
    res.status(400).json({ success: false, error: message });
  }
});

router.post('/batch-revoke', async (req, res) => {
  try {
    const body = batchRevokeBodySchema.parse(req.body);
    const result = await batchRevoke(body);

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Batch revocation failed';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/gas-estimate', async (req, res) => {
  try {
    const { token, spender, amount, unlimited } = approvalBodySchema.parse(req.query);
    const result = await estimateGasForApproval(token, spender, amount, unlimited);

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gas estimation failed';
    res.status(400).json({ success: false, error: message });
  }
});

router.get('/recommended', (req, res) => {
  const { token, spender, typicalUsage } = req.query;

  if (!token || !spender || !typicalUsage) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: token, spender, typicalUsage',
    });
  }

  const recommended = getRecommendedAllowance(
    token as string,
    spender as string,
    typicalUsage as string
  );

  res.json({ success: true, recommended });
});

router.get('/logs', (req, res) => {
  const { token, spender, limit } = req.query;
  const logs = getApprovalLogs(
    token as string | undefined,
    spender as string | undefined,
    limit ? parseInt(limit as string) : 100
  );

  res.json({ success: true, logs });
});

router.get('/stats', (req, res) => {
  const stats = getAllowanceStats();
  res.json({ success: true, stats });
});

export default router;