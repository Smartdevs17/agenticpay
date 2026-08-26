/**
 * MockAgenticPayServer — lightweight HTTP mock server for SDK testing.
 *
 * Usage:
 *   const server = await MockAgenticPayServer.create({
 *     routes: [
 *       { method: 'GET', path: '/health', status: 200, body: { status: 'ok' } },
 *     ],
 *   });
 *   const sdk = createTestSDK({ baseUrl: server.url });
 *   // ... make calls, assert on requests
 *   await server.close();
 */

import http from 'node:http';
import type { MockRoute, MockServerOptions, MockServerInstance, RecordedRequest } from './types.js';

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
      if (typeof route.path === 'string') {
        // Exact match OR path-only match (ignoring query string)
        if (route.path === path) return true;
        const [pathOnly] = path.split('?');
        return route.path === pathOnly;
      }
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
