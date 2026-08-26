import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { checkoutService } from '../services/checkout.js';
import {
  createCheckoutSessionSchema,
  updatePaymentMethodSchema,
  processPaymentSchema,
} from '../schemas/checkout.js';

export const checkoutRouter = Router();

// Create new checkout session (merchant auth / standard request)
checkoutRouter.post(
  '/sessions',
  validate(createCheckoutSessionSchema),
  asyncHandler(async (req, res) => {
    const session = checkoutService.create(req.body);
    res.status(201).json({
      data: session,
      checkoutUrl: `https://pay.agenticpay.com/checkout/${session.id}`,
    });
  })
);

// Get session details (public endpoint used by checkout client)
checkoutRouter.get(
  '/sessions/:id',
  asyncHandler(async (req, res) => {
    const session = checkoutService.getById(req.params.id);
    if (!session) {
      throw new AppError(404, 'Checkout session not found', 'NOT_FOUND');
    }
    res.json({ data: session });
  })
);

// Select payment method for a session
checkoutRouter.post(
  '/sessions/:id/payment-method',
  validate(updatePaymentMethodSchema),
  asyncHandler(async (req, res) => {
    const session = checkoutService.updatePaymentMethod(req.params.id, req.body.method);
    res.json({ data: session });
  })
);

// Lock exchange rate for crypto method
checkoutRouter.post(
  '/sessions/:id/lock-rate',
  asyncHandler(async (req, res) => {
    const session = checkoutService.lockExchangeRate(req.params.id);
    res.json({ data: session });
  })
);

// Process / execute payment
checkoutRouter.post(
  '/sessions/:id/pay',
  validate(processPaymentSchema),
  asyncHandler(async (req, res) => {
    const session = await checkoutService.processPayment(req.params.id, req.body);
    res.json({ data: session });
  })
);

// Download receipt for a completed session
checkoutRouter.get(
  '/sessions/:id/receipt',
  asyncHandler(async (req, res) => {
    const receiptHtml = checkoutService.generateReceipt(req.params.id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="receipt_${req.params.id}.html"`);
    res.send(receiptHtml);
  })
);

// Fetch active exchange rates
checkoutRouter.get(
  '/exchange-rates',
  asyncHandler(async (req, res) => {
    const rates = checkoutService.getExchangeRates();
    res.json({ data: rates });
  })
);
