import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import {
  InMemoryWebhookReceiptStore,
  PrismaWebhookReceiptStore,
  WebhookReplayGuard,
  setWebhookReplayGuard,
  sha256Hex,
  type WebhookDelivery,
  type WebhookReceiptStore,
} from '../webhookReplay.js';
import { createWebhookVerifier, webhookJsonParser } from '../../middleware/webhookVerification.js';
import type { ProviderVerificationResult } from '../webhooks/providers.js';

vi.mock('../stripe.js', () => ({
  constructWebhookEvent: () => {
    throw new Error('stripe not exercised in this suite');
  },
}));

const T0 = new Date('2026-11-01T12:00:00Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function delivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    provider: 'custom',
    eventId: 'evt_1',
    rawBody: '{"amount":100}',
    signature: 'sig_a',
    eventTimestamp: T0,
    ...overrides,
  };
}

function setup(options: ConstructorParameters<typeof WebhookReplayGuard>[1] = {}) {
  let now = T0;
  const store = new InMemoryWebhookReceiptStore();
  const guard = new WebhookReplayGuard(store, { now: () => now, ...options });
  return {
    store,
    guard,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe('WebhookReplayGuard (#1472)', () => {
  it('accepts the first delivery and records a processing receipt without the raw body', async () => {
    const { guard } = setup();
    const result = await guard.claim(delivery());

    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') return;
    expect(result.reclaimed).toBe(false);
    expect(result.receipt).toMatchObject({
      provider: 'custom',
      eventId: 'evt_1',
      status: 'processing',
      deliveryCount: 1,
      payloadHash: sha256Hex('{"amount":100}'),
      signatureHash: sha256Hex('sig_a'),
    });
    expect(JSON.stringify(result.receipt)).not.toContain('amount');
    expect(result.receipt.expiresAt.getTime() - T0.getTime()).toBe(7 * DAY);
  });

  it('rejects a redelivery of a processed event as a duplicate', async () => {
    const { guard } = setup();
    await guard.claim(delivery());
    await guard.finish('custom', 'evt_1', 200);

    const second = await guard.claim(delivery({ signature: 'sig_b' }));
    expect(second.outcome).toBe('duplicate');
    if (second.outcome === 'duplicate') expect(second.receipt.status).toBe('processed');
  });

  it('treats a concurrent delivery as a duplicate while the first is still processing', async () => {
    const { guard } = setup();
    const [a, b] = await Promise.all([guard.claim(delivery()), guard.claim(delivery({ signature: 'sig_b' }))]);
    expect([a.outcome, b.outcome].sort()).toEqual(['accepted', 'duplicate']);
  });

  it('catches a byte-for-byte replay even when the unsigned event-ID header is changed', async () => {
    const { guard } = setup();
    await guard.claim(delivery({ eventId: 'evt_original' }));

    const replay = await guard.claim(delivery({ eventId: 'custom_1764590400000' }));
    expect(replay.outcome).toBe('duplicate');
    if (replay.outcome === 'duplicate') expect(replay.receipt.eventId).toBe('evt_original');
  });

  it('lets the provider retry an event whose handler failed', async () => {
    const { guard, store } = setup();
    await guard.claim(delivery());
    await guard.finish('custom', 'evt_1', 500);

    const retry = await guard.claim(delivery({ signature: 'sig_retry' }));
    expect(retry.outcome).toBe('accepted');
    if (retry.outcome !== 'accepted') return;
    expect(retry.reclaimed).toBe(true);
    expect(retry.receipt.deliveryCount).toBe(2);
    expect(retry.receipt.signatureHash).toBe(sha256Hex('sig_retry'));

    // The failed attempt's signature no longer blocks anything; the new one does.
    await guard.finish('custom', 'evt_1', 200);
    expect((await guard.claim(delivery({ signature: 'sig_retry', eventId: 'evt_other' }))).outcome).toBe('duplicate');
    expect(store.size).toBe(1);
  });

  it('treats a client disconnect (no status) as a failure that can be retried', async () => {
    const { guard } = setup();
    await guard.claim(delivery());
    await guard.finish('custom', 'evt_1', null);
    expect((await guard.claim(delivery())).outcome).toBe('accepted');
  });

  it('reclaims a processing claim only after the lease expires', async () => {
    const { guard, advance } = setup({ processingLeaseMs: 5 * MINUTE });
    await guard.claim(delivery());

    advance(4 * MINUTE);
    expect((await guard.claim(delivery({ signature: 'sig_2' }))).outcome).toBe('duplicate');

    advance(2 * MINUTE);
    const reclaimed = await guard.claim(delivery({ signature: 'sig_3' }));
    expect(reclaimed.outcome).toBe('accepted');
  });

  it('flags an event ID reused with a different payload as a conflict', async () => {
    const { guard } = setup();
    await guard.claim(delivery());
    await guard.finish('custom', 'evt_1', 200);

    const forged = await guard.claim(delivery({ rawBody: '{"amount":100000}', signature: 'sig_forged' }));
    expect(forged.outcome).toBe('conflict');
  });

  it('rejects deliveries older than the replay window, so pruning never re-opens an event', async () => {
    const { guard } = setup();
    const stale = await guard.claim(delivery({ eventTimestamp: new Date(T0.getTime() - 6 * DAY - MINUTE) }));
    expect(stale.outcome).toBe('stale');

    const fresh = await guard.claim(delivery({ eventTimestamp: new Date(T0.getTime() - 3 * DAY) }));
    expect(fresh.outcome).toBe('accepted');
  });

  it('prunes expired receipts', async () => {
    const { guard, store, advance } = setup();
    await guard.claim(delivery());
    await guard.finish('custom', 'evt_1', 200);
    advance(7 * DAY + 1);

    expect(await guard.prune()).toBe(1);
    expect(store.size).toBe(0);
  });

  it('keeps providers in separate namespaces', async () => {
    const { guard } = setup();
    await guard.claim(delivery({ provider: 'stripe' }));
    expect((await guard.claim(delivery({ provider: 'paypal' }))).outcome).toBe('accepted');
  });

  it('counts outcomes per provider', async () => {
    const { guard } = setup();
    await guard.claim(delivery());
    await guard.claim(delivery());
    await guard.finish('custom', 'evt_1', 200);
    expect(guard.stats()).toEqual({ custom: { accepted: 1, duplicate: 1, processed: 1 } });
  });

  it('refuses a replay window that is not shorter than the retention', () => {
    expect(() => new WebhookReplayGuard(new InMemoryWebhookReceiptStore(), { retentionMs: DAY, maxEventAgeMs: DAY })).toThrow(
      /maxEventAgeMs/,
    );
  });
});

describe('PrismaWebhookReceiptStore', () => {
  const uniqueViolation = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' });

  function fakeDb() {
    return {
      webhookReceipt: {
        create: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
  }

  it('maps a unique violation on insert to "already exists"', async () => {
    const db = fakeDb();
    db.webhookReceipt.create.mockRejectedValueOnce(uniqueViolation());
    const store = new PrismaWebhookReceiptStore(db as never);
    const guard = new WebhookReplayGuard(store, { now: () => T0 });

    const receipt = (await new WebhookReplayGuard(new InMemoryWebhookReceiptStore(), { now: () => T0 }).claim(delivery())) as {
      receipt: never;
    };
    db.webhookReceipt.findUnique.mockResolvedValueOnce({ id: 'r1', ...(receipt.receipt as object), status: 'processed' });

    const result = await guard.claim(delivery());
    expect(result.outcome).toBe('duplicate');
    expect(db.webhookReceipt.findUnique).toHaveBeenCalledWith({
      where: { provider_eventId: { provider: 'custom', eventId: 'evt_1' } },
    });
  });

  it('rethrows other database errors so the caller can fail closed', async () => {
    const db = fakeDb();
    db.webhookReceipt.create.mockRejectedValueOnce(new Error('connection refused'));
    const store = new PrismaWebhookReceiptStore(db as never);
    await expect(new WebhookReplayGuard(store, { now: () => T0 }).claim(delivery())).rejects.toThrow('connection refused');
  });

  it('reclaims with a conditional update so only one instance wins', async () => {
    const db = fakeDb();
    db.webhookReceipt.updateMany.mockResolvedValueOnce({ count: 0 });
    const store = new PrismaWebhookReceiptStore(db as never);
    const staleBefore = new Date(T0.getTime() - 5 * MINUTE);

    const won = await store.reclaim('custom', 'evt_1', T0, staleBefore, {
      payloadHash: 'p',
      signatureHash: 's',
      expiresAt: T0,
      sourceIp: null,
    });

    expect(won).toBeUndefined();
    expect(db.webhookReceipt.updateMany.mock.calls[0][0].where).toEqual({
      provider: 'custom',
      eventId: 'evt_1',
      OR: [{ status: 'failed' }, { expiresAt: { lte: T0 } }, { status: 'processing', claimedAt: { lt: staleBefore } }],
    });
  });

  it('only settles receipts that are still processing', async () => {
    const db = fakeDb();
    db.webhookReceipt.updateMany.mockResolvedValueOnce({ count: 1 });
    await new PrismaWebhookReceiptStore(db as never).finish('custom', 'evt_1', 'processed', 200, T0);
    expect(db.webhookReceipt.updateMany).toHaveBeenCalledWith({
      where: { provider: 'custom', eventId: 'evt_1', status: 'processing' },
      data: { status: 'processed', responseStatus: 200, processedAt: T0 },
    });
  });
});

describe('webhook receipts in the verification middleware', () => {
  let server: Server;
  let base: string;
  let handlerStatus = 200;
  let handled = 0;

  const verify = (req: Request, rawBody: string): ProviderVerificationResult => ({
    isValid: req.headers['x-signature'] !== 'bad',
    provider: 'custom',
    eventId: (req.headers['x-webhook-id'] as string) || `custom_${Date.now()}`,
    timestamp: new Date(),
    body: rawBody,
    payload: JSON.parse(rawBody),
  });

  async function start(store: WebhookReceiptStore) {
    setWebhookReplayGuard(new WebhookReplayGuard(store));
    const app = express();
    app.post('/hook', webhookJsonParser, createWebhookVerifier('custom', verify), (_req, res) => {
      handled += 1;
      res.status(handlerStatus).json({ ok: handlerStatus < 300 });
    });
    // Reads the status off the error, so it does not depend on AppError identity.
    app.use((err: { statusCode?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(err.statusCode ?? 500).json({ code: err.code });
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    base = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
  }

  const post = (headers: Record<string, string>, body = '{"amount":1}') =>
    fetch(`${base}/hook`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

  // Receipts are settled on 'finish', just after the client has the response.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  beforeEach(() => {
    handlerStatus = 200;
    handled = 0;
  });

  afterEach(async () => {
    setWebhookReplayGuard();
    await new Promise((resolve) => server.close(resolve));
  });

  it('runs the handler once and answers replays with 409', async () => {
    await start(new InMemoryWebhookReceiptStore());
    const first = await post({ 'x-signature': 'sig_1', 'x-webhook-id': 'evt_a' });
    expect(first.status).toBe(200);
    expect(first.headers.get('x-webhook-receipt')).toBe('accepted');
    await settle();

    const replay = await post({ 'x-signature': 'sig_1', 'x-webhook-id': 'evt_a' });
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ code: 'WEBHOOK_REPLAY' });

    const renamed = await post({ 'x-signature': 'sig_1' });
    expect(renamed.status).toBe(409);
    expect(handled).toBe(1);
  });

  it('identifies a replay by the verified signature header only, ignoring extra headers', async () => {
    await start(new InMemoryWebhookReceiptStore());
    await post({ 'x-signature': 'sig_1', 'x-webhook-id': 'evt_x' });
    await settle();

    const disguised = await post({
      'x-signature': 'sig_1',
      'x-webhook-id': 'evt_y',
      'stripe-signature': 'junk',
      'x-bank-signature': 'junk',
    });
    expect(disguised.status).toBe(409);
    expect(handled).toBe(1);
  });

  it('lets the provider retry after the handler fails', async () => {
    await start(new InMemoryWebhookReceiptStore());
    handlerStatus = 500;
    expect((await post({ 'x-signature': 'sig_1', 'x-webhook-id': 'evt_b' })).status).toBe(500);
    await settle();

    handlerStatus = 200;
    const retry = await post({ 'x-signature': 'sig_2', 'x-webhook-id': 'evt_b' });
    expect(retry.status).toBe(200);
    expect(retry.headers.get('x-webhook-receipt')).toBe('retry');
    expect(handled).toBe(2);
  });

  it('answers 409 WEBHOOK_EVENT_CONFLICT when an event ID comes back with a different body', async () => {
    await start(new InMemoryWebhookReceiptStore());
    await post({ 'x-signature': 'sig_1', 'x-webhook-id': 'evt_c' });
    await settle();
    const forged = await post({ 'x-signature': 'sig_2', 'x-webhook-id': 'evt_c' }, '{"amount":999}');
    expect(forged.status).toBe(409);
    expect(await forged.json()).toEqual({ code: 'WEBHOOK_EVENT_CONFLICT' });
  });

  it('never records receipts for deliveries that fail verification', async () => {
    const store = new InMemoryWebhookReceiptStore();
    await start(store);
    expect((await post({ 'x-signature': 'bad', 'x-webhook-id': 'evt_d' })).status).toBe(401);
    expect(store.size).toBe(0);
  });

  it('fails closed with 503 when receipts cannot be stored', async () => {
    const broken = new InMemoryWebhookReceiptStore();
    broken.insert = async () => {
      throw new Error('database down');
    };
    await start(broken);
    const res = await post({ 'x-signature': 'sig_1', 'x-webhook-id': 'evt_e' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: 'WEBHOOK_RECEIPT_UNAVAILABLE' });
    expect(handled).toBe(0);
  });
});
