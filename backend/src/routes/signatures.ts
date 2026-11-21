import { Router } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { signatureChallengeSchema, signatureVerifySchema } from '../schemas/index.js';
import { createSignatureChallenge, verifySignatureIntent } from '../services/signature-verification.js';

export const signaturesRouter = Router();

signaturesRouter.post(
  '/challenge',
  validate(signatureChallengeSchema),
  asyncHandler(async (req, res) => {
    try {
      const challenge = await createSignatureChallenge(req.body);
      res.json(challenge);
    } catch (error) {
      throw new AppError(400, (error as Error).message, 'SIGNATURE_CHALLENGE_ERROR');
    }
  })
);

signaturesRouter.post(
  '/verify',
  validate(signatureVerifySchema),
  asyncHandler(async (req, res) => {
    try {
      const result = await verifySignatureIntent(req.body);
      res.json(result);
    } catch (error) {
      throw new AppError(400, (error as Error).message, 'SIGNATURE_VERIFY_ERROR');
    }
  })
);
