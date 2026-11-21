/**
 * backend/src/services/__tests__/webhook-compression.test.ts
 *
 * Verifies Issue #1456: Compress webhook payloads with gzip + streaming JSON encoder.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  prepareWebhookPayload,
  verifyWebhookPayload,
  webhookMetrics,
  DEFAULT_COMPRESSION_MIN_BYTES,
} from '../webhooks/compression.js';
import {
  upsertWebhookConfig,
  enqueueWebhookEvent,
  drainWebhookDeliveries,
  getWebhookDelivery,
  stopWebhookWorker,
} from '../webhooks.js';

describe('Webhook Payload Gzip Compression (Issue #1456)', () => {
  const secret = 'whsec_test_secret_key_12345';

  beforeEach(() => {
    webhookMetrics.reset();
  });

  afterEach(() => {
    stopWebhookWorker();
    vi.unstubAllGlobals();
  });

  function createRealisticFixture(itemCount = 30): Record<string, unknown> {
    const items = [];
    for (let i = 0; i < itemCount; i++) {
      items.push({
        id: `item_${i}`,
        description: `Consulting and development work for milestone ${i} in payments module`,
        amount: 25000 + i * 150,
        currency: 'USD',
        taxRate: 0.0825,
        sku: `SKU-PROD-2026-${i.toString().padStart(4, '0')}`,
        metadata: {
          clientId: `client_99_${i}`,
          department: 'engineering-fintech',
          region: 'us-east-1',
          approvedBy: 'supervisor_alice',
        },
      });
    }

    return {
      event: 'payment.settled',
      timestamp: '2026-11-21T12:00:00.000Z',
      settlementId: 'stl_8899220011',
      merchantId: 'm_enterprise_42',
      items,
      totalAmount: 750000,
      fees: 1250,
      netAmount: 748750,
    };
  }

  it('keeps non-opted-in endpoint byte-for-byte unchanged (OFF by default)', async () => {
    const fixture = createRealisticFixture(15);
    const rawJson = JSON.stringify(fixture);

    const result = await prepareWebhookPayload(rawJson, secret, {
      enabled: false, // Default is OFF
    });

    expect(result.isCompressed).toBe(false);
    expect(result.body).toBe(rawJson); // Exact byte-for-byte string
    expect(result.headers['Content-Type']).toBe('application/json');
    expect(result.headers['Content-Encoding']).toBeUndefined();
    expect(result.headers['X-Webhook-Signature']).toBeDefined();
  });

  it('compresses payload above threshold when endpoint has opted in', async () => {
    const fixture = createRealisticFixture(30);
    const rawJson = JSON.stringify(fixture);

    const result = await prepareWebhookPayload(rawJson, secret, {
      enabled: true,
      minBytes: DEFAULT_COMPRESSION_MIN_BYTES,
    });

    expect(result.isCompressed).toBe(true);
    expect(Buffer.isBuffer(result.body)).toBe(true);
    expect(result.headers['Content-Encoding']).toBe('gzip');
    expect(result.headers['Content-Type']).toBe('application/json');
    expect(result.headers['X-Webhook-Signature-Representation']).toBe('uncompressed-json');

    // Decompress and verify against independent verifier
    const verification = await verifyWebhookPayload({
      body: result.body,
      signature: result.signature,
      secret,
      contentEncoding: 'gzip',
    });

    expect(verification.valid).toBe(true);
    expect(verification.decompressedJson).toBe(rawJson);

    // Verify significant compression ratio (> 60% reduction on realistic JSON)
    expect(result.rawBytes).toBeGreaterThan(result.compressedBytes);
    expect(result.compressionRatio).toBeGreaterThan(0.6);
  });

  it('does NOT compress payloads below the minBytes threshold even when opted in', async () => {
    const smallPayload = JSON.stringify({ ping: 'pong', time: 12345 });

    const result = await prepareWebhookPayload(smallPayload, secret, {
      enabled: true,
      minBytes: 1024,
    });

    expect(result.isCompressed).toBe(false);
    expect(result.body).toBe(smallPayload);
    expect(result.headers['Content-Encoding']).toBeUndefined();
  });

  it('enforces maximum payload size cap', async () => {
    const hugePayload = 'X'.repeat(500); // 500 bytes

    await expect(
      prepareWebhookPayload(hugePayload, secret, {
        enabled: true,
        maxBytes: 250, // Cap at 250 bytes
      }),
    ).rejects.toThrow('exceeds maximum allowed limit');
  });

  it('falls back gracefully to uncompressed payload if compression throws', async () => {
    const payload = JSON.stringify({ event: 'test' });

    // Intentionally pass an invalid compression level to force zlib failure
    const result = await prepareWebhookPayload(payload, secret, {
      enabled: true,
      minBytes: 10,
      level: 99999 as any, // Invalid level
    });

    // Should fall back to uncompressed without dropping or throwing!
    expect(result.isCompressed).toBe(false);
    expect(result.body).toBe(payload);
    expect(result.headers['Content-Encoding']).toBeUndefined();
    expect(webhookMetrics.getStats().compressionErrors).toBe(1);
  });

  it('end-to-end delivery: dispatches gzip to opted-in endpoint and plain JSON to default endpoint', async () => {
    const receivedRequests: Array<{ url: string; headers: Headers; body: any }> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        receivedRequests.push({
          url,
          headers: new Headers(init.headers as any),
          body: init.body,
        });
        return { ok: true, status: 200, text: async () => '{"status":"ok"}' } as Response;
      }),
    );

    const fixture = createRealisticFixture(25);

    // Endpoint 1: Opted-in
    const configGzip = upsertWebhookConfig({
      merchantId: 'm_gzip',
      url: 'https://gzip.merchant.example/webhook',
      secret,
      compressPayloads: true,
      compressionMinBytes: 500,
    });

    // Endpoint 2: Non-opted in (default)
    const configPlain = upsertWebhookConfig({
      merchantId: 'm_plain',
      url: 'https://plain.merchant.example/webhook',
      secret,
    });

    enqueueWebhookEvent({
      merchantId: configGzip.merchantId,
      type: 'payment.settled',
      payload: fixture,
    });

    enqueueWebhookEvent({
      merchantId: configPlain.merchantId,
      type: 'payment.settled',
      payload: fixture,
    });

    await drainWebhookDeliveries();

    expect(receivedRequests).toHaveLength(2);

    const gzipReq = receivedRequests.find((r) => r.url.includes('gzip'))!;
    const plainReq = receivedRequests.find((r) => r.url.includes('plain'))!;

    // Gzip endpoint verification
    expect(gzipReq.headers.get('content-encoding')).toBe('gzip');
    expect(gzipReq.headers.get('content-type')).toBe('application/json');
    const gzipSig = gzipReq.headers.get('x-webhook-signature')!;
    const gzipVerify = await verifyWebhookPayload({
      body: gzipReq.body,
      signature: gzipSig,
      secret,
      contentEncoding: 'gzip',
    });
    expect(gzipVerify.valid).toBe(true);

    // Plain endpoint verification
    expect(plainReq.headers.get('content-encoding')).toBeNull();
    expect(plainReq.headers.get('content-type')).toBe('application/json');
    const plainSig = plainReq.headers.get('x-webhook-signature')!;
    const plainVerify = await verifyWebhookPayload({
      body: plainReq.body,
      signature: plainSig,
      secret,
    });
    expect(plainVerify.valid).toBe(true);

    // Both endpoints received identical semantic uncompressed JSON!
    expect(JSON.parse(gzipVerify.decompressedJson).payload).toEqual(
      JSON.parse(plainVerify.decompressedJson).payload,
    );
  });

  it('measures realistic compression ratio numbers', async () => {
    const fixture = createRealisticFixture(40);
    const rawJson = JSON.stringify(fixture);

    const prepared = await prepareWebhookPayload(rawJson, secret, {
      enabled: true,
      minBytes: 500,
    });

    const rawBytes = prepared.rawBytes;
    const compressedBytes = prepared.compressedBytes;
    const ratioPercent = (prepared.compressionRatio * 100).toFixed(2);

    // Real measurement assertion
    expect(rawBytes).toBeGreaterThan(6000); // Realistic ~7-8 KB JSON
    expect(compressedBytes).toBeLessThan(1800); // Compressed down to ~1.2 KB
    expect(prepared.compressionRatio).toBeGreaterThan(0.70); // > 70% space saved

    // Record verified numbers
    console.log(`Measured: Raw=${rawBytes} bytes, Compressed=${compressedBytes} bytes, Reduction=${ratioPercent}%`);
  });
});
