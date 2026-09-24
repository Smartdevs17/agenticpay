import { createHmac } from 'node:crypto';
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

  constructor(config?: ZapierClientConfig) {
    this.defaultTimeoutMs = config?.defaultTimeoutMs ?? 10_000;
    this.maxRetries = config?.maxRetries ?? 3;
    this.secret = config?.secret;
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

    let attempt = 0;
    let lastError: string | undefined;
    let statusCode = 0;
    const start = Date.now();

    while (attempt <= this.maxRetries) {
      attempt++;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.defaultTimeoutMs);

        const response = await fetch(hookUrl, {
          method: 'POST',
          headers,
          body: rawBody,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        statusCode = response.status;

        if (response.ok) {
          return {
            subscriptionId,
            hookUrl,
            statusCode,
            success: true,
            latencyMs: Date.now() - start,
          };
        }

        // Retry on 5xx or 429
        if (response.status >= 500 || response.status === 429) {
          lastError = `Zapier responded with HTTP ${response.status}: ${response.statusText}`;
          if (attempt <= this.maxRetries) {
            const delay = Math.min(500 * Math.pow(2, attempt - 1), 5000);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        } else {
          // Client error (4xx) - do not retry
          lastError = `Zapier rejected webhook with HTTP ${response.status}: ${response.statusText}`;
          break;
        }
      } catch (err: any) {
        lastError = err?.message || 'Network error while delivering to Zapier';
        if (attempt <= this.maxRetries) {
          const delay = Math.min(500 * Math.pow(2, attempt - 1), 5000);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
    }

    return {
      subscriptionId,
      hookUrl,
      statusCode: statusCode || 500,
      success: false,
      latencyMs: Date.now() - start,
      error: lastError,
    };
  }
}

export const zapierClient = new ZapierClient();
