import { describe, expect, it } from 'vitest';
import { prewarmSorobanRpcConnection } from './pool';

const rpcUrl = 'https://soroban.example/rpc';

describe('prewarmSorobanRpcConnection', () => {
  it('sends a health request and accepts a successful JSON-RPC response', async () => {
    let requestInit: RequestInit | undefined;
    const fetcher = async (_input: string, init?: RequestInit): Promise<Response> => {
      requestInit = init;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { status: 'healthy' } }));
    };

    await expect(prewarmSorobanRpcConnection(rpcUrl, fetcher)).resolves.toBeUndefined();

    expect(requestInit?.method).toBe('POST');
    expect(requestInit?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(requestInit?.body).toBe(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }));
  });

  it('rejects an unsuccessful HTTP response', async () => {
    const fetcher = async (): Promise<Response> => new Response(null, { status: 503 });

    await expect(prewarmSorobanRpcConnection(rpcUrl, fetcher)).rejects.toThrow(
      'Soroban RPC warm-up returned HTTP 503'
    );
  });

  it('rejects a JSON-RPC error response', async () => {
    const fetcher = async (): Promise<Response> =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'unavailable' } }));

    await expect(prewarmSorobanRpcConnection(rpcUrl, fetcher)).rejects.toThrow(
      'Soroban RPC warm-up returned a JSON-RPC error'
    );
  });
});