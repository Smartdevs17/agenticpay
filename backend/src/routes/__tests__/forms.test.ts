import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formsRouter } from '../forms.js';
import { Request, Response, Router, RequestHandler } from 'express';

describe('Forms API Validation', () => {
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
    mockRes = {
      status: resStatus,
    };
  });

  it('returns 400 when creating a form without a name', async () => {
    mockReq.body = {
      description: 'Missing name',
      fields: [],
    };

    const handler = getNamedRouteHandler(formsRouter, '/', 'validateMiddleware');
    await handler(mockReq as Request, mockRes as Response, vi.fn());

    expect(resStatus).toHaveBeenCalledWith(400);
    expect(resJson).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Validation failed',
        errors: expect.arrayContaining([expect.objectContaining({ path: 'name' })]),
      }),
    );
  });

  it('returns 400 when submitting a form without values', async () => {
    mockReq.body = {};

    const handler = getNamedRouteHandler(formsRouter, '/:id/submissions', 'validateMiddleware');
    await handler(mockReq as Request, mockRes as Response, vi.fn());

    expect(resStatus).toHaveBeenCalledWith(400);
    expect(resJson).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Validation failed',
        errors: expect.arrayContaining([expect.objectContaining({ path: 'values' })]),
      }),
    );
  });
});
