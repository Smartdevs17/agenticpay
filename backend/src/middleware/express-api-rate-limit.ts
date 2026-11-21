import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 100;

/**
 * Fixed-window rate limiter for all /api routes (Issue #8).
 * Returns 429 with standard RateLimit-* headers when exceeded.
 */
export const apiExpressRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => req.method === 'OPTIONS',
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Too many requests. Limit is ${MAX_REQUESTS} per ${WINDOW_MS / 60_000} minutes.`,
        status: 429,
      },
    });
  },
});

export const API_RATE_LIMIT_WINDOW_MS = WINDOW_MS;
export const API_RATE_LIMIT_MAX = MAX_REQUESTS;
