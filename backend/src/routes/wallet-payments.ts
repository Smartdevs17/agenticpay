import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { walletPaymentService } from '../services/wallet-payments.js';

export const walletPaymentsRouter = Router();

const providerEnum = z.enum(['apple_pay', 'google_pay']);

const registerMerchantSchema = z.object({
  merchantId: z.string().min(1),
  provider: providerEnum,
  merchantIdentifier: z.string().min(1).optional(),
  displayName: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
});

const registerDomainSchema = z.object({
  provider: providerEnum,
  domain: z.string().min(1).max(253),
});

const verifyDomainSchema = z.object({
  provider: providerEnum,
  domain: z.string().min(1).max(253),
  token: z.string().min(1),
});

const createSessionSchema = z.object({
  merchantId: z.string().min(1),
  provider: providerEnum,
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  label: z.string().max(120).optional(),
});

const paymentTokenSchema = z.object({
  network: z.string().min(1),
  cryptogram: z.string().min(1),
  transactionId: z.string().min(1).optional(),
  expiresAt: z.string().datetime().optional(),
  displayName: z.string().max(120).optional(),
});

const serviceHandler =
  (handler: (req: Request, res: Response) => unknown | Promise<unknown>) =>
  asyncHandler(async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const serviceError = err as { statusCode?: number; code?: string; message?: string };
      if (typeof serviceError?.statusCode === 'number') {
        throw new AppError(serviceError.statusCode, serviceError.message ?? 'Wallet payment error', serviceError.code);
      }
      throw err;
    }
  });

// --------------------------------------------------------------- merchants

walletPaymentsRouter.post(
  '/merchants',
  validate(registerMerchantSchema),
  serviceHandler((req: Request, res: Response) => {
    res.status(201).json({ data: walletPaymentService.registerMerchant(req.body) });
  }),
);

walletPaymentsRouter.get(
  '/merchants/:merchantId',
  serviceHandler((req: Request, res: Response) => {
    const provider = String(req.query.provider) as 'apple_pay' | 'google_pay';
    const merchant = walletPaymentService.getMerchant(String(req.params.merchantId), provider);
    if (!merchant) throw new AppError(404, 'Wallet merchant not found', 'NOT_FOUND');
    res.json({ data: merchant });
  }),
);

walletPaymentsRouter.get(
  '/networks/:provider',
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: { provider: req.params.provider, networks: walletPaymentService.getSupportedNetworks(req.params.provider as never) } });
  }),
);

walletPaymentsRouter.post(
  '/merchants/:merchantId/domains',
  validate(registerDomainSchema),
  serviceHandler((req: Request, res: Response) => {
    res.status(201).json({
      data: walletPaymentService.registerDomain(String(req.params.merchantId), req.body.provider, req.body.domain),
    });
  }),
);

walletPaymentsRouter.post(
  '/merchants/:merchantId/domains/verify',
  validate(verifyDomainSchema),
  serviceHandler((req: Request, res: Response) => {
    res.json({
      data: walletPaymentService.verifyDomain(
        String(req.params.merchantId),
        req.body.provider,
        req.body.domain,
        req.body.token,
      ),
    });
  }),
);

// ---------------------------------------------------------------- sessions

walletPaymentsRouter.post(
  '/sessions',
  validate(createSessionSchema),
  serviceHandler((req: Request, res: Response) => {
    res.status(201).json({ data: walletPaymentService.createPaymentSession(req.body) });
  }),
);

walletPaymentsRouter.get(
  '/sessions',
  serviceHandler((req: Request, res: Response) => {
    const { merchantId, provider, status } = req.query;
    res.json({
      data: walletPaymentService.listSessions({
        merchantId: merchantId as string | undefined,
        provider: provider as never,
        status: status as never,
      }),
    });
  }),
);

walletPaymentsRouter.get(
  '/sessions/:id',
  serviceHandler((req: Request, res: Response) => {
    const session = walletPaymentService.getSession(String(req.params.id));
    if (!session) throw new AppError(404, 'Wallet payment session not found', 'NOT_FOUND');
    res.json({ data: session });
  }),
);

walletPaymentsRouter.post(
  '/sessions/:id/validate',
  serviceHandler((req: Request, res: Response) => {
    res.json(walletPaymentService.validateMerchant(String(req.params.id)));
  }),
);

walletPaymentsRouter.post(
  '/sessions/:id/process',
  validate(paymentTokenSchema),
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: walletPaymentService.processPaymentToken(String(req.params.id), req.body) });
  }),
);

walletPaymentsRouter.post(
  '/sessions/:id/expire',
  serviceHandler((req: Request, res: Response) => {
    res.json({ data: walletPaymentService.expireSession(String(req.params.id)) });
  }),
);
