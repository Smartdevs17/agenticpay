import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { multisigService } from '../services/multisig.js';
import {
  createMultisigGroupSchema,
  updateMultisigGroupSchema,
  createMultisigPaymentSchema,
  approveMultisigPaymentSchema,
  rejectMultisigPaymentSchema,
  addSignerSchema,
  removeSignerSchema,
  changeThresholdSchema,
} from '../schemas/index.js';

export const multisigRouter = Router();

// ---------------------------------------------------------------------------
// Wallet groups
// ---------------------------------------------------------------------------

multisigRouter.post(
  '/groups',
  validate(createMultisigGroupSchema),
  asyncHandler(async (req, res) => {
    const { name, walletAddresses, threshold, mode, timeoutSeconds } = req.body;
    const group = multisigService.createGroup({ name, walletAddresses, threshold, mode, timeoutSeconds });
    res.status(201).json(group);
  })
);

multisigRouter.get(
  '/groups',
  asyncHandler(async (_req, res) => {
    res.json(multisigService.listGroups());
  })
);

multisigRouter.get(
  '/groups/:groupId',
  asyncHandler(async (req, res) => {
    const groupId = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
    const group = multisigService.getGroup(groupId);
    if (!group) throw new AppError(404, 'Multisig group not found', 'NOT_FOUND');
    res.json(group);
  })
);

multisigRouter.patch(
  '/groups/:groupId',
  validate(updateMultisigGroupSchema),
  asyncHandler(async (req, res) => {
    const groupId = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
    const { name, timeoutSeconds } = req.body;
    const group = multisigService.updateGroup(groupId, { name, timeoutSeconds });
    if (!group) throw new AppError(404, 'Multisig group not found', 'NOT_FOUND');
    res.json(group);
  })
);

// ---------------------------------------------------------------------------
// Signer management
// ---------------------------------------------------------------------------

multisigRouter.post(
  '/groups/:groupId/signers/add',
  validate(addSignerSchema),
  asyncHandler(async (req, res) => {
    const groupId = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
    const { newSigner, proposerSigner, proposerSignature } = req.body;
    const group = multisigService.getGroup(groupId);
    if (!group) throw new AppError(404, 'Multisig group not found', 'NOT_FOUND');

    const result = multisigService.proposeSigner(groupId, 'add_signer', proposerSigner, proposerSignature, {
      targetSigner: newSigner,
      timeoutSeconds: group.timeoutSeconds,
    });

    if ('error' in result) throw new AppError(400, result.error, 'INVALID_REQUEST');
    res.status(201).json(result);
  })
);

multisigRouter.post(
  '/groups/:groupId/signers/remove',
  validate(removeSignerSchema),
  asyncHandler(async (req, res) => {
    const groupId = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
    const { signerToRemove, proposerSigner, proposerSignature, newThreshold } = req.body;
    const group = multisigService.getGroup(groupId);
    if (!group) throw new AppError(404, 'Multisig group not found', 'NOT_FOUND');

    const result = multisigService.proposeSigner(groupId, 'remove_signer', proposerSigner, proposerSignature, {
      targetSigner: signerToRemove,
      newThreshold,
      timeoutSeconds: group.timeoutSeconds,
    });

    if ('error' in result) throw new AppError(400, result.error, 'INVALID_REQUEST');
    res.status(201).json(result);
  })
);

multisigRouter.post(
  '/groups/:groupId/threshold',
  validate(changeThresholdSchema),
  asyncHandler(async (req, res) => {
    const groupId = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
    const { newThreshold, proposerSigner, proposerSignature } = req.body;
    const group = multisigService.getGroup(groupId);
    if (!group) throw new AppError(404, 'Multisig group not found', 'NOT_FOUND');

    const result = multisigService.proposeSigner(groupId, 'change_threshold', proposerSigner, proposerSignature, {
      newThreshold,
      timeoutSeconds: group.timeoutSeconds,
    });

    if ('error' in result) throw new AppError(400, result.error, 'INVALID_REQUEST');
    res.status(201).json(result);
  })
);

multisigRouter.get(
  '/groups/:groupId/signer-proposals',
  asyncHandler(async (req, res) => {
    const groupId = Array.isArray(req.params.groupId) ? req.params.groupId[0] : req.params.groupId;
    res.json(multisigService.listSignerChangeProposals(groupId));
  })
);

