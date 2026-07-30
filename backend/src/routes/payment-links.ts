import { Router, Request, Response, NextFunction } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  addVariantsSchema,
  bulkCreatePaymentLinkSchema,
  createPaymentLinkSchema,
  paymentLinkCompletionSchema,
  updatePaymentLinkSchema,
} from '../schemas/payment-links.js';
import { paymentLinksService } from '../services/payment-links.js';

export const paymentLinksRouter = Router();

const slugHitStore = new Map<string, { count: number; resetAtMs: number }>();
const bruteForceWindowMs = 60_000;
const bruteForceMax = 60;

function redirectRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const current = slugHitStore.get(key);
  const state = !current || current.resetAtMs <= now ? { count: 0, resetAtMs: now + bruteForceWindowMs } : current;

  state.count += 1;
  slugHitStore.set(key, state);

  if (state.count > bruteForceMax) {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many link resolution attempts. Slow down and retry.',
        status: 429,
      },
    });
    return;
  }

  next();
}

paymentLinksRouter.post(
  '/',
  validate(createPaymentLinkSchema),
  asyncHandler(async (req, res) => {
    const link = paymentLinksService.create(req.body);
    res.status(201).json({
      data: link,
      qrCodeUrl: paymentLinksService.getQrCodeUrl(link.slug),
      share: paymentLinksService.getShareLinks(link.slug),
    });
  })
);

paymentLinksRouter.post(
  '/bulk',
  validate(bulkCreatePaymentLinkSchema),
  asyncHandler(async (req, res) => {
    const records = paymentLinksService.bulkCreate(req.body.merchantId, req.body.links);
    res.status(201).json({
      data: records.map((link) => ({
        ...link,
        qrCodeUrl: paymentLinksService.getQrCodeUrl(link.slug),
      })),
      count: records.length,
    });
  })
);

paymentLinksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const links = paymentLinksService.list({
      merchantId: req.query.merchantId ? String(req.query.merchantId) : undefined,
      tag: req.query.tag ? String(req.query.tag) : undefined,
      category: req.query.category ? String(req.query.category) : undefined,
      includeExpired: String(req.query.includeExpired || 'false').toLowerCase() === 'true',
    });

    res.json({ data: links, count: links.length });
  })
);

paymentLinksRouter.get(
  '/merchant/:merchantId/summary',
  asyncHandler(async (req, res) => {
    const merchantId = Array.isArray(req.params.merchantId) ? req.params.merchantId[0] : req.params.merchantId;
    const summary = paymentLinksService.getMerchantDashboardSummary(merchantId);
    res.json({ data: summary });
  })
);

paymentLinksRouter.get(
  '/id/:id',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const link = paymentLinksService.getById(id);
    if (!link) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }

    res.json({
      data: link,
      qrCodeUrl: paymentLinksService.getQrCodeUrl(link.slug),
      share: paymentLinksService.getShareLinks(link.slug),
    });
  })
);

paymentLinksRouter.patch(
  '/id/:id',
  validate(updatePaymentLinkSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = paymentLinksService.update(id, req.body);
    if (!updated) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }
    res.json({ data: updated });
  })
);

paymentLinksRouter.post(
  '/id/:id/variants',
  validate(addVariantsSchema),
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = paymentLinksService.addOrUpdateVariants(id, req.body.variants);
    if (!updated) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }
    res.json({ data: updated });
  })
);

paymentLinksRouter.post(
  '/id/:id/expire',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = paymentLinksService.expire(id);
    if (!updated) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }
    res.json({ data: updated });
  })
);

paymentLinksRouter.get(
  '/id/:id/analytics',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const link = paymentLinksService.getById(id);
    if (!link) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }
    res.json({
      data: {
        ...link.analytics,
        conversions: paymentLinksService.getConversions(link.id),
      },
    });
  })
);

paymentLinksRouter.get(
  '/id/:id/conversions',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const link = paymentLinksService.getById(id);
    if (!link) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }
    const conversions = paymentLinksService.getConversions(id);
    res.json({ data: conversions, count: conversions.length });
  })
);

paymentLinksRouter.get(
  '/id/:id/qr',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const link = paymentLinksService.getById(id);
    if (!link) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }

    const type = req.query.type === 'svg' ? 'svg' : 'data-url';
    const qrData = await paymentLinksService.getQrCodeDataUrl(link.slug, type);

    if (type === 'svg') {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(qrData);
    } else {
      res.json({ dataUrl: qrData, linkUrl: `https://pay.agenticpay.com/r/${link.slug}` });
    }
  })
);

