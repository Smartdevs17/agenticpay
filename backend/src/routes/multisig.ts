import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { multisigService } from '../services/multisig.js';
import {
  createMultisigGroupSchema,
  createMultisigPaymentSchema,
  approveMultisigPaymentSchema,
} from '../schemas/index.js';

export const multisigRouter = Router();

multisigRouter.post(
  '/groups',
  validate(createMultisigGroupSchema),
  asyncHandler(async (req, res) => {
    const { name, walletAddresses, threshold, mode } = req.body;
    const group = multisigService.createGroup({ name, walletAddresses, threshold, mode });
    res.status(201).json(group);
  })
);

multisigRouter.get(
  '/groups',
  asyncHandler(async (req, res) => {
    res.json(multisigService.listGroups());
  })
);

multisigRouter.get(
  '/groups/:groupId',
  asyncHandler(async (req, res) => {
    const groupId = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
    const group = multisigService.getGroup(groupId);
    if (!group) {
      throw new AppError(404, 'Multisig group not found', 'NOT_FOUND');
    }
    res.json(group);
  })
);

multisigRouter.post(
  '/payments',
  validate(createMultisigPaymentSchema),
  asyncHandler(async (req, res) => {
    const { groupId, amount, currency, description, mode, metadata } = req.body;
    const payment = multisigService.createPayment({ groupId, amount, currency, description, mode, metadata });
    if (!payment) {
      throw new AppError(404, 'Multisig group not found', 'NOT_FOUND');
    }
    res.status(201).json(payment);
  })
);

multisigRouter.get(
  '/payments',
  asyncHandler(async (req, res) => {
    res.json(multisigService.listPayments());
  })
);

multisigRouter.get(
  '/payments/:paymentId',
  asyncHandler(async (req, res) => {
    const paymentId = Array.isArray(req.params.paymentId) ? req.params.paymentId[0] : req.params.paymentId;
    const payment = multisigService.getPayment(paymentId);
    if (!payment) {
      throw new AppError(404, 'Multisig payment not found', 'NOT_FOUND');
    }
    res.json(payment);
  })
);

multisigRouter.post(
  '/payments/:paymentId/approve',
  validate(approveMultisigPaymentSchema),
  asyncHandler(async (req, res) => {
    const paymentId = Array.isArray(req.params.paymentId) ? req.params.paymentId[0] : req.params.paymentId;
    const { signer, signature } = req.body;
    const payment = multisigService.approvePayment(paymentId, signer, signature);
    if (!payment) {
      throw new AppError(404, 'Multisig payment not found or signer invalid', 'NOT_FOUND');
    }
    res.json(payment);
  })
);
