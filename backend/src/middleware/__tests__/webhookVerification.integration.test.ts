import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import { webhookHandlersRouter } from '../../routes/webhookHandlers.js';
import { errorHandler } from '../errorHandler.js';
import {
  initWebhookKeyRegistry,
  resetWebhookKeyRegistry,
} from '../../services/webhookKeys.js';
import { clearReplayCache } from '../../services/webhooks/replay.js';
import { generateWebhookSignature } from '../../services/webhooks/verification.js';

vi.mock('../../services/stripe.js', () => ({
  constructWebhookEvent: () => {
    throw new Error('stripe not exercised in this suite');
  },
}));

const PAYLOAD = JSON.stringify({ event: 'payment.succeeded', data: { id: 'evt_int_1' } });
const LEGACY_CUSTOM_SECRET = 'whsec_test_default_custom_secret_key_32_chars_min';

let server: Server;
let base: string;

async function setupServer() {
  const app = express();
  app.use(webhookHandlersRouter);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address && typeof address === 'object') {
    base = `http://127.0.0.1:${address.port}`;
  } else {
    throw new Error('Failed to bind test server');
  }
}

function postCustom(path: string, init: { headers?: Record<string, string>; body?: string }) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers ?? {}) };
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
}

describe('webhook verification integration (key rotation)', () => {
  let clock = 1_700_000_000_000;

  beforeAll(async () => {
    await setupServer();
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    clock = 1_700_000_000_000;
    resetWebhookKeyRegistry();
    clearReplayCache();
  });

  afterEach(() => {
    resetWebhookKeyRegistry();
    clearReplayCache();
  });

  it('accepts a valid custom webhook signed with the active key', async () => {
    const registry = initWebhookKeyRegistry({ keys: [{ provider: 'custom', secret: 'rotation_secret_01_abcdefghijklmnop' }] });
    const signed = registry.sign({ provider: 'custom', body: PAYLOAD });

    const res = await postCustom('/custom', {
      headers: {
        'X-AgenticPay-Signature': signed.signature,
        'X-AgenticPay-Timestamp': signed.timestamp,
      },
      body: PAYLOAD,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });

  it('rejects a tampered payload with 401 WEBHOOK_VERIFICATION_FAILED', async () => {
    const registry = initWebhookKeyRegistry({ keys: [{ provider: 'custom', secret: 'rotation_secret_02_abcdefghijklmnop' }] });
    const signed = registry.sign({ provider: 'custom', body: PAYLOAD });
    const tampered = JSON.stringify({ event: 'payment.succeeded', data: { id: 'evt_int_1', amount: 999999 } });

    const res = await postCustom('/custom', {
      headers: {
        'X-AgenticPay-Signature': signed.signature,
        'X-AgenticPay-Timestamp': signed.timestamp,
      },
      body: tampered,
    });

    expect(res.status).toBe(401);
    expect((await res.json())?.error?.message).toMatch(/verification failed/i);
  });

  it('rejects requests missing a signature', async () => {
    initWebhookKeyRegistry({ keys: [{ provider: 'custom', secret: 'rotation_secret_03_abcdefghijklmnop' }] });

    const res = await postCustom('/custom', { body: PAYLOAD });

    expect(res.status).toBe(401);
  });

  it('keeps verifying with the old key during the rotation overlap', async () => {
    const registry = initWebhookKeyRegistry({
      now: () => clock,
      overlapSeconds: 3600,
      keys: [{ provider: 'custom', secret: 'rotation_secret_04_abcdefghijklmnop' }],
    });
    const signedOld = registry.sign({ provider: 'custom', body: PAYLOAD });
    registry.rotate({ provider: 'custom', secret: 'rotation_secret_05_abcdefghijklmnop' });
    clock += 60_000;

    const res = await postCustom('/custom', {
      headers: {
        'X-AgenticPay-Signature': signedOld.signature,
        'X-AgenticPay-Timestamp': signedOld.timestamp,
      },
      body: PAYLOAD,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });

  it('rejects the old key once the rotation overlap elapses', async () => {
    const registry = initWebhookKeyRegistry({
      now: () => clock,
      overlapSeconds: 3600,
      keys: [{ provider: 'custom', secret: 'rotation_secret_06_abcdefghijklmnop' }],
    });
    const signedOld = registry.sign({ provider: 'custom', body: PAYLOAD });
    registry.rotate({ provider: 'custom', secret: 'rotation_secret_07_abcdefghijklmnop' });
    clock += 3600 * 1000 + 1000;

    const res = await postCustom('/custom', {
      headers: {
        'X-AgenticPay-Signature': signedOld.signature,
        'X-AgenticPay-Timestamp': signedOld.timestamp,
      },
      body: PAYLOAD,
    });

    expect(res.status).toBe(401);
  });

  it('falls back to legacy verification when no registry keys exist', async () => {
    initWebhookKeyRegistry();
    const timestamp = new Date().toISOString();
    const signature = generateWebhookSignature(PAYLOAD, LEGACY_CUSTOM_SECRET, timestamp);

    const res = await postCustom('/custom', {
      headers: {
        'X-Signature': signature,
        'X-Timestamp': timestamp,
      },
      body: PAYLOAD,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });

  it('rejects duplicate deliveries of the same event (replay protection)', async () => {
    const registry = initWebhookKeyRegistry({ keys: [{ provider: 'custom', secret: 'rotation_secret_08_abcdefghijklmnop' }] });
    const signed = registry.sign({ provider: 'custom', body: PAYLOAD });
    const headers = {
      'X-AgenticPay-Signature': signed.signature,
      'X-AgenticPay-Timestamp': signed.timestamp,
      'X-Webhook-Id': 'evt_int_replay_1',
    };

    const first = await postCustom('/custom', { headers, body: PAYLOAD });
    expect(first.status).toBe(200);

    const second = await postCustom('/custom', { headers, body: PAYLOAD });
    expect(second.status).toBe(409);
    expect((await second.json())?.error?.message).toBe('Duplicate webhook delivery');
  });
});