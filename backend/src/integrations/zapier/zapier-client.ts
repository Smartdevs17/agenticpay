import { createHmac } from 'node:crypto';
import { createHttpClient, type HttpClient, HttpError } from '../../lib/http-client.js';
import type { ZapierDeliveryResult, ZapierEventPayload } from './types.js';

export interface ZapierClientConfig {
  defaultTimeoutMs?: number;
  maxRetries?: number;
  secret?: string;
}

export class ZapierClient {
  private readonly defaultTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly secret?: string;
  private readonly httpClient: HttpClient;

  constructor(config?: ZapierClientConfig) {
    this.defaultTimeoutMs = config?.defaultTimeoutMs ?? 10_000;
    this.maxRetries = config?.maxRetries ?? 3;
    this.secret = config?.secret;
    this.httpClient = createHttpClient({
      defaultTimeoutMs: this.defaultTimeoutMs,
      retryConfig: {
        maxRetries: this.maxRetries,
        baseDelayMs: 500,
        maxDelayMs: 5_000,
        retryableStatuses: [429, 500, 502, 503, 504],
        retryAllMethods: true,
      },
    });
  }

  /**
   * Generates HMAC-SHA256 signature for outgoing Zapier webhook payload.
   */
  generateSignature(payload: string, timestamp: string, secret: string): string {
    const signaturePayload = `${timestamp}.${payload}`;
    const hmac = createHmac('sha256', secret);
    hmac.update(signaturePayload);
    return `sha256=${hmac.digest('hex')}`;
  }

  /**
   * Dispatches a webhook payload to a single Zapier hook URL with signature and retries.
   */
  async sendWebhook(
    subscriptionId: string,
    hookUrl: string,
    eventPayload: ZapierEventPayload,
    hookSecret?: string
  ): Promise<ZapierDeliveryResult> {
    const rawBody = JSON.stringify(eventPayload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const activeSecret = hookSecret || this.secret;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'AgenticPay-Zapier-Integration/1.0',
      'X-Zapier-Event-Id': eventPayload.id,
      'X-Zapier-Timestamp': timestamp,
      'X-Zapier-Event-Type': eventPayload.event,
    };

    if (activeSecret) {
      headers['X-Zapier-Signature'] = this.generateSignature(rawBody, timestamp, activeSecret);
    }

    const start = Date.now();
    try {
      const response = await this.httpClient.request<Response>(hookUrl, {
        method: 'POST',
        headers,
        body: rawBody,
        responseType: 'raw',
        timeoutMs: this.defaultTimeoutMs,
        retry: {
          maxRetries: this.maxRetries,
          baseDelayMs: 500,
          maxDelayMs: 5000,
          retryableStatuses: [429, 500, 502, 503, 504],
          retryAllMethods: true,
        },
      });

      return {
        subscriptionId,
        hookUrl,
        statusCode: response.status,
        success: true,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      const statusCode = err instanceof HttpError ? err.status : 500;
      const lastError = err instanceof HttpError
        ? (err.status >= 500 || err.status === 429
            ? `Zapier responded with HTTP ${err.status}: ${err.statusText}`
            : `Zapier rejected webhook with HTTP ${err.status}: ${err.statusText}`)
        : (err?.message || 'Network error while delivering to Zapier');

      return {
        subscriptionId,
        hookUrl,
        statusCode,
        success: false,
        latencyMs: Date.now() - start,
        error: lastError,
      };
    }
  }
}

export const zapierClient = new ZapierClient();
