/**
 * WalletController.ts — Issue #597
 *
 * HTTP layer for wallet aggregation API.
 * Handles request/response only — no business logic here.
 */

import { Request, Response, NextFunction } from 'express';
import { BaseController } from './BaseController.js';
import { WalletAggregationService, ChainType, RoutingStrategy } from '../services/walletAggregation.js';

export class WalletController extends BaseController {
  constructor(private readonly walletService: typeof WalletAggregationService) {
    super();
  }

  getSupportedChains = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(_req, res, next, async (_req, res) => {
      const chains = this.walletService.getSupportedChains();
      res.status(200).json({ success: true, data: chains });
    });
  };

  connectWallet = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      this.validateRequired(req.body, ['userId', 'chainType', 'address', 'providerName']);
      const { userId, chainType, address, providerName } = req.body;
      const connection = this.walletService.connectWallet(
        userId,
        chainType as ChainType,
        address,
        providerName,
      );
      res.status(201).json({ success: true, data: connection });
    });
  };

  disconnectWallet = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const disconnected = this.walletService.disconnectWallet(String(req.params.connectionId));
      if (!disconnected) {
        res.status(404).json({ success: false, error: { message: 'Wallet connection not found' } });
        return;
      }
      res.status(200).json({ success: true, message: 'Wallet disconnected' });
    });
  };

  getUserWallets = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const userId = String(req.query.userId || '');
      if (!userId) {
        res.status(400).json({ success: false, error: { message: 'userId is required' } });
        return;
      }
      const wallets = this.walletService.getUserWallets(userId);
      res.status(200).json({ success: true, data: wallets, count: wallets.length });
    });
  };

  getAggregatedBalance = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const userId = String(req.query.userId || '');
      if (!userId) {
        res.status(400).json({ success: false, error: { message: 'userId is required' } });
        return;
      }
      const balance = await this.walletService.getAggregatedBalance(userId);
      res.status(200).json({ success: true, data: balance });
    });
  };

  getRoutes = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const { source, destination, amount } = req.query;
      if (!source || !destination) {
        res.status(400).json({ success: false, error: { message: 'source and destination are required' } });
        return;
      }
      const routes = this.walletService.getRoutes(
        source as ChainType,
        destination as ChainType,
        String(amount || '0'),
      );
      res.status(200).json({ success: true, data: routes });
    });
  };

  initiateTransfer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      this.validateRequired(req.body, [
        'sourceChain', 'destinationChain', 'sourceAddress', 'destinationAddress', 'assetCode', 'amount',
      ]);
      const tx = await this.walletService.initiateCrossChainTransfer({
        userId: req.body.userId || 'anonymous',
        ...req.body,
        strategy: req.body.strategy as RoutingStrategy | undefined,
      });
      res.status(202).json({ success: true, data: tx });
    });
  };

  getTransaction = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const tx = this.walletService.getTransaction(String(req.params.id));
      if (!tx) {
        res.status(404).json({ success: false, error: { message: 'Transaction not found' } });
        return;
      }
      res.status(200).json({ success: true, data: tx });
    });
  };

  getTransactionHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const userId = String(req.query.userId || '');
      if (!userId) {
        res.status(400).json({ success: false, error: { message: 'userId is required' } });
        return;
      }
      const limit = Math.min(parseInt(String(req.query.limit || '50')), 200);
      const history = this.walletService.getTransactionHistory(userId, limit);
      res.status(200).json({ success: true, data: history, count: history.length });
    });
  };
}
