import { Router } from 'express';
import {
  getAccountInfo,
  getTransactionStatus,
  InvalidStellarInputError,
} from '../services/stellar.js';
import { cacheControl, CacheTTL } from '../middleware/cache.js';

export const stellarRouter = Router();

// Get Stellar account info — balances change frequently; cache for 30 s
stellarRouter.get('/account/:address', cacheControl({ maxAge: CacheTTL.SHORT }), async (req, res) => {
  try {
    const account = await getAccountInfo(req.params.address);
    return res.json(account);
  } catch (error) {
    if (error instanceof InvalidStellarInputError) {
      return res.status(400).json({ message: error.message });
    }

    console.error('Stellar account error:', error);
    return res.status(500).json({ message: 'Failed to fetch account info' });
  }
});

// Get transaction status — confirmed txs are immutable; cache for 10 min
stellarRouter.get('/tx/:hash', cacheControl({ maxAge: CacheTTL.IMMUTABLE }), async (req, res) => {
  try {
    const tx = await getTransactionStatus(req.params.hash);
    return res.json(tx);
  } catch (error) {
    if (error instanceof InvalidStellarInputError) {
      return res.status(400).json({ message: error.message });
    }

    console.error('Stellar tx error:', error);
    return res.status(500).json({ message: 'Failed to fetch transaction' });
  }
});