import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'x-api-key']);

export interface TestWebhookDelivery {
  id: string;
  receivedAt: string;
  requestId?: string;
  headers: Record<string, string | string[]>;
  payload: unknown;
}

function safeHeaders(req: Request): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(req.headers)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => [name, SENSITIVE_HEADERS.has(name.toLowerCase()) ? '[Redacted]' : value])
  ) as Record<string, string | string[]>;
}

export function createTestWebhookRouter(options: { enabled?: boolean; maxDeliveries?: number } = {}) {
  const enabled = options.enabled ?? process.env.NODE_ENV !== 'production';
  const maxDeliveries = options.maxDeliveries ?? 100;
  const deliveries: TestWebhookDelivery[] = [];
  const router = Router();

  router.use((_req, res, next) => {
    if (!enabled) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }
    next();
  });

  router.post('/', (req, res) => {
    const delivery: TestWebhookDelivery = {
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
      requestId: req.requestId,
      headers: safeHeaders(req),
      payload: req.body,
    };

    deliveries.unshift(delivery);
    if (deliveries.length > maxDeliveries) deliveries.length = maxDeliveries;

    res.status(202).json({ data: delivery });
  });

  router.get('/deliveries', (_req, res) => {
    res.json({ data: deliveries, meta: { count: deliveries.length } });
  });

  router.delete('/deliveries', (_req, res) => {
    deliveries.length = 0;
    res.status(204).send();
  });

  return router;
}

export const devWebhookRouter = createTestWebhookRouter();
