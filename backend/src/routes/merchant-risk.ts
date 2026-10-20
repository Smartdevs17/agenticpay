import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  assessMerchant,
  reassessMerchant,
  getAssessment,
  listAssessments,
  getPolicyForTier,
  evaluateTransactionLimit,
  RiskTier,
} from '../services/merchant-risk-tiering.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validateRequest } from '../middleware/validate.js';

export const merchantRiskRouter = Router();

const riskSignalsSchema = z.object({
  businessAgeMonths: z.number().nonnegative(),
  monthlyVolumeUsd: z.number().nonnegative(),
  chargebacks90d: z.number().nonnegative(),
  refundRatePct: z.number().min(0).max(100),
  sanctionsHits: z.number().nonnegative(),
  kycVerified: z.boolean(),
  kybVerified: z.boolean(),
  jurisdictionRisk: z.number().min(0).max(1).optional(),
});

const merchantParamsSchema = z.object({
  merchantId: z.string().min(1),
});

const listQuerySchema = z.object({
  tier: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

const tierParamsSchema = z.object({
  tier: z.enum(['low', 'medium', 'high', 'critical']),
});

const limitCheckSchema = z.object({
  amountUsd: z.number().positive(),
});

const assessValidation = validateRequest({
  params: merchantParamsSchema,
  body: riskSignalsSchema,
});

const merchantValidation = validateRequest({ params: merchantParamsSchema });

/**
 * @route   POST /api/v1/merchant-risk/:merchantId/assess
 * @desc    Run (or re-run) a risk assessment and assign a risk tier
 */
merchantRiskRouter.post(
  '/:merchantId/assess',
  assessValidation,
  asyncHandler(async (req: Request, res: Response) => {
    const { merchantId } = req.params;
    const assessment = assessMerchant(merchantId, req.body);
    res.status(201).json({ success: true, data: assessment });
  }),
);

/**
 * @route   POST /api/v1/merchant-risk/:merchantId/reassess
 * @desc    Periodic re-scoring of an existing merchant
 */
merchantRiskRouter.post(
  '/:merchantId/reassess',
  assessValidation,
  asyncHandler(async (req: Request, res: Response) => {
    const { merchantId } = req.params;
    const assessment = reassessMerchant(merchantId, req.body);
    res.json({ success: true, data: assessment });
  }),
);

/**
 * @route   GET /api/v1/merchant-risk/policies
 * @desc    List all tier policies
 */
merchantRiskRouter.get('/policies', (_req: Request, res: Response) => {
  const tiers: RiskTier[] = ['low', 'medium', 'high', 'critical'];
  res.json({
    success: true,
    data: tiers.map((tier) => getPolicyForTier(tier)),
  });
});

/**
 * @route   GET /api/v1/merchant-risk/policies/:tier
 * @desc    Retrieve a single tier policy
 */
merchantRiskRouter.get(
  '/policies/:tier',
  validateRequest({ params: tierParamsSchema }),
  (req: Request, res: Response) => {
    res.json({ success: true, data: getPolicyForTier(req.params.tier as RiskTier) });
  },
);

/**
 * @route   GET /api/v1/merchant-risk
 * @desc    List merchant assessments, optionally filtered by tier
 */
merchantRiskRouter.get(
  '/',
  validateRequest({ query: listQuerySchema }),
  (req: Request, res: Response) => {
    const tier = req.query.tier as RiskTier | undefined;
    const data = listAssessments(tier);
    res.json({ success: true, data, count: data.length });
  },
);

/**
 * @route   GET /api/v1/merchant-risk/:merchantId
 * @desc    Retrieve a merchant's current risk assessment
 */
merchantRiskRouter.get(
  '/:merchantId',
  merchantValidation,
  (req: Request, res: Response) => {
    const assessment = getAssessment(req.params.merchantId);
    if (!assessment) {
      throw new AppError(404, 'Merchant risk assessment not found', 'RISK_ASSESSMENT_NOT_FOUND');
    }
    res.json({ success: true, data: assessment });
  },
);

/**
 * @route   POST /api/v1/merchant-risk/:merchantId/evaluate
 * @desc    Check whether a proposed transaction is within tier limits
 */
merchantRiskRouter.post(
  '/:merchantId/evaluate',
  validateRequest({ params: merchantParamsSchema, body: limitCheckSchema }),
  (req: Request, res: Response) => {
    const result = evaluateTransactionLimit(req.params.merchantId, req.body.amountUsd);
    if (!result.allowed && result.reason === 'merchant_not_assessed') {
      throw new AppError(404, 'Merchant risk assessment not found', 'RISK_ASSESSMENT_NOT_FOUND');
    }
    res.json({ success: true, data: result });
  },
);
