import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoiceRouter } from '../invoice.js';
import { verificationRouter } from '../verification.js';
import { Request, Response, Router, RequestHandler } from 'express';

describe('Schema Validation', () => {
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

  describe('Invoice Validation', () => {
    it('returns 400 when projectId is missing', async () => {
      mockReq.body = { workDescription: 'Test' };
      const handler = getNamedRouteHandler(invoiceRouter, '/generate', 'validateMiddleware');

      await handler(mockReq as Request, mockRes as Response, vi.fn());

      expect(resStatus).toHaveBeenCalledWith(400);
      expect(resJson).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Validation failed',
        errors: expect.arrayContaining([
          expect.objectContaining({ path: 'projectId' })
        ])
      }));
    });
  });

  describe('Verification Validation', () => {
    it('returns 400 when repositoryUrl is invalid', async () => {
      mockReq.body = { 
        repositoryUrl: 'not-a-url',
        milestoneDescription: 'Test',
        projectId: 'P1'
      };
      const handler = getNamedRouteHandler(verificationRouter, '/verify', 'validateMiddleware');

      await handler(mockReq as Request, mockRes as Response, vi.fn());

      expect(resStatus).toHaveBeenCalledWith(400);
      expect(resJson).toHaveBeenCalledWith(expect.objectContaining({
        errors: expect.arrayContaining([
          expect.objectContaining({ path: 'repositoryUrl', message: 'Invalid repository URL' })
        ])
      }));
    });

    it('returns 400 for empty bulk verification items', async () => {
      mockReq.body = { items: [] };
      const handler = getNamedRouteHandler(
        verificationRouter,
        '/verify/batch',
        'validateMiddleware'
      );

      await handler(mockReq as Request, mockRes as Response, vi.fn());

      expect(resStatus).toHaveBeenCalledWith(400);
      expect(resJson).toHaveBeenCalledWith(expect.objectContaining({
        errors: expect.arrayContaining([
          expect.objectContaining({ path: 'items' })
        ])
      }));
    });
  });
});
