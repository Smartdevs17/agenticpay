/**
 * @agenticpay/sdk-testing
 *
 * Comprehensive testing utilities for applications built with the AgenticPay SDK.
 * Provides mock servers, test factories, assertion helpers, and event simulators.
 */

import http from 'node:http';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MockRoute = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string | RegExp;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  delayMs?: number;
  handler?: (req: { method: string; path: string; body?: unknown; headers: Record<string, string> }) => {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
  };
};

export type RecordedRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  timestamp: number;
};

export type MockServerOptions = {
  port?: number;
  routes?: MockRoute[];
  defaultStatus?: number;
  defaultBody?: unknown;
};

export type MockServerInstance = {
  url: string;
  port: number;
  close: () => Promise<void>;
  getRequests: () => RecordedRequest[];
  getLastRequest: () => RecordedRequest | undefined;
  addRoute: (route: MockRoute) => void;
  resetRoutes: () => void;
  resetRequests: () => void;
};

// ─── Mock Server ──────────────────────────────────────────────────────────────

/**
 * Creates a lightweight HTTP mock server for testing SDK integrations.
 *
 * @example
 *   const server = await MockAgenticPayServer.create({
 *     routes: [
 *       { method: 'POST', path: '/verification/verify', body: { id: 'v_1', status: 'verified' } },
 *     ],
 *   });
 *   // Use server.url to configure the SDK
 *   await server.close();
 */
export class MockAgenticPayServer {
  private server: http.Server;
  private routes: MockRoute[];
  private requests: RecordedRequest[] = [];
  private readonly defaultStatus: number;
  private readonly defaultBody: unknown;
  private _port: number;

  private constructor(options: MockServerOptions) {
    this.routes = options.routes ?? [];
    this.defaultStatus = options.defaultStatus ?? 404;
    this.defaultBody = options.defaultBody ?? { error: { message: 'Not Found' } };
    this._port = options.port ?? 0;
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  static async create(options: MockServerOptions = {}): Promise<MockServerInstance> {
    const instance = new MockAgenticPayServer(options);
    return instance.start();
  }

  private start(): Promise<MockServerInstance> {
    return new Promise((resolve) => {
      this.server.listen(this._port, '127.0.0.1', () => {
        const addr = this.server.address() as { port: number };
        this._port = addr.port;

        resolve({
          url: `http://127.0.0.1:${this._port}`,
          port: this._port,
          close: () => this.close(),
          getRequests: () => [...this.requests],
          getLastRequest: () => this.requests[this.requests.length - 1],
          addRoute: (route: MockRoute) => this.routes.push(route),
          resetRoutes: () => { this.routes = []; },
          resetRequests: () => { this.requests = []; },
        });
      });
    });
  }

  private close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const body = await this.readBody(req);
    const method = req.method ?? 'GET';
    const path = req.url ?? '/';
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers[key] = value;
    }

    this.requests.push({
      method,
      path,
      headers,
      body: body ?? undefined,
      timestamp: Date.now(),
    });

    const route = this.findRoute(method, path);

    if (route) {
      let response: { status?: number; body?: unknown; headers?: Record<string, string> } = {};

      if (route.handler) {
        response = route.handler({ method, path, body: body ?? undefined, headers });
      } else {
        response = {
          status: route.status ?? 200,
          body: route.body,
          headers: route.headers,
        };
      }

      if (route.delayMs) {
        await new Promise((r) => setTimeout(r, route.delayMs));
      }

      const statusCode = response.status ?? route.status ?? 200;
      const responseBody = response.body ?? route.body ?? {};
      const responseHeaders = { ...route.headers, ...response.headers, 'Content-Type': 'application/json' };

      for (const [key, value] of Object.entries(responseHeaders)) {
        res.setHeader(key, value);
      }
      res.writeHead(statusCode);
      res.end(JSON.stringify(responseBody));
    } else {
      res.writeHead(this.defaultStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.defaultBody));
    }
  }

  private findRoute(method: string, path: string): MockRoute | undefined {
    return this.routes.find((route) => {
      if (route.method !== method) return false;
      if (typeof route.path === 'string') return route.path === path;
      return route.path.test(path);
    });
  }

  private readBody(req: http.IncomingMessage): Promise<unknown | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        if (chunks.length === 0) return resolve(null);
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw);
        }
      });
      req.on('error', () => resolve(null));
    });
  }
}

// ─── Test Factories ───────────────────────────────────────────────────────────

import { createAgenticPaySDK } from '@agenticpay/sdk';

export type TestSDKOptions = {
  baseUrl?: string;
  apiKey?: string;
};

/**
 * Create an SDK instance configured for testing against a mock server.
 */
export function createTestSDK(options: TestSDKOptions = {}) {
  return createAgenticPaySDK({
    baseUrl: options.baseUrl ?? 'http://127.0.0.1:0/api/v1',
    apiKey: options.apiKey ?? 'test_api_key',
    timeoutMs: 5000,
    retry: { attempts: 0, baseDelayMs: 0 },
  });
}

// ─── Test Data Factories ──────────────────────────────────────────────────────

