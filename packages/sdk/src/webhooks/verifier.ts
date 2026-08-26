import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifyWebhookSignatureOptions {
  payload: string | Buffer | Record<string, unknown>;
  signature: string;
  secret: string;
  timestamp: string | number;
  toleranceSeconds?: number;
}

export function verifyWebhookSignature(options: VerifyWebhookSignatureOptions): boolean {
  const timestamp = Number(options.timestamp);
  if (!Number.isFinite(timestamp)) return false;

  const tolerance = options.toleranceSeconds ?? 300;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > tolerance) return false;

  const body = Buffer.isBuffer(options.payload)
    ? options.payload.toString('utf8')
    : typeof options.payload === 'string'
      ? options.payload
      : JSON.stringify(options.payload);
  const version = options.signature.split('=')[0] || 'v1';
  const digest = createHmac('sha256', options.secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  const expected = `${version}=${digest}`;
  const actualBuffer = Buffer.from(options.signature);
  const expectedBuffer = Buffer.from(expected);

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
