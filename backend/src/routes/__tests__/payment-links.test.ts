import { beforeEach, describe, expect, it, vi } from 'vitest';
import { paymentLinksRouter } from '../payment-links.js';
import { paymentLinksService } from '../../services/payment-links.js';
import { Request, Response, Router, RequestHandler } from 'express';

describe('Payment Links API Routes', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let resJson: any;
  let resStatus: any;
  let resSend: any;
  let resHeader: any;

  const getNamedRouteHandler = (router: Router, path: string, method: 'get' | 'post' | 'patch', name?: string): RequestHandler => {
    const routeLayer = router.stack.find(
      (entry) => entry.route?.path === path && entry.route?.methods[method]
    );

    if (!routeLayer) {
      throw new Error(`Route not found for ${method.toUpperCase()} ${path}`);
    }

    if (name) {
      const handler = routeLayer.route?.stack.find((entry: any) => entry.name === name)?.handle;
      if (!handler) {
        throw new Error(`Route handler ${name} not found for ${method.toUpperCase()} ${path}`);
      }
      return handler;
    }

    // Return the last handler in stack (the controller)
    const handlers = routeLayer.route?.stack;
    return handlers[handlers.length - 1].handle;
  };

  beforeEach(() => {
    paymentLinksService.resetForTests();
    resJson = vi.fn();
    resSend = vi.fn();
    resHeader = vi.fn();
    resStatus = vi.fn().mockReturnValue({ json: resJson, send: resSend, setHeader: resHeader });
    mockReq = { body: {}, params: {}, query: {}, get: vi.fn() };
    mockRes = {
      status: resStatus,
      json: resJson,
      send: resSend,
      setHeader: resHeader,
    };
  });

  it('creates payment link with variants and analytics initialized', async () => {
    mockReq.body = {
      merchantId: 'm_route_1',
      amount: 99.99,
      currency: 'USD',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      recurrence: 'one_time',
      tags: ['saas'],
      variants: [
        { id: 'v1', name: 'Standard', amount: 99.99, weight: 50 },
        { id: 'v2', name: 'Annual Offer', amount: 89.99, weight: 50 },
      ],
    };

    const handler = getNamedRouteHandler(paymentLinksRouter, '/', 'post');
    await handler(mockReq as Request, mockRes as Response, vi.fn());

    expect(resStatus).toHaveBeenCalledWith(201);
    expect(resJson).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          merchantId: 'm_route_1',
          amount: 99.99,
          variants: expect.arrayContaining([
            expect.objectContaining({ id: 'v1' }),
            expect.objectContaining({ id: 'v2' }),
          ]),
        }),
        qrCodeUrl: expect.any(String),
        share: expect.objectContaining({
          url: expect.any(String),
          embedCode: expect.any(String),
        }),
      })
    );
  });

  it('fetches merchant dashboard summary via API', async () => {
    const link = paymentLinksService.create({
      merchantId: 'm_route_summary',
      amount: 50,
      currency: 'USD',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      recurrence: 'weekly',
      tags: [],
    });

    paymentLinksService.trackView(link.slug);
    paymentLinksService.complete(link.slug, 'direct', undefined, 50);

    mockReq.params = { merchantId: 'm_route_summary' };

    const handler = getNamedRouteHandler(paymentLinksRouter, '/merchant/:merchantId/summary', 'get');
    await handler(mockReq as Request, mockRes as Response, vi.fn());

    expect(resJson).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: 'm_route_summary',
        totalLinks: 1,
        totalCompletions: 1,
        totalRevenue: 50,
        overallConversionRate: 100,
      }),
    });
  });

  it('adds variants to existing payment link', async () => {
    const link = paymentLinksService.create({
      merchantId: 'm_route_var',
      amount: 120,
      currency: 'USD',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      recurrence: 'weekly',
      tags: [],
    });

    mockReq.params = { id: link.id };
    mockReq.body = {
      variants: [
        { id: 'opt_1', name: 'Option 1', amount: 120, weight: 50 },
        { id: 'opt_2', name: 'Option 2', amount: 100, weight: 50 },
      ],
    };

    const handler = getNamedRouteHandler(paymentLinksRouter, '/id/:id/variants', 'post');
    await handler(mockReq as Request, mockRes as Response, vi.fn());

    expect(resJson).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: link.id,
        variants: expect.arrayContaining([expect.objectContaining({ id: 'opt_1' })]),
      }),
    });
  });

  it('fetches QR code data URL via /id/:id/qr', async () => {
    const link = paymentLinksService.create({
      merchantId: 'm_route_qr',
      amount: 30,
      currency: 'USD',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      recurrence: 'one_time',
      tags: [],
    });

    mockReq.params = { id: link.id };
    mockReq.query = { type: 'data-url' };

    const handler = getNamedRouteHandler(paymentLinksRouter, '/id/:id/qr', 'get');
    await handler(mockReq as Request, mockRes as Response, vi.fn());

    expect(resJson).toHaveBeenCalledWith({
      dataUrl: expect.stringContaining('data:image/png;base64'),
      linkUrl: expect.stringContaining(link.slug),
    });
  });

  it('renders landing page with variant selection on GET /r/:slug', async () => {
    const link = paymentLinksService.create({
      merchantId: 'm_route_r',
      amount: 80,
      currency: 'USD',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      recurrence: 'weekly',
      tags: [],
      variants: [
        { id: 'v_promo', name: 'Promo Deal', amount: 65, ctaText: 'Get Promo', weight: 100 },
      ],
    });

    mockReq.params = { slug: link.slug };
    mockReq.query = { variant: 'v_promo', source: 'facebook' };

    const handler = getNamedRouteHandler(paymentLinksRouter, '/r/:slug', 'get');
    await handler(mockReq as Request, mockRes as Response, vi.fn());

    expect(resHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
    expect(resSend).toHaveBeenCalledWith(expect.stringContaining('Variant: Promo Deal'));
    expect(resSend).toHaveBeenCalledWith(expect.stringContaining('Get Promo'));
  });
});
