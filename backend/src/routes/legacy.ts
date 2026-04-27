import { Router, Request, Response } from 'express';
import { deprecationMiddleware } from '../middleware/deprecation.js';

export const legacyRouter = Router();

/**
 * @openapi
 * /api/v1/legacy-data:
 *   get:
 *     summary: Get legacy data (Deprecated)
 *     responses:
 *       200:
 *         description: Returns legacy data with deprecation headers
 */
legacyRouter.get(
    '/legacy-data',
    deprecationMiddleware({
        deprecationDate: '2023-10-01',
        sunsetDate: '2024-12-31',
        alternativeUrl: 'https://agenticpay.io/docs/api/v2/data'
    }),
    (req: Request, res: Response) => {
        res.json({
            message: 'This is legacy data. Please migrate to the new API.',
            data: [1, 2, 3, 4, 5]
        });
    }
);
