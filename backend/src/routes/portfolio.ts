import { Router } from 'express';
import { portfolioService } from '../services/portfolio/index.js';
import { cacheControl, CacheTTL } from '../middleware/cache.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const portfolioRouter = Router();

portfolioRouter.get(
  '/:walletAddress',
  cacheControl({ maxAge: 30, staleWhileRevalidate: 60 }),
  asyncHandler(async (req, res) => {
    const { walletAddress } = req.params;
    const chains = (req.query.chains as string)?.split(',') || ['stellar', 'ethereum'];

    const portfolio = await portfolioService.getPortfolio(walletAddress, chains);
    res.json(portfolio);
  })
);

portfolioRouter.get(
  '/:walletAddress/export',
  asyncHandler(async (req, res) => {
    const { walletAddress } = req.params;
    const portfolio = await portfolioService.getPortfolio(walletAddress);
    const csv = portfolioService.exportToCsv(portfolio);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="portfolio-${walletAddress}.csv"`);
    res.send(csv);
  })
);