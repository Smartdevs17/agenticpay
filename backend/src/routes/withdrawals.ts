/**
 * Withdrawal allowlist routes — Issue #519
 *
 * Withdrawals to non-allowlisted addresses require multi-signature approval.
 * Velocity checks (daily/hourly amount + count caps) apply to every request
 * regardless of destination.
 */

import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  configureWalletWithdrawalSchema,
  addWithdrawalAllowlistEntrySchema,
  createWithdrawalRequestSchema,
  approveWithdrawalRequestSchema,
  rejectWithdrawalRequestSchema,
} from '../schemas/index.js';
import {
  configureWallet,
  getWalletConfig,
  addToAllowlist,
  removeFromAllowlist,
  createWithdrawalRequest,
  getWithdrawalRequest,
  listWithdrawalRequests,
  approveWithdrawal,
  rejectWithdrawal,
  markExecuted,
  WithdrawalApprovalError,
} from '../services/withdrawal-allowlist.js';

export const withdrawalsRouter = Router();

// ---------------------------------------------------------------------------
// Wallet configuration & allowlist management
// ---------------------------------------------------------------------------

withdrawalsRouter.get(
  '/:walletId/config',
  asyncHandler(async (req, res) => {
    res.json(getWalletConfig(req.params.walletId));
  })
);

withdrawalsRouter.patch(
  '/:walletId/config',
  validate(configureWalletWithdrawalSchema),
  asyncHandler(async (req, res) => {
    const config = configureWallet(req.params.walletId, req.body);
    res.json(config);
  })
);

withdrawalsRouter.post(
  '/:walletId/allowlist',
  validate(addWithdrawalAllowlistEntrySchema),
  asyncHandler(async (req, res) => {
    const { address, label, addedBy } = req.body;
    const entry = addToAllowlist(req.params.walletId, address, addedBy, label);
    res.status(201).json(entry);
  })
);

withdrawalsRouter.delete(
  '/:walletId/allowlist/:address',
  asyncHandler(async (req, res) => {
    const removed = removeFromAllowlist(req.params.walletId, req.params.address);
    if (!removed) throw new AppError(404, 'Allowlist entry not found', 'NOT_FOUND');
    res.status(204).send();
  })
);

withdrawalsRouter.get(
  '/:walletId/allowlist',
  asyncHandler(async (req, res) => {
    res.json(getWalletConfig(req.params.walletId).allowlist);
  })
);

// ---------------------------------------------------------------------------
// Withdrawal request lifecycle
// ---------------------------------------------------------------------------

withdrawalsRouter.post(
  '/:walletId/requests',
  validate(createWithdrawalRequestSchema),
  asyncHandler(async (req, res) => {
    const { toAddress, amount, currency, requestedBy } = req.body;
    const request = createWithdrawalRequest({ walletId: req.params.walletId, toAddress, amount, currency, requestedBy });

    if (request.status === 'blocked_velocity') {
      throw new AppError(429, request.blockReason ?? 'Velocity limit exceeded', 'VELOCITY_LIMIT_EXCEEDED', request);
    }

    res.status(201).json(request);
  })
);

withdrawalsRouter.get(
  '/:walletId/requests',
  asyncHandler(async (req, res) => {
    res.json(listWithdrawalRequests(req.params.walletId));
  })
);

withdrawalsRouter.get(
  '/requests/:requestId',
  asyncHandler(async (req, res) => {
    const request = getWithdrawalRequest(req.params.requestId);
    if (!request) throw new AppError(404, 'Withdrawal request not found', 'NOT_FOUND');
    res.json(request);
  })
);

withdrawalsRouter.post(
  '/requests/:requestId/approve',
  validate(approveWithdrawalRequestSchema),
  asyncHandler(async (req, res) => {
    try {
      const request = approveWithdrawal(req.params.requestId, req.body.approver);
      res.json(request);
    } catch (err) {
      if (err instanceof WithdrawalApprovalError) throw new AppError(400, err.message, 'APPROVAL_FAILED');
      throw err;
    }
  })
);

withdrawalsRouter.post(
  '/requests/:requestId/reject',
  validate(rejectWithdrawalRequestSchema),
  asyncHandler(async (req, res) => {
    try {
      const request = rejectWithdrawal(req.params.requestId, req.body.approver);
      res.json(request);
    } catch (err) {
      if (err instanceof WithdrawalApprovalError) throw new AppError(400, err.message, 'REJECTION_FAILED');
      throw err;
    }
  })
);

withdrawalsRouter.post(
  '/requests/:requestId/execute',
  asyncHandler(async (req, res) => {
    const { txHash } = req.body as { txHash?: string };
    if (!txHash) throw new AppError(400, 'txHash is required', 'VALIDATION_ERROR');

    try {
      const request = markExecuted(req.params.requestId, txHash);
      res.json(request);
    } catch (err) {
      if (err instanceof WithdrawalApprovalError) throw new AppError(400, err.message, 'EXECUTION_FAILED');
      throw err;
    }
  })
);
