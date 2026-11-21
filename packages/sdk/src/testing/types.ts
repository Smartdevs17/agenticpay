/**
 * Types for the SDK testing utilities.
 */

export type MockRoute = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string | RegExp;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Optional delay in ms before responding */
  delayMs?: number;
  /** Optional handler for dynamic responses */
  handler?: (req: { method: string; path: string; body?: unknown; headers: Record<string, string> }) => {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
  };
};

export type MockServerOptions = {
  port?: number;
  routes?: MockRoute[];
  /** Default response for unmatched routes */
  defaultStatus?: number;
  defaultBody?: unknown;
};

export type RecordedRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  timestamp: number;
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
