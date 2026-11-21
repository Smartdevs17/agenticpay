import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, Router, RequestHandler } from 'express';
import { splitsRouter } from '../splits.js';
import { refundsRouter } from '../refunds.js';

describe('Splits/Refunds Schema Validation', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let resJson: any;
  let resStatus: any;

  const getNamedRouteHandler = (router: Router, path: string, name: string): RequestHandler => {
    const routeLayer = router.stack.find((entry) => entry.route?.path === path);
    const handler = routeLayer?.route?.stack.find((entry) => entry.name === name)?.handle;

    if (!handler) {
      throw new Error(`Route handler not found for ${path}:${name}`);
    }

    return handler;
  };

  beforeEach(() => {
    resJson = vi.fn();
    resStatus = vi.fn().mockReturnValue({ json: resJson });
    mockReq = { body: {} };
    mockRes = { status: resStatus };
  });

  it('returns 400 when split config recipients are missing', async () => {
    mockReq.body = { merchantId: 'm1', platformFeePercentage: 5 };
    const handler = getNamedRouteHandler(splitsRouter, '/', 'validateMiddleware');

    await handler(mockReq as Request, mockRes as Response, vi.fn());

    expect(resStatus).toHaveBeenCalledWith(400);
    expect(resJson).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Validation failed',
      })
    );
  });

  it('returns 400 when refund evaluation paymentId is missing', async () => {
    mockReq.body = {
      merchantId: 'm1',
      paymentType: 'card',
      amountPaid: 100,
      requestedAmount: 10,
      daysSincePayment: 2,
    };
    const handler = getNamedRouteHandler(refundsRouter, '/evaluate', 'validateMiddleware');

    await handler(mockReq as Request, mockRes as Response, vi.fn());

    expect(resStatus).toHaveBeenCalledWith(400);
    expect(resJson).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Validation failed',
      })
    );
  });
});
