/**
 * 3DS Authentication Routes
 *
 * Exposes RESTful endpoints for the 3D Secure card-payment authentication flow.
 *
 *   POST   /api/v1/3ds/initiate        Initiate a 3DS session for a payment intent
 *   POST   /api/v1/3ds/verify          Verify the outcome of a 3DS challenge
 *   GET    /api/v1/3ds/status/:id      Get the current state of a 3DS session
 *   POST   /api/v1/3ds/cancel          Cancel an active 3DS session
 */

import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  initiate3DSSchema,
  verify3DSSchema,
  cancel3DSSchema,
  get3DSStatusSchema,
} from '../schemas/3ds.js';
import {
  initiate3DS,
  verify3DS,
  get3DSSession,
  cancel3DSSession,
} from '../services/3ds.js';

export const threeDSRouter = Router();

/**
 * POST /api/v1/3ds/initiate
 *
 * Begin a 3DS authentication session.  The caller provides the payment intent
 * together with card-identification data (full PAN, token, or BIN).
 *
 * Response contains the ACS redirect URL / encoded challenge request so the
 * caller can present the cardholder with the issuer challenge.
 */
threeDSRouter.post(
  '/initiate',
  validate(initiate3DSSchema),
  asyncHandler(async (req, res) => {
    const result = initiate3DS(req.body);
    const statusCode = result.status === 'error' ? 500 : 201;
    res.status(statusCode).json({ data: result });
  }),
);

/**
 * POST /api/v1/3ds/verify
 *
 * Complete the 3DS flow by submitting the challenge result.
 * For 3DS 1.x supply the PARes; for 3DS 2.x supply the transStatus value.
 *
 * On success the response contains the ECI value and Authentication Value
 * (CAVV/AAV) that must be forwarded to the authorisation request.
 */
threeDSRouter.post(
  '/verify',
  validate(verify3DSSchema),
  asyncHandler(async (req, res) => {
    const result = verify3DS(req.body);

    if (result.status === 'error') {
      throw new AppError(404, result.message ?? '3DS session not found', '3DS_SESSION_NOT_FOUND');
    }

    if (result.status === 'failed') {
      // Return 200 with failed status so callers can distinguish between
      // "request error" and "cardholder declined authentication"
      res.status(200).json({ data: result });
      return;
    }

    res.status(200).json({ data: result });
  }),
);

/**
 * GET /api/v1/3ds/status/:id
 *
 * Poll the current state of a 3DS session.  Useful for async challenge windows
 * where the front-end needs to wait for the issuer ACS postback.
 */
threeDSRouter.get(
  '/status/:id',
  asyncHandler(async (req, res) => {
    // Validate the id param manually (lightweight, no body schema needed)
    const parsed = get3DSStatusSchema.safeParse({ sessionId: req.params.id });
    if (!parsed.success) {
      throw new AppError(400, 'Invalid session ID', 'VALIDATION_ERROR', parsed.error.errors);
    }

    const session = get3DSSession(parsed.data.sessionId);
    if (!session) {
      throw new AppError(404, 'Session not found', '3DS_SESSION_NOT_FOUND');
    }

    res.status(200).json({
      data: {
        threeDSSessionId: session.sessionId,
        paymentIntentId: session.paymentIntentId,
        status: session.status,
        version: session.version,
        enrolled: session.enrolled,
        eci: session.eci,
        authenticationValue: session.authenticationValue,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      },
    });
  }),
);

/**
 * POST /api/v1/3ds/cancel
 *
 * Cancel an active 3DS session (e.g. the cardholder abandons the challenge).
 */
threeDSRouter.post(
  '/cancel',
  validate(cancel3DSSchema),
  asyncHandler(async (req, res) => {
    const { threeDSSessionId, reason } = req.body;
    const result = cancel3DSSession(threeDSSessionId, reason);

    if (!result.success) {
      throw new AppError(404, result.message, '3DS_SESSION_NOT_FOUND');
    }

    res.status(200).json({ data: result });
  }),
);
