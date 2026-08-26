import { Router, Request, Response, NextFunction } from 'express';
import escapeHtml from 'escape-html';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  bulkCreatePaymentLinkSchema,
  createPaymentLinkSchema,
  paymentLinkCompletionSchema,
  updatePaymentLinkSchema,
} from '../schemas/payment-links.js';
import { paymentLinksService, type PaymentLinkRecord, type ABTestVariant } from '../services/payment-links.js';

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
    res.json({ data: link.analytics });
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
    res.json({ data: paymentLinksService.getShareLinks(link.slug) });
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

function safeUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function safeColor(value: string | undefined): string {
  return value && /^#[A-Fa-f0-9]{6}$/.test(value) ? value : '#0052FF';
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function renderHostedCheckoutPage(
  link: PaymentLinkRecord,
  options: { source: string; password?: string; passwordError?: string; variant?: ABTestVariant } = { source: 'direct' }
): string {
  const selectedVariant = options.variant;
  const accentColor = safeColor(selectedVariant?.accentColor || link.brand?.accentColor);
  const brandName = escapeHtml(link.brand?.brandName || 'AgenticPay');
  const logoUrl = safeUrl(link.brand?.logoUrl);
  const redirectUrl = safeUrl(link.brand?.redirectUrl);
  const description = escapeHtml(selectedVariant?.description || link.description || 'Secure checkout link');
  const amountToPay = selectedVariant ? selectedVariant.amount : link.amount;
  const formattedAmount = escapeHtml(money(amountToPay, link.currency));
  const expiresAt = escapeHtml(new Date(link.expiresAt).toUTCString());
  const source = escapeHtml(options.source || 'direct');
  const password = escapeHtml(options.password || '');
  const passwordError = options.passwordError ? escapeHtml(options.passwordError) : '';
  const isUnlocked = !link.requiresPassword || Boolean(options.password && !options.passwordError);
  const ctaText = escapeHtml(selectedVariant?.ctaText || 'Complete payment');
  
  const completionPayload = JSON.stringify({
    amountPaid: amountToPay,
    source: options.source || 'direct',
    password: options.password || undefined,
  }).replace(/</g, '\\u003c');
  const redirectTarget = redirectUrl ? JSON.stringify(redirectUrl).replace(/</g, '\\u003c') : '';


  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${brandName} checkout</title>
    <style>
      :root { color-scheme: light; --accent: ${accentColor}; --ink: #111827; --muted: #5b6472; --line: #d9dee7; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: #f6f8fb; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      .checkout { width: min(100%, 440px); background: #fff; border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 24px 70px rgba(15, 23, 42, .10); overflow: hidden; }
      .brand { display: flex; align-items: center; gap: 12px; padding: 20px 22px; border-bottom: 1px solid var(--line); }
      .logo { width: 38px; height: 38px; border-radius: 8px; object-fit: contain; border: 1px solid var(--line); }
      .mark { width: 38px; height: 38px; border-radius: 8px; background: var(--accent); color: #fff; display: grid; place-items: center; font-weight: 800; }
      .brand-name { margin: 0; font-size: 15px; font-weight: 700; }
      .secure { margin: 2px 0 0; color: var(--muted); font-size: 12px; }
      .content { padding: 22px; }
      h1 { margin: 0 0 8px; font-size: 22px; line-height: 1.2; letter-spacing: 0; }
      .description { margin: 0 0 22px; color: var(--muted); line-height: 1.5; overflow-wrap: anywhere; }
      .amount { margin: 0; font-size: 36px; line-height: 1.1; font-weight: 800; letter-spacing: 0; }
      .meta { display: flex; justify-content: space-between; gap: 16px; margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
      label { display: block; margin: 20px 0 8px; font-size: 13px; font-weight: 700; }
      input { width: 100%; min-height: 44px; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font: inherit; }
      .error { margin: 10px 0 0; color: #b42318; font-size: 13px; }
      .actions { display: grid; gap: 10px; margin-top: 22px; }
      button, .secondary { min-height: 46px; border-radius: 8px; border: 1px solid transparent; font: inherit; font-weight: 750; cursor: pointer; text-decoration: none; display: inline-grid; place-items: center; }
      button { background: var(--accent); color: #fff; }
      button:disabled { cursor: wait; opacity: .72; }
      .secondary { color: var(--ink); border-color: var(--line); background: #fff; }
      .result { min-height: 20px; margin-top: 12px; color: var(--muted); font-size: 13px; }
      @media (max-width: 520px) { main { padding: 12px; align-items: stretch; } .checkout { width: 100%; } .amount { font-size: 30px; } }
    </style>
  </head>
  <body>
    <main>
      <section class="checkout" aria-label="Hosted checkout">
        <header class="brand">
          ${logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="" />` : `<div class="mark">${brandName.charAt(0)}</div>`}
          <div>
            <p class="brand-name">${brandName}</p>
            <p class="secure">Secure payment request</p>
          </div>
        </header>
        <div class="content">
          <h1>Review payment</h1>
          ${selectedVariant ? `<p id="variant-info" style="font-size:13px; color:var(--muted); margin:-4px 0 12px;">Variant: ${escapeHtml(selectedVariant.name)}</p>` : ''}
          <p class="description">${description}</p>
          <p class="amount">${formattedAmount}</p>
          <div class="meta">
            <span>Currency</span>
            <strong>${escapeHtml(link.currency)}</strong>
          </div>
          <div class="meta">
            <span>Expires</span>
            <strong>${expiresAt}</strong>
          </div>
          ${
            link.requiresPassword
              ? `<form method="get">
                  <input type="hidden" name="source" value="${source}" />
                  <label for="password">Payment password</label>
                  <input id="password" name="password" type="password" value="${password}" autocomplete="current-password" required />
                  ${passwordError ? `<p class="error">${passwordError}</p>` : ''}
                  <div class="actions"><button type="submit">Unlock checkout</button></div>
                </form>`
              : ''
          }
          ${
            isUnlocked
              ? `<div class="actions">
                  <button id="pay-button" type="button">${ctaText}</button>
                  ${redirectUrl ? `<a class="secondary" href="${escapeHtml(redirectUrl)}">Return to merchant</a>` : ''}
                </div>
                <p id="result" class="result" role="status"></p>`
              : ''
          }
        </div>
      </section>
    </main>
    <script>
      const button = document.getElementById('pay-button');
      const result = document.getElementById('result');
      if (button) {
        button.addEventListener('click', async () => {
          button.disabled = true;
          result.textContent = 'Confirming payment...';
          try {
            const response = await fetch(window.location.pathname.replace(/\\/$/, '') + '/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(${completionPayload}),
            });
            if (!response.ok) throw new Error('Payment could not be completed.');
            result.textContent = 'Payment completed.';
            ${redirectUrl ? `window.setTimeout(() => { window.location.href = ${redirectTarget}; }, 900);` : ''}
          } catch (error) {
            result.textContent = error instanceof Error ? error.message : 'Payment could not be completed.';
            button.disabled = false;
          }
        });
      }
    </script>
  </body>
</html>`;
}
paymentLinksRouter.get(
  '/merchant/:merchantId/summary',
  asyncHandler(async (req, res) => {
    const merchantId = Array.isArray(req.params.merchantId) ? req.params.merchantId[0] : req.params.merchantId;
    const summary = paymentLinksService.getMerchantDashboardSummary(merchantId);
    res.json({ data: summary });
  })
);

paymentLinksRouter.post(
  '/id/:id/variants',
  asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { variants } = req.body as { variants: ABTestVariant[] };
    
    if (!variants || !Array.isArray(variants)) {
      throw new AppError(400, 'variants array is required', 'VALIDATION_ERROR');
    }
    
    const updated = paymentLinksService.addOrUpdateVariants(id, variants);
    if (!updated) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }
    
    res.json({ data: updated });
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
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    res.json({
      dataUrl,
      linkUrl: paymentLinksService.getShareLinks(link.slug).url,
    });
  })
);

paymentLinksRouter.get(
  '/r/:slug',
  redirectRateLimiter,
  asyncHandler(async (req, res) => {
    const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
    const source = req.query.source ? String(req.query.source) : 'direct';

    const existing = paymentLinksService.getBySlug(slug);
    if (!existing) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }
    if (!paymentLinksService.isUsable(existing)) {
      throw new AppError(410, 'Payment link has expired or been disabled', 'PAYMENT_LINK_EXPIRED');
    }

    // Gate protected links before counting the view, so brute-force probes
    // can't inflate analytics.
    const password = typeof req.query.password === 'string' ? req.query.password : '';
    if (existing.requiresPassword) {
      if (!password) {
        if (req.headers?.accept?.includes('application/json')) {
          res.status(401).json({ error: 'A valid password is required', code: 'PAYMENT_LINK_PASSWORD_REQUIRED' });
          return;
        }
        res.status(401).setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(renderHostedCheckoutPage(existing, { source }));
        return;
      }

      const result = paymentLinksService.verifyPassword(slug, password);
      if (!result.ok) {
        if (result.reason === 'locked') {
          throw new AppError(
            429,
            'Too many incorrect password attempts. Try again later.',
            'PAYMENT_LINK_LOCKED'
          );
        }

        if (req.headers?.accept?.includes('application/json')) {
          res.status(401).json({ error: 'Invalid password', code: 'PAYMENT_LINK_PASSWORD_REQUIRED' });
          return;
        }

        res.status(401).setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(
          renderHostedCheckoutPage(existing, {
            source,
            password,
            passwordError: 'That password did not match this payment link.',
          })
        );
        return;
      }
    }

    const requestedVariantId = req.query.variant ? String(req.query.variant) : undefined;
    const variant = paymentLinksService.selectVariant(existing, requestedVariantId);

    const link = paymentLinksService.trackView(slug, source, variant?.id);
    if (!link) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }

    if (req.headers?.accept?.includes('application/json')) {
      res.json({
        data: link,
        selectedVariant: variant,
        qrCodeUrl: paymentLinksService.getQrCodeUrl(link.slug),
        share: paymentLinksService.getShareLinks(link.slug, variant?.id, source),
      });
      return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderHostedCheckoutPage(link, { source, password, variant }));
  })
);

paymentLinksRouter.post(
  '/r/:slug/complete',
  validate(paymentLinkCompletionSchema),
  asyncHandler(async (req, res) => {
    const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
    const source = req.body.source || 'direct';

    const existing = paymentLinksService.getBySlug(slug);
    if (!existing) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }
    if (!paymentLinksService.isUsable(existing)) {
      throw new AppError(410, 'Payment link has expired, been disabled, or reached its usage limit', 'PAYMENT_LINK_EXPIRED');
    }

    enforcePassword(slug, existing, req.body.password);

    const completed = paymentLinksService.complete(slug, source);
    if (!completed) {
      throw new AppError(404, 'Payment link not found', 'NOT_FOUND');
    }

    res.json({ data: completed.analytics });
  })
);
