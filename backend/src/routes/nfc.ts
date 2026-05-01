import { Router, Request, Response } from 'express';
import { z } from 'zod';

export const nfcRouter = Router();

const PaymentRequestSchema = z.object({
  address: z.string().min(1),
  amount: z.string().optional(),
  currency: z.string().default('XLM'),
  memo: z.string().optional(),
  label: z.string().optional(),
});

// Generate a payment request payload for NFC/QR
nfcRouter.post('/payment-request', (req: Request, res: Response) => {
  const parsed = PaymentRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payment request', details: parsed.error.flatten() });
    return;
  }

  const { address, amount, currency, memo, label } = parsed.data;

  // Build a web+stellar URI (SEP-0007 style)
  const params = new URLSearchParams();
  if (amount) params.set('amount', amount);
  if (memo) params.set('memo', memo);
  if (label) params.set('label', label);
  params.set('currency', currency);

  const queryString = params.toString();
  const paymentUrl = `web+stellar:pay?destination=${address}${queryString ? `&${queryString}` : ''}`;

  res.json({
    paymentUrl,
    address,
    amount: amount ?? null,
    currency,
    memo: memo ?? null,
    label: label ?? null,
    createdAt: new Date().toISOString(),
  });
});

// Validate a scanned payment URL
nfcRouter.post('/validate', (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  try {
    const isWebStellar = url.startsWith('web+stellar:pay?');
    if (!isWebStellar) {
      res.status(422).json({ valid: false, error: 'Unsupported payment URL format' });
      return;
    }

    const queryPart = url.replace('web+stellar:pay?', '');
    const params = new URLSearchParams(queryPart);
    const destination = params.get('destination');

    if (!destination) {
      res.status(422).json({ valid: false, error: 'Missing destination address' });
      return;
    }

    res.json({
      valid: true,
      destination,
      amount: params.get('amount'),
      currency: params.get('currency') ?? 'XLM',
      memo: params.get('memo'),
      label: params.get('label'),
    });
  } catch {
    res.status(422).json({ valid: false, error: 'Failed to parse payment URL' });
  }
});
