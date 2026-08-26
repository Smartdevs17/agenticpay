import { Router, Request, Response } from 'express';
import { RateAggregator } from '../../services/rates/aggregator';

const router = Router();
const aggregator = new RateAggregator();

router.get('/', async (req: Request, res: Response) => {
  try {
    const { base, target, isFiat } = req.query;

    if (!base || !target) {
      return res.status(400).json({ error: 'base and target query parameters are required' });
    }

    const rate = await aggregator.getAggregatedRate(
      base as string,
      target as string,
      isFiat === 'true'
    );

    res.json({
      base,
      target,
      rate,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
