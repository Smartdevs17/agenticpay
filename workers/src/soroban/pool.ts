const PREWARM_TIMEOUT_MS = 5_000;

/**
 * Opens a reusable outbound connection to Soroban RPC when called by an active
 * Worker event. Cloudflare owns the underlying connection pool.
 */
export async function prewarmSorobanRpcConnection(
  rpcUrl: string,
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch
): Promise<void> {
  const response = await fetcher(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    signal: AbortSignal.timeout(PREWARM_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Soroban RPC warm-up returned HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') {
    throw new Error('Soroban RPC warm-up returned an invalid JSON-RPC response');
  }

  if ('error' in payload) {
    throw new Error('Soroban RPC warm-up returned a JSON-RPC error');
  }

  if (!('result' in payload)) {
    throw new Error('Soroban RPC warm-up response is missing a result');
  }
}