import express from 'express';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { requestIdMiddleware } from '../../middleware/requestId.js';
import { createTestWebhookRouter } from './webhook.js';

const servers: Server[] = [];

async function serve(router: express.Router): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use('/api/dev/webhooks', router);
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
  return `http://127.0.0.1:${address.port}/api/dev/webhooks`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('local test webhook endpoint', () => {
  it('captures, redacts, lists, and clears webhook deliveries', async () => {
    const baseUrl = await serve(createTestWebhookRouter({ enabled: true, maxDeliveries: 2 }));
    const received = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
        'x-request-id': 'request-123',
      },
      body: JSON.stringify({ event: 'payment.completed' }),
    });

    expect(received.status).toBe(202);
    const body = (await received.json()) as { data: TestDelivery };
    expect(body.data.payload).toEqual({ event: 'payment.completed' });
    expect(body.data.requestId).toBe('request-123');
    expect(body.data.headers.authorization).toBe('[Redacted]');

    const listed = (await (await fetch(`${baseUrl}/deliveries`)).json()) as {
      data: TestDelivery[];
      meta: { count: number };
    };
    expect(listed.meta.count).toBe(1);
    expect(listed.data[0]?.id).toBe(body.data.id);

    expect((await fetch(`${baseUrl}/deliveries`, { method: 'DELETE' })).status).toBe(204);
    const cleared = (await (await fetch(`${baseUrl}/deliveries`)).json()) as {
      meta: { count: number };
    };
    expect(cleared.meta.count).toBe(0);
  });

  it('is unavailable when disabled', async () => {
    const baseUrl = await serve(createTestWebhookRouter({ enabled: false }));
    expect((await fetch(baseUrl, { method: 'POST' })).status).toBe(404);
  });
});

interface TestDelivery {
  id: string;
  requestId?: string;
  headers: Record<string, string>;
  payload: unknown;
}
