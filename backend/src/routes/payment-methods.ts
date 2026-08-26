// Issue #633: Payment method micro-deposit verification (minimal real slice).
// Deferred: verification notifications, verification analytics/reporting.

import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { microDepositVerificationService } from '../services/payments/micro-deposit-verification.js';

export const paymentMethodsRouter = Router();

function resolveTenant(req: any): string {
  return (req.headers['x-tenant-id'] as string) ?? 'default';
}

function resolveUser(req: any): string {
  return (req.headers['x-user-id'] as string) ?? 'unknown';
}

paymentMethodsRouter.post('/', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const userId = resolveUser(req);
  const { type, last4 } = req.body as { type?: string; last4?: string };

  const method = await prisma.paymentMethod.create({
    data: { tenantId, userId, type: type ?? 'bank_account', last4 },
  });
  res.status(201).json(method);
}));

paymentMethodsRouter.get('/:id', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const method = await prisma.paymentMethod.findUnique({ where: { id: req.params.id } });
  if (!method || method.tenantId !== tenantId) throw new AppError(404, 'Payment method not found', 'PAYMENT_METHOD_NOT_FOUND');
  res.json(method);
}));

paymentMethodsRouter.post('/:id/micro-deposits', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const method = await prisma.paymentMethod.findUnique({ where: { id: req.params.id } });
  if (!method || method.tenantId !== tenantId) throw new AppError(404, 'Payment method not found', 'PAYMENT_METHOD_NOT_FOUND');

  // Amounts are only ever handed back here so the caller can push them to the
  // outbound deposit rail; they are never persisted in plaintext response form.
  const amounts = await microDepositVerificationService.issueMicroDeposits(req.params.id as string);
  res.status(201).json({ issued: true, ...amounts });
}));

paymentMethodsRouter.post('/:id/verify', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const method = await prisma.paymentMethod.findUnique({ where: { id: req.params.id } });
  if (!method || method.tenantId !== tenantId) throw new AppError(404, 'Payment method not found', 'PAYMENT_METHOD_NOT_FOUND');

  const { amount1Cents, amount2Cents } = req.body as { amount1Cents: number; amount2Cents: number };
  if (typeof amount1Cents !== 'number' || typeof amount2Cents !== 'number') {
    throw new AppError(400, 'amount1Cents and amount2Cents are required numbers', 'INVALID_BODY');
  }

  const result = await microDepositVerificationService.verifyMicroDeposits(req.params.id as string, amount1Cents, amount2Cents);
  res.json(result);
}));
