/**
 * AML transaction monitoring API — Issue #922
 *
 * Endpoints:
 * - GET  /aml/rules                 → rule catalogue and thresholds
 * - POST /aml/score                 → score a single transaction
 * - POST /aml/monitor               → batch score + auto-create alerts
 * - GET  /aml/alerts                → list alerts (filter by status/severity/account)
 * - PATCH /aml/alerts/:id           → triage an alert
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  AML_THRESHOLDS,
  AmlAccountContext,
  AmlAlertSeverity,
  AmlAlertStatus,
  AmlTransaction,
  getAmlAlert,
  getAmlAlerts,
  getAmlRuleCatalogue,
  monitorAmlTransactions,
  resolveAmlAlert,
  scoreAmlRisk,
} from '../services/aml/transaction-monitor.js';

export const amlMonitoringRouter = Router();

const transactionSchema = z.object({
  transactionId: z.string().min(1),
  accountId: z.string().min(1),
  counterpartyId: z.string().min(1).optional(),
  amount: z.number(),
  currency: z.string().min(1),
  timestamp: z.union([z.number(), z.string().min(1)]),
  direction: z.enum(['inbound', 'outbound']).optional(),
  channel: z.enum(['crypto', 'bank', 'card', 'wallet']).optional(),
  originCountry: z.string().optional(),
  destinationCountry: z.string().optional(),
  counterpartySanctioned: z.boolean().optional(),
  counterpartyIsPep: z.boolean().optional(),
  structuringSignals: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const accountContextSchema = z.object({
  accountId: z.string().min(1),
  accountAgeDays: z.number().nonnegative().optional(),
  kycVerified: z.boolean().optional(),
  customerRiskRating: z.enum(['low', 'medium', 'high']).optional(),
  transactionsLastHour: z.number().int().nonnegative().optional(),
  transactionsLast24h: z.number().int().nonnegative().optional(),
  totalAmountLast24h: z.number().nonnegative().optional(),
  baselineAmount: z.number().nonnegative().optional(),
  distinctCounterpartiesLast24h: z.number().int().nonnegative().optional(),
  highRiskCountries: z.array(z.string()).optional(),
  knownCounterparties: z.array(z.string()).optional(),
});

const monitorSchema = z.object({
  transactions: z.array(transactionSchema).min(1),
  accounts: z.array(accountContextSchema).optional(),
});

const triageSchema = z.object({
  status: z.enum(['under_review', 'resolved', 'dismissed']),
  reviewedBy: z.string().min(1).optional(),
  resolution: z.string().min(1).optional(),
});

amlMonitoringRouter.get(
  '/rules',
  asyncHandler(async (_req: Request, res: Response) => {
    res.status(200).json({ success: true, data: { rules: getAmlRuleCatalogue(), thresholds: AML_THRESHOLDS } });
  }),
);

amlMonitoringRouter.post(
  '/score',
  validate(z.object({ transaction: transactionSchema, account: accountContextSchema.optional() })),
  asyncHandler(async (req: Request, res: Response) => {
    const { transaction, account } = req.body as {
      transaction: AmlTransaction;
      account?: AmlAccountContext;
    };
    const assessment = scoreAmlRisk(transaction, account);
    res.status(200).json({ success: true, data: assessment });
  }),
);

amlMonitoringRouter.post(
  '/monitor',
  validate(monitorSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { transactions, accounts } = req.body as {
      transactions: AmlTransaction[];
      accounts?: AmlAccountContext[];
    };

    const accountContexts: Record<string, AmlAccountContext> = {};
    for (const account of accounts ?? []) {
      accountContexts[account.accountId] = account;
    }

    const result = monitorAmlTransactions(transactions, accountContexts);
    res.status(200).json({ success: true, data: result });
  }),
);

amlMonitoringRouter.get(
  '/alerts',
  asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as AmlAlertStatus | undefined;
    const severity = req.query.severity as AmlAlertSeverity | undefined;
    const accountId = req.query.accountId as string | undefined;
    const list = getAmlAlerts({ status, severity, accountId });
    res.status(200).json({ success: true, data: list });
  }),
);

amlMonitoringRouter.get(
  '/alerts/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const alert = getAmlAlert(req.params.id);
    if (!alert) {
      res.status(404).json({ success: false, error: { message: 'AML alert not found' } });
      return;
    }
    res.status(200).json({ success: true, data: alert });
  }),
);

amlMonitoringRouter.patch(
  '/alerts/:id',
  validate(triageSchema),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { status, reviewedBy, resolution } = req.body as z.infer<typeof triageSchema>;
      const alert = resolveAmlAlert(req.params.id, status, { reviewedBy, resolution });
      res.status(200).json({ success: true, data: alert });
    } catch (error) {
      res.status(404).json({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Unable to update AML alert' },
      });
    }
  }),
);
