import express, { type Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { gasRouter } from '../gas.js';
import { errorHandler } from '../../middleware/errorHandler.js';

let server: import('node:http').Server;
let base = '';

async function call<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as T) : (undefined as T),
  };
}

describe('gas http api', () => {
  beforeAll(async () => {
    const app: Express = express();
    app.use(express.json());
    app.use('/api/v1/gas', gasRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('GET /targets returns the per-class table', async () => {
    const res = await call<{ data: Array<{ class: string; target: number }> }>(
      'GET',
      '/api/v1/gas/targets',
    );
    expect(res.status).toBe(200);
    const classes = res.body.data.map((r) => r.class).sort();
    expect(classes).toEqual([
      'administrative',
      'batch-transfer',
      'meta-transaction',
      'single-transfer',
      'write-heavy',
    ]);
  });

  it('GET /benchmarks lists every operation with its baseline', async () => {
    const res = await call<{ data: Array<{ operation: string; base: number }> }>(
      'GET',
      '/api/v1/gas/benchmarks',
    );
    expect(res.status).toBe(200);
    const ops = res.body.data.map((r) => r.operation).sort();
    expect(ops).toContain('splitPayment');
    expect(ops).toContain('erc20BatchTransfer');
    expect(ops).toContain('eip7702ExecuteWithAuth');
  });

  it('POST /estimate returns estimate + fees when baseFeeGwei is provided', async () => {
    const res = await call<{
      data: {
        estimate: { operation: string; estimated: number };
        fees: { maxFeePerGasGwei: number; expectedFeeEth: number };
      };
    }>('POST', '/api/v1/gas/estimate', {
      operation: 'erc20Transfer',
      calldataBytes: 64,
      fee: { baseFeeGwei: 10, priorityFeeGwei: 2 },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.estimate.operation).toBe('erc20Transfer');
    expect(res.body.data.fees.maxFeePerGasGwei).toBe(22);
    expect(res.body.data.fees.expectedFeeEth).toBeGreaterThan(0);
  });

  it('POST /estimate omits fees when none are provided', async () => {
    const res = await call<{
      data: { estimate: { estimated: number }; fees?: unknown };
    }>('POST', '/api/v1/gas/estimate', {
      operation: 'setPlatformFeeBps',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.fees).toBeUndefined();
  });

  it('POST /batch/estimate shows savings vs sequential execution', async () => {
    const res = await call<{
      data: { savings: number; savingsPct: number; batch: { itemCount: number } };
    }>('POST', '/api/v1/gas/batch/estimate', {
      operation: 'batchTransfer',
      itemCount: 20,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.batch.itemCount).toBe(20);
    expect(res.body.data.savings).toBeGreaterThan(0);
    expect(res.body.data.savingsPct).toBeGreaterThan(30);
  });

  it('POST /meta-tx/estimate prefers eip7702 over forwarder', async () => {
    const forwarder = await call<{ data: { estimated: number } }>(
      'POST',
      '/api/v1/gas/meta-tx/estimate',
      { innerOperation: 'erc20Transfer', channel: 'forwarder' },
    );
    const seventySeven = await call<{ data: { estimated: number } }>(
      'POST',
      '/api/v1/gas/meta-tx/estimate',
      { innerOperation: 'erc20Transfer', channel: 'eip7702' },
    );
    expect(forwarder.status).toBe(200);
    expect(seventySeven.status).toBe(200);
    expect(forwarder.body.data.estimated).toBeGreaterThan(
      seventySeven.body.data.estimated,
    );
  });

  it('400s for malformed bodies and unknown operations', async () => {
    const badOperation = await call('POST', '/api/v1/gas/estimate', {
      operation: 'notAnOperation',
    });
    expect(badOperation.status).toBe(400);

    const negativeItem = await call('POST', '/api/v1/gas/batch/estimate', {
      operation: 'batchTransfer',
      itemCount: 0,
    });
    expect(negativeItem.status).toBe(400);
  });
});
