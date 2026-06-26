import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_SIGNATURE_HEADER = 'X-AgenticPay-Signature';
export const WEBHOOK_TIMESTAMP_HEADER = 'X-AgenticPay-Timestamp';
export const WEBHOOK_SIGNATURE_VERSION = 'v1';
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export interface SignedWebhookPayload {
  body: string;
  timestamp: string;
  signature: string;
  version: string;
  eventId: string;
}

export function signWebhookPayload(input: {
  payload: Record<string, unknown>;
  secret: string;
  version?: string;
  eventId?: string;
  timestamp?: number;
}): SignedWebhookPayload {
  const version = input.version ?? WEBHOOK_SIGNATURE_VERSION;
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  const eventId = input.eventId ?? `whev_${randomUUID()}`;
  const payloadWithSignature = {
    ...input.payload,
    webhook: {
      ...(typeof input.payload.webhook === 'object' && input.payload.webhook !== null ? input.payload.webhook : {}),
      eventId,
      signature: '',
      signatureVersion: version,
      timestamp,
    },
  };
  const bodyWithoutSignature = JSON.stringify(payloadWithSignature);
  const signature = buildWebhookSignature({ body: bodyWithoutSignature, timestamp, secret: input.secret, version });
  const body = JSON.stringify({
    ...payloadWithSignature,
    webhook: {
      ...(payloadWithSignature.webhook as Record<string, unknown>),
      signature,
    },
  });

  return { body, timestamp, signature, version, eventId };
}

export function buildWebhookSignature(input: {
  body: string;
  timestamp: string;
  secret: string;
  version?: string;
}): string {
  const version = input.version ?? WEBHOOK_SIGNATURE_VERSION;
  const digest = createHmac('sha256', input.secret)
    .update(`${input.timestamp}.${input.body}`)
    .digest('hex');
  return `${version}=${digest}`;
}

export function verifyWebhookSignature(input: {
  payload: string | Buffer | Record<string, unknown>;
  signature: string;
  secret: string;
  timestamp: string | number;
  toleranceSeconds?: number;
}): boolean {
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) return false;

  const tolerance = input.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > tolerance) return false;

  const body = Buffer.isBuffer(input.payload)
    ? input.payload.toString('utf8')
    : typeof input.payload === 'string'
      ? input.payload
      : JSON.stringify(input.payload);
  const expected = buildWebhookSignature({
    body,
    timestamp: String(timestamp),
    secret: input.secret,
    version: input.signature.split('=')[0] || WEBHOOK_SIGNATURE_VERSION,
  });

  const actual = Buffer.from(input.signature);
  const expectedBuffer = Buffer.from(expected);
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}