paymentLinksRouter.get(
  '/id/:id/share-links',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const link = paymentLinksService.getById(id);
    if (!link) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }

    const variantId = req.query.variant ? String(req.query.variant) : undefined;
    const source = req.query.source ? String(req.query.source) : undefined;

    res.json({ data: paymentLinksService.getShareLinks(link.slug, variantId, source) });
  })
);

function enforcePassword(slug: string, link: { requiresPassword: boolean }, password: unknown): void {
  if (!link.requiresPassword) {
    return;
  }
  const result = paymentLinksService.verifyPassword(slug, typeof password === 'string' ? password : '');
  if (result.ok) {
    return;
  }
  if (result.reason === 'locked') {
    throw new AppError(
      429,
      'Too many incorrect password attempts. Try again later.',
      'PAYMENT_LINK_LOCKED'
    );
  }
  throw new AppError(401, 'A valid password is required for this link', 'PAYMENT_LINK_PASSWORD_REQUIRED');
}

paymentLinksRouter.get(
  '/r/:slug',
  redirectRateLimiter,
  asyncHandler(async (req, res) => {
    const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
    const source = req.query.source ? String(req.query.source) : 'direct';
    const requestedVariantId = req.query.variant ? String(req.query.variant) : undefined;

    const existing = paymentLinksService.getBySlug(slug);
    if (!existing) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }
    if (!paymentLinksService.isUsable(existing)) {
      throw new AppError(410, 'Payment link has expired or been disabled', 'PAYMENT_LINK_EXPIRED');
    }

    // Gate protected links before counting the view, so brute-force probes
    // can't inflate analytics.
    enforcePassword(slug, existing, req.query.password);

    const selectedVariant = paymentLinksService.selectVariant(existing, requestedVariantId);
    const link = paymentLinksService.trackView(slug, source, selectedVariant?.id);
    if (!link) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }

    const accentColor = selectedVariant?.accentColor || link.brand?.accentColor || '#0B3A80';
    const brandName = link.brand?.brandName || 'AgenticPay';
    const title = selectedVariant?.name ? `${brandName} - ${selectedVariant.name}` : `${brandName} Payment Link`;
    const description = selectedVariant?.description || link.description || 'Secure checkout link';
    const amount = selectedVariant?.amount ?? link.amount;
    const ctaText = selectedVariant?.ctaText || 'Continue to Pay';

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: sans-serif; margin: 0; background: linear-gradient(120deg, #f4f7ff, #eefaf8); }
      main { max-width: 520px; margin: 8vh auto; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 20px 40px rgba(0,0,0,.08); }
      .pill { display: inline-block; background: ${accentColor}; color: white; border-radius: 999px; padding: 4px 10px; font-size: 12px; }
      .cta { margin-top: 20px; display: inline-block; background: ${accentColor}; color: white; text-decoration: none; padding: 10px 14px; border-radius: 10px; font-weight: bold; }
      .muted { color: #5c6270; font-size: 14px; }
      ${selectedVariant ? '.variant-badge { font-size: 12px; font-weight: 600; color: #4b5563; background: #f3f4f6; padding: 2px 8px; border-radius: 4px; margin-top: 4px; display: inline-block; }' : ''}
    </style>
  </head>
  <body>
    <main>
      <span class="pill">${brandName}</span>
      ${selectedVariant ? `<br/><span class="variant-badge">Variant: ${selectedVariant.name}</span>` : ''}
      <h1>Payment Request</h1>
      <p class="muted">${description}</p>
      <h2>${amount.toFixed(2)} ${link.currency}</h2>
      <p class="muted">Expires ${new Date(link.expiresAt).toUTCString()}</p>
      <a class="cta" href="${link.brand?.redirectUrl || '/checkout'}">${ctaText}</a>
    </main>
  </body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  })
);

paymentLinksRouter.post(
  '/r/:slug/complete',
  validate(paymentLinkCompletionSchema),
  asyncHandler(async (req, res) => {
    const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
    const source = req.body.source || 'direct';
    const variantId = req.body.variantId;
    const amountPaid = req.body.amountPaid;

    const existing = paymentLinksService.getBySlug(slug);
    if (!existing) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }
    if (!paymentLinksService.isUsable(existing)) {
      throw new AppError(410, 'Payment link has expired, been disabled, or reached its usage limit', 'PAYMENT_LINK_EXPIRED');
    }

    enforcePassword(slug, existing, req.body.password);

    const completed = paymentLinksService.complete(slug, source, variantId, amountPaid, {
      referrer: req.get('referrer'),
      userAgent: req.get('user-agent'),
    });

    if (!completed) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }

    res.json({ data: completed.analytics });
  })
);