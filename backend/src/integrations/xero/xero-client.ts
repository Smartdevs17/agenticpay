import type {
  XeroConfig,
  XeroContact,
  XeroInvoice,
  XeroPayment,
} from './types.js';
import { createHttpClient, type HttpClient, HttpError } from '../../lib/http-client.js';

interface XeroCollection<T> {
  Contacts?: T[];
  Invoices?: T[];
  Payments?: T[];
}

/**
 * Xero Accounting API client.
 *
 * Requests are scoped to a single tenant via the `xero-tenant-id` header, and
 * OAuth access tokens must be supplied by the caller.
 */
export class XeroClient {
  private readonly accessToken: string;
  private readonly tenantId: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly client: HttpClient;

  constructor(config: XeroConfig) {
    if (!config.accessToken || !config.tenantId) {
      throw new Error('Xero accessToken and tenantId are required');
    }

    this.accessToken = config.accessToken;
    this.tenantId = config.tenantId;
    this.baseUrl = (
      config.baseUrl ?? 'https://api.xero.com/api.xro/2.0'
    ).replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? 10_000;

    this.client = createHttpClient({
      baseUrl: this.baseUrl,
      auth: {
        type: 'bearer',
        token: this.accessToken,
      },
      defaultTimeoutMs: this.timeoutMs,
      headers: {
        'xero-tenant-id': this.tenantId,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    try {
      return await this.client.request<T>(path, {
        method,
        body,
        headers: extraHeaders,
      });
    } catch (err: unknown) {
      if (err instanceof HttpError) {
        const errorText = typeof err.responseBody === 'string'
          ? err.responseBody
          : JSON.stringify(err.responseBody ?? '');
        throw new Error(
          `Xero API error ${err.status}: ${err.statusText} – ${errorText}`,
        );
      }
      throw err;
    }
  }

  async getContacts(): Promise<XeroContact[]> {
    const result = await this.request<XeroCollection<XeroContact>>(
      'GET',
      '/Contacts?page=1',
    );
    return result.Contacts ?? [];
  }

  async findContactByEmail(email: string): Promise<XeroContact | null> {
    const where = encodeURIComponent(`EmailAddress=="${escapeWhere(email)}"`);
    const result = await this.request<XeroCollection<XeroContact>>(
      'GET',
      `/Contacts?where=${where}`,
    );
    return result.Contacts?.[0] ?? null;
  }

  async findContactByName(name: string): Promise<XeroContact | null> {
    const where = encodeURIComponent(`Name=="${escapeWhere(name)}"`);
    const result = await this.request<XeroCollection<XeroContact>>(
      'GET',
      `/Contacts?where=${where}`,
    );
    return result.Contacts?.[0] ?? null;
  }

  async createContact(contact: {
    Name: string;
    EmailAddress?: string;
  }): Promise<XeroContact> {
    const result = await this.request<XeroCollection<XeroContact>>(
      'POST',
      '/Contacts',
      { Contacts: [contact] },
    );
    const created = result.Contacts?.[0];
    if (!created) {
      throw new Error('Xero did not return the created contact');
    }
    return created;
  }

  async findInvoiceByReference(reference: string): Promise<XeroInvoice | null> {
    const where = encodeURIComponent(`Reference=="${escapeWhere(reference)}"`);
    const result = await this.request<XeroCollection<XeroInvoice>>(
      'GET',
      `/Invoices?where=${where}`,
    );
    return result.Invoices?.[0] ?? null;
  }

  async createInvoice(
    invoice: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<XeroInvoice> {
    const result = await this.request<XeroCollection<XeroInvoice>>(
      'POST',
      '/Invoices',
      { Invoices: [invoice] },
      { 'Idempotency-Key': idempotencyKey },
    );
    const created = result.Invoices?.[0];
    if (!created) {
      throw new Error('Xero did not return the created invoice');
    }
    return created;
  }

  async createPayment(
    payment: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<XeroPayment> {
    const result = await this.request<XeroCollection<XeroPayment>>(
      'POST',
      '/Payments',
      { Payments: [payment] },
      { 'Idempotency-Key': idempotencyKey },
    );
    const created = result.Payments?.[0];
    if (!created) {
      throw new Error('Xero did not return the created payment');
    }
    return created;
  }
}

function escapeWhere(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
