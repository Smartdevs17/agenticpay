/**
 * backend/src/services/webhooks/compression.ts
 *
 * Gzip + JSON streaming encoder for webhook payload delivery (Issue #1456).
 *
 * Constraints:
 * 1. Opt-in per endpoint, default OFF.
 * 2. Signature (HMAC-SHA256) is computed over the uncompressed canonical JSON body.
 * 3. Two-pass streaming over JSON chunk stream (Pass 1: digest, Pass 2: gzip) or buffered stream with size cap.
 * 4. Stored outbox payloads remain uncompressed; compression happens per delivery attempt.
 * 5. Uses Node's built-in zlib and stream modules with zlib.constants.Z_DEFAULT_COMPRESSION (level 6).
 * 6. Fail-open fallback: if compression fails, transmits uncompressed.
 */

import { createHmac } from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

export const DEFAULT_COMPRESSION_MIN_BYTES = 1024; // 1 KiB
export const DEFAULT_MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MiB hard cap
export const DEFAULT_COMPRESSION_LEVEL = zlib.constants.Z_DEFAULT_COMPRESSION; // Level 6

export interface CompressionOptions {
  enabled: boolean;
  minBytes?: number;
  maxBytes?: number;
  level?: number;
}

export interface PreparedPayload {
  body: Buffer | string;
  signature: string;
  isCompressed: boolean;
  rawBytes: number;
  compressedBytes: number;
  compressionRatio: number; // e.g. 0.65 means 65% reduction
  headers: Record<string, string>;
}

export interface WebhookCompressionStats {
  deliveriesTotal: number;
  compressedTotal: number;
  uncompressedTotal: number;
  rawBytesTotal: number;
  compressedBytesTotal: number;
  compressionErrors: number;
}

class WebhookMetricsTracker {
  private stats: WebhookCompressionStats = {
    deliveriesTotal: 0,
    compressedTotal: 0,
    uncompressedTotal: 0,
    rawBytesTotal: 0,
    compressedBytesTotal: 0,
    compressionErrors: 0,
  };

  recordDelivery(isCompressed: boolean, rawBytes: number, compressedBytes: number) {
    this.stats.deliveriesTotal++;
    this.stats.rawBytesTotal += rawBytes;
    if (isCompressed) {
      this.stats.compressedTotal++;
      this.stats.compressedBytesTotal += compressedBytes;
    } else {
      this.stats.uncompressedTotal++;
      this.stats.compressedBytesTotal += rawBytes;
    }
  }

  recordCompressionError() {
    this.stats.compressionErrors++;
  }

  getStats(): WebhookCompressionStats {
    return { ...this.stats };
  }

  reset() {
    this.stats = {
      deliveriesTotal: 0,
      compressedTotal: 0,
      uncompressedTotal: 0,
      rawBytesTotal: 0,
      compressedBytesTotal: 0,
      compressionErrors: 0,
    };
  }
}

export const webhookMetrics = new WebhookMetricsTracker();

/**
 * Computes HMAC-SHA256 signature over uncompressed body bytes.
 */
export function computeWebhookSignature(secret: string, uncompressedBody: string | Buffer): string {
  return createHmac('sha256', secret).update(uncompressedBody).digest('hex');
}

/**
 * Prepares webhook payload for dispatch with conditional gzip compression
 * and canonical signature calculation.
 */
export async function prepareWebhookPayload(
  rawJsonBody: string,
  secret: string,
  options: CompressionOptions,
): Promise<PreparedPayload> {
  const rawBytes = Buffer.byteLength(rawJsonBody, 'utf8');
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;

  if (rawBytes > maxBytes) {
    throw new Error(`Payload size ${rawBytes} bytes exceeds maximum allowed limit of ${maxBytes} bytes`);
  }

  // Pass 1: Compute signature on the canonical UNCOMPRESSED JSON body
  const signature = computeWebhookSignature(secret, rawJsonBody);

  const minBytes = options.minBytes ?? DEFAULT_COMPRESSION_MIN_BYTES;
  const shouldCompress = options.enabled && rawBytes >= minBytes;

  if (!shouldCompress) {
    return {
      body: rawJsonBody,
      signature,
      isCompressed: false,
      rawBytes,
      compressedBytes: rawBytes,
      compressionRatio: 0,
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
      },
    };
  }

  // Pass 2: Gzip compression with fallback
  try {
    const level = options.level ?? DEFAULT_COMPRESSION_LEVEL;
    const compressedBuffer = await gzipAsync(Buffer.from(rawJsonBody, 'utf8'), { level });
    const compressedBytes = compressedBuffer.length;
    const compressionRatio = rawBytes > 0 ? (rawBytes - compressedBytes) / rawBytes : 0;

    return {
      body: compressedBuffer,
      signature,
      isCompressed: true,
      rawBytes,
      compressedBytes,
      compressionRatio,
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'X-Webhook-Signature': signature,
        'X-Webhook-Signature-Representation': 'uncompressed-json',
      },
    };
  } catch (err) {
    // Fail open: fallback to uncompressed transmission
    webhookMetrics.recordCompressionError();
    return {
      body: rawJsonBody,
      signature,
      isCompressed: false,
      rawBytes,
      compressedBytes: rawBytes,
      compressionRatio: 0,
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
      },
    };
  }
}

/**
 * Independent test verifier for validating decompressed bodies and signatures.
 */
export async function verifyWebhookPayload(params: {
  body: Buffer | string;
  signature: string;
  secret: string;
  contentEncoding?: string;
}): Promise<{ valid: boolean; decompressedJson: string }> {
  let uncompressedString: string;

  if (params.contentEncoding === 'gzip') {
    const buffer = Buffer.isBuffer(params.body) ? params.body : Buffer.from(params.body, 'binary');
    const decompressed = await gunzipAsync(buffer);
    uncompressedString = decompressed.toString('utf8');
  } else {
    uncompressedString = typeof params.body === 'string' ? params.body : params.body.toString('utf8');
  }

  const expectedSignature = computeWebhookSignature(params.secret, uncompressedString);
  const valid = expectedSignature === params.signature;

  return { valid, decompressedJson: uncompressedString };
}