multisigRouter.post(
  '/signer-proposals/:proposalId/approve',
  validate(approveMultisigPaymentSchema),
  asyncHandler(async (req, res) => {
    const proposalId = Array.isArray(req.params.proposalId) ? req.params.proposalId[0] : req.params.proposalId;
    const { signer, signature } = req.body;
    const result = multisigService.approveSignerProposal(proposalId, signer, signature);
    if ('error' in result) throw new AppError(400, result.error, 'INVALID_REQUEST');
    res.json(result);
  })
);

// ---------------------------------------------------------------------------
// Transaction proposals
// ---------------------------------------------------------------------------

multisigRouter.post(
  '/proposals',
  validate(createMultisigPaymentSchema),
  asyncHandler(async (req, res) => {
    const { groupId, amount, currency, description, recipient, mode, metadata, timeoutSeconds } = req.body;
    const proposal = multisigService.createProposal({
      groupId, amount, currency, description, recipient, mode, metadata, timeoutSeconds,
    });
    if (!proposal) throw new AppError(404, 'Multisig group not found', 'NOT_FOUND');
    res.status(201).json(proposal);
  })
);

multisigRouter.get(
  '/proposals',
  asyncHandler(async (req, res) => {
    const groupId = req.query.groupId as string | undefined;
    const status = req.query.status as string | undefined;
    res.json(multisigService.listProposals(groupId, status as any));
  })
);

multisigRouter.get(
  '/proposals/:proposalId',
  asyncHandler(async (req, res) => {
    const proposalId = Array.isArray(req.params.proposalId) ? req.params.proposalId[0] : req.params.proposalId;
    const proposal = multisigService.getProposal(proposalId);
    if (!proposal) throw new AppError(404, 'Multisig proposal not found', 'NOT_FOUND');
    res.json(proposal);
  })
);

multisigRouter.post(
  '/proposals/:proposalId/approve',
  validate(approveMultisigPaymentSchema),
  asyncHandler(async (req, res) => {
    const proposalId = Array.isArray(req.params.proposalId) ? req.params.proposalId[0] : req.params.proposalId;
    const { signer, signature } = req.body;
    const proposal = multisigService.approveProposal(proposalId, signer, signature);
    if (!proposal) throw new AppError(400, 'Proposal not found, expired, or signer invalid', 'INVALID_REQUEST');
    res.json(proposal);
  })
);

multisigRouter.post(
  '/proposals/:proposalId/reject',
  validate(rejectMultisigPaymentSchema),
  asyncHandler(async (req, res) => {
    const proposalId = Array.isArray(req.params.proposalId) ? req.params.proposalId[0] : req.params.proposalId;
    const { signer, signature, reason } = req.body;
    const proposal = multisigService.rejectProposal(proposalId, signer, signature, reason);
    if (!proposal) throw new AppError(400, 'Proposal not found, not pending, or signer invalid', 'INVALID_REQUEST');
    res.json(proposal);
  })
);

multisigRouter.post(
  '/proposals/:proposalId/cancel',
  asyncHandler(async (req, res) => {
    const proposalId = Array.isArray(req.params.proposalId) ? req.params.proposalId[0] : req.params.proposalId;
    const proposal = multisigService.cancelProposal(proposalId);
    if (!proposal) throw new AppError(400, 'Proposal not found or not pending', 'INVALID_REQUEST');
    res.json(proposal);
  })
);

multisigRouter.post(
  '/sweep-expired',
  asyncHandler(async (_req, res) => {
    const count = multisigService.sweepExpiredProposals();
    res.json({ swept: count });
  })
);

// ---------------------------------------------------------------------------
// Legacy payment routes (backwards-compatible aliases)
// ---------------------------------------------------------------------------

multisigRouter.post(
  '/payments',
  validate(createMultisigPaymentSchema),
  asyncHandler(async (req, res) => {
    const { groupId, amount, currency, description, mode, metadata } = req.body;
    const payment = multisigService.createPayment({ groupId, amount, currency, description, mode, metadata });
    if (!payment) throw new AppError(404, 'Multisig group not found', 'NOT_FOUND');
    res.status(201).json(payment);
  })
);

multisigRouter.get(
  '/payments',
  asyncHandler(async (_req, res) => {
    res.json(multisigService.listPayments());
  })
);

multisigRouter.get(
  '/payments/:paymentId',
  asyncHandler(async (req, res) => {
    const paymentId = Array.isArray(req.params.paymentId) ? req.params.paymentId[0] : req.params.paymentId;
    const payment = multisigService.getPayment(paymentId);
    if (!payment) throw new AppError(404, 'Multisig payment not found', 'NOT_FOUND');
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
    if (!payment) throw new AppError(400, 'Payment not found or signer invalid', 'NOT_FOUND');
    res.json(payment);
  })
);
