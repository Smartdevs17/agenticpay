import { Router } from 'express';
import {
  getAccountInfo,
  getTransactionStatus,
  isValidStellarAddress,
  isValidTransactionHash,
} from '../services/stellar.js';

export const stellarRouter = Router();

// Get Stellar account info
stellarRouter.get('/account/:address', async (req, res) => {
  if (!isValidStellarAddress(req.params.address)) {
    return res.status(400).json({ message: 'Invalid Stellar address' });
  }

  try {
    const account = await getAccountInfo(req.params.address);
    res.json(account);
  } catch (error) {
    console.error('Stellar account error:', error);
    res.status(500).json({ message: 'Failed to fetch account info' });
  }
});

// Get transaction status
stellarRouter.get('/tx/:hash', async (req, res) => {
  if (!isValidTransactionHash(req.params.hash)) {
    return res.status(400).json({ message: 'Invalid transaction hash' });
  }

  try {
    const tx = await getTransactionStatus(req.params.hash);
    res.json(tx);
  } catch (error) {
    console.error('Stellar tx error:', error);
    res.status(500).json({ message: 'Failed to fetch transaction' });
  }
});
