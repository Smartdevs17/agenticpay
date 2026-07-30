/**
 * wallet.ts (routes) — Issue #593
 *
 * Cross-chain wallet abstraction API:
 * - GET  /wallet/chains              → supported chains
 * - POST /wallet/connect             → register wallet connection
 * - DELETE /wallet/:connectionId     → disconnect wallet
 * - GET  /wallet/connections         → list user's wallets
 * - GET  /wallet/aggregated          → aggregated balance across chains
 * - GET  /wallet/routes              → optimal transfer routes
 * - POST /wallet/transfer            → initiate cross-chain transfer
 * - GET  /wallet/transfer/:id        → get transfer status
 * - GET  /wallet/history             → transaction history
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { WalletAggregationService, ChainType, RoutingStrategy } from '../services/walletAggregation.js';

export const walletRouter = Router();

// ─── Supported chains ─────────────────────────────────────────────────────────

walletRouter.get(
  '/chains',
  asyncHandler(async (_req: Request, res: Response) => {
    const chains = WalletAggregationService.getSupportedChains();
    res.status(200).json({ success: true, data: chains });
  }),
);

// ─── Wallet connections ───────────────────────────────────────────────────────

walletRouter.post(
  '/connect',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, chainType, address, providerName } = req.body;
    if (!userId || !chainType || !address || !providerName) {
      return res.status(400).json({
        success: false,
        error: { message: 'userId, chainType, address, and providerName are required' },
      });
    }

    const connection = WalletAggregationService.connectWallet(
      userId,
      chainType as ChainType,
      address,
      providerName,
    );

    res.status(201).json({ success: true, data: connection });
  }),
);

walletRouter.delete(
  '/:connectionId',
  asyncHandler(async (req: Request, res: Response) => {
    const { connectionId } = req.params;
    const disconnected = WalletAggregationService.disconnectWallet(connectionId);

    if (!disconnected) {
      return res.status(404).json({ success: false, error: { message: 'Wallet connection not found' } });
    }

    res.status(200).json({ success: true, message: 'Wallet disconnected' });
  }),
);

walletRouter.get(
  '/connections',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.query.userId || '');
    if (!userId) {
      return res.status(400).json({ success: false, error: { message: 'userId is required' } });
    }

    const wallets = WalletAggregationService.getUserWallets(userId);
    res.status(200).json({ success: true, data: wallets, count: wallets.length });
  }),
);

// ─── Aggregated balance ───────────────────────────────────────────────────────

walletRouter.get(
  '/aggregated',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.query.userId || '');
    if (!userId) {
      return res.status(400).json({ success: false, error: { message: 'userId is required' } });
    }

    const balance = await WalletAggregationService.getAggregatedBalance(userId);
    res.status(200).json({ success: true, data: balance });
  }),
);

// ─── Routing ──────────────────────────────────────────────────────────────────

walletRouter.get(
  '/routes',
  asyncHandler(async (req: Request, res: Response) => {
    const { source, destination, amount } = req.query;

    if (!source || !destination) {
      return res.status(400).json({ success: false, error: { message: 'source and destination chains are required' } });
    }

    const routes = WalletAggregationService.getRoutes(
      source as ChainType,
      destination as ChainType,
      String(amount || '0'),
    );

    res.status(200).json({ success: true, data: routes });
  }),
);

// ─── Cross-chain transfer ─────────────────────────────────────────────────────

walletRouter.post(
  '/transfer',
  asyncHandler(async (req: Request, res: Response) => {
    const {
      userId,
      sourceChain,
      destinationChain,
      sourceAddress,
      destinationAddress,
      assetCode,
      amount,
      feePayCurrency,
      strategy,
    } = req.body;

    if (!sourceChain || !destinationChain || !sourceAddress || !destinationAddress || !assetCode || !amount) {
      return res.status(400).json({
        success: false,
        error: { message: 'sourceChain, destinationChain, sourceAddress, destinationAddress, assetCode, and amount are required' },
      });
    }

    const tx = await WalletAggregationService.initiateCrossChainTransfer({
      userId: userId || 'anonymous',
      sourceChain: sourceChain as ChainType,
      destinationChain: destinationChain as ChainType,
      sourceAddress,
      destinationAddress,
      assetCode,
      amount: String(amount),
      feePayCurrency,
      strategy: strategy as RoutingStrategy | undefined,
    });

    res.status(202).json({ success: true, data: tx });
  }),
);

walletRouter.get(
  '/transfer/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const tx = WalletAggregationService.getTransaction(req.params.id);
    if (!tx) {
      return res.status(404).json({ success: false, error: { message: 'Transaction not found' } });
    }
    res.status(200).json({ success: true, data: tx });
  }),
);

// ─── Transaction history ──────────────────────────────────────────────────────

walletRouter.get(
  '/history',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.query.userId || '');
    const limit = Math.min(parseInt(String(req.query.limit || '50')), 200);

    if (!userId) {
      return res.status(400).json({ success: false, error: { message: 'userId is required' } });
    }

    const history = WalletAggregationService.getTransactionHistory(userId, limit);
    res.status(200).json({ success: true, data: history, count: history.length });
  }),
);