export const factories = {
  /** Create a mock subscription plan. */
  plan(overrides: Partial<{
    id: string;
    merchantId: string;
    name: string;
    interval: string;
    amount: number;
    currency: string;
    isActive: boolean;
  }> = {}) {
    return {
      id: overrides.id ?? `plan_${randomId()}`,
      merchantId: overrides.merchantId ?? `m_${randomId()}`,
      name: overrides.name ?? 'Test Plan',
      interval: overrides.interval ?? 'monthly',
      amount: overrides.amount ?? 29.99,
      currency: overrides.currency ?? 'USD',
      isActive: overrides.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  /** Create a mock subscription. */
  subscription(overrides: Partial<{
    id: string;
    customerId: string;
    planId: string;
    status: string;
  }> = {}) {
    return {
      id: overrides.id ?? `sub_${randomId()}`,
      customerId: overrides.customerId ?? `cus_${randomId()}`,
      planId: overrides.planId ?? `plan_${randomId()}`,
      status: overrides.status ?? 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  /** Create a mock escrow. */
  escrow(overrides: Partial<{
    id: string;
    projectId: string;
    payerId: string;
    payeeId: string;
    currency: string;
    totalAmount: number;
    status: string;
  }> = {}) {
    return {
      id: overrides.id ?? `esc_${randomId()}`,
      projectId: overrides.projectId ?? `proj_${randomId()}`,
      payerId: overrides.payerId ?? `payer_${randomId()}`,
      payeeId: overrides.payeeId ?? `payee_${randomId()}`,
      currency: overrides.currency ?? 'XLM',
      totalAmount: overrides.totalAmount ?? 1000,
      fundedAmount: 0,
      status: overrides.status ?? 'draft',
      milestones: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  /** Create a mock verification result. */
  verification(overrides: Partial<{
    id: string;
    status: string;
    score: number;
  }> = {}) {
    return {
      id: overrides.id ?? `v_${randomId()}`,
      status: overrides.status ?? 'verified',
      score: overrides.score ?? 95,
    };
  },

  /** Create a mock invoice. */
  invoice(overrides: Partial<{
    id: string;
    projectId: string;
    merchantId: string;
    totalAmount: number;
    currency: string;
    status: string;
  }> = {}) {
    return {
      id: overrides.id ?? `inv_${randomId()}`,
      projectId: overrides.projectId ?? `proj_${randomId()}`,
      merchantId: overrides.merchantId ?? `m_${randomId()}`,
      totalAmount: overrides.totalAmount ?? 500,
      currency: overrides.currency ?? 'USD',
      status: overrides.status ?? 'sent',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  /** Create a mock dispute. */
  dispute(overrides: Partial<{
    id: string;
    status: string;
    reason: string;
  }> = {}) {
    return {
      id: overrides.id ?? `dis_${randomId()}`,
      raisedBy: `user_${randomId()}`,
      reason: overrides.reason ?? 'Deliverable not as specified',
      status: overrides.status ?? 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  /** Create a webhook event payload. */
  webhookEvent(overrides: Partial<{
    id: string;
    type: string;
    data: Record<string, unknown>;
  }> = {}) {
    return {
      id: overrides.id ?? `evt_${randomId()}`,
      type: overrides.type ?? 'payment.completed',
      createdAt: new Date().toISOString(),
      data: overrides.data ?? { paymentId: `pay_${randomId()}` },
    };
  },
};

function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

// ─── Webhook Test Helpers ─────────────────────────────────────────────────────

import { createHmac } from 'node:crypto';

/**
 * Generate a valid webhook signature for testing.
 */
export function createTestWebhookSignature(
  payload: string,
  secret: string,
  timestamp?: number,
): { signature: string; timestamp: string } {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', secret)
    .update(`${ts}.${payload}`)
    .digest('hex');
  return {
    signature: `v1=${digest}`,
    timestamp: String(ts),
  };
}

// ─── Assertion Helpers ────────────────────────────────────────────────────────

import { AgenticPayError } from '@agenticpay/sdk';

/**
 * Assert that an error is an AgenticPayError with an expected status.
 */
export function expectApiError(error: unknown, expectedStatus?: number): AgenticPayError {
  if (!(error instanceof AgenticPayError)) {
    throw new Error(`Expected AgenticPayError, got ${typeof error}: ${String(error)}`);
  }
  if (expectedStatus !== undefined && error.status !== expectedStatus) {
    throw new Error(
      `Expected error with status ${expectedStatus}, got ${error.status}`,
    );
  }
  return error;
}

/**
 * Assert that the mock server received a request matching the criteria.
 */
export function expectRequest(
  server: MockServerInstance,
  criteria: { method?: string; path?: string | RegExp },
): RecordedRequest {
  const requests = server.getRequests();
  const match = requests.find((req) => {
    if (criteria.method && req.method !== criteria.method) return false;
    if (criteria.path) {
      const p = criteria.path;
      if (typeof p === 'string') {
        if (req.path !== p) return false;
      } else if (p instanceof RegExp) {
        if (!p.test(req.path)) return false;
      }
    }
    return true;
  });

  if (!match) {
    throw new Error(
      `Expected request matching ${JSON.stringify(criteria)}, but got ${requests.length} requests: ${JSON.stringify(requests.map(r => ({ method: r.method, path: r.path })))}`,
    );
  }
  return match;
}
