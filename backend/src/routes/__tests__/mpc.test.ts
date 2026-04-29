import express, { type Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { mpcRouter } from '../mpc.js';
import { errorHandler } from '../../middleware/errorHandler.js';
import { clearNodes } from '../../services/mpc/nodes.js';
import { resetHsm } from '../../services/mpc/hsm.js';
import { __reset } from '../../services/mpc/coordinator.js';
import {
  generateIdentityKeypair,
  sign as ed25519Sign,
} from '../../services/mpc/ed25519.js';
import { messageDigest } from '../../services/mpc/bft.js';

let server: import('node:http').Server;
let base = '';

async function call<T = unknown>(
  method: 'GET' | 'POST' | 'DELETE',
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

describe('mpc http api', () => {
  beforeAll(async () => {
    const app: Express = express();
    app.use(express.json());
    app.use('/api/v1/mpc', mpcRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    clearNodes();
    resetHsm();
    __reset();
  });

  it('walks a node → ceremony → sign → verify flow end-to-end', async () => {
    const identities = Array.from({ length: 5 }, () => generateIdentityKeypair());

    // Register 5 nodes.
    for (let i = 0; i < identities.length; i++) {
      const res = await call('POST', '/api/v1/mpc/nodes', {
        id: `node-${i + 1}`,
        identityPublicKey: identities[i].publicKey.toString('hex'),
        label: `node ${i + 1}`,
      });
      expect(res.status).toBe(201);
    }

    // List — should show the 5 nodes.
    const list = await call<{ data: unknown[] }>('GET', '/api/v1/mpc/nodes');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(5);

    // Run a 3-of-5 ceremony.
    const ceremony = await call<{
      data: { key: { id: string; publicKey: string; threshold: number } };
    }>('POST', '/api/v1/mpc/ceremony', {
      threshold: 3,
      nodes: identities.map((_, i) => `node-${i + 1}`),
    });
    expect(ceremony.status).toBe(201);
    const { key } = ceremony.body.data;
    expect(key.threshold).toBe(3);

    // Start a signing session.
    const payload = Buffer.from('pay 1000 XLM to treasury', 'utf-8').toString('hex');
    const session = await call<{ data: { id: string } }>('POST', '/api/v1/mpc/sign', {
      keyId: key.id,
      payload,
      requestedBy: 'admin-1',
    });
    expect(session.status).toBe(201);
    const sessionId = session.body.data.id;

    // Contribute 3 valid approvals.
    const payloadBuf = Buffer.from(payload, 'hex');
    const digest = messageDigest(sessionId, payloadBuf);
    for (let i = 0; i < 3; i++) {
      const signature = ed25519Sign(identities[i].seed, digest).toString('hex');
      const res = await call('POST', `/api/v1/mpc/sign/${sessionId}/contribute`, {
        nodeId: `node-${i + 1}`,
        approvalSignature: signature,
      });
      expect(res.status).toBe(200);
    }

    const finalSession = await call<{
      data: { status: string; signatureHex: string };
    }>('GET', `/api/v1/mpc/sign/${sessionId}`);
    expect(finalSession.body.data.status).toBe('signed');
    expect(finalSession.body.data.signatureHex).toMatch(/^[0-9a-f]{128}$/);
  });

  it('rejects malformed ceremony bodies with 400', async () => {
    const res = await call('POST', '/api/v1/mpc/ceremony', {
      threshold: 1,
      nodes: ['a'],
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown nodes, keys, and sessions', async () => {
    expect((await call('GET', '/api/v1/mpc/nodes/ghost')).status).toBe(404);
    expect((await call('GET', '/api/v1/mpc/keys/ghost')).status).toBe(404);
    expect((await call('GET', '/api/v1/mpc/sign/ghost')).status).toBe(404);
  });

  it('revokes keys via the HTTP API', async () => {
    const ids = Array.from({ length: 3 }, () => generateIdentityKeypair());
    for (let i = 0; i < 3; i++) {
      await call('POST', '/api/v1/mpc/nodes', {
        id: `node-${i + 1}`,
        identityPublicKey: ids[i].publicKey.toString('hex'),
      });
    }

    const ceremony = await call<{ data: { key: { id: string } } }>(
      'POST',
      '/api/v1/mpc/ceremony',
      { threshold: 2, nodes: ['node-1', 'node-2', 'node-3'] },
    );
    const keyId = ceremony.body.data.key.id;

    const revoked = await call<{ data: { status: string } }>(
      'POST',
      `/api/v1/mpc/keys/${keyId}/revoke`,
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.status).toBe('revoked');

    // Signing against a revoked key is refused.
    const attempt = await call('POST', '/api/v1/mpc/sign', {
      keyId,
      payload: '00',
      requestedBy: 'admin',
    });
    expect(attempt.status).toBe(400);
  });

  it('exposes an aggregate status endpoint', async () => {
    const res = await call<{
      data: { keys: { total: number }; nodes: number; hsmBackend: string };
    }>('GET', '/api/v1/mpc/status');
    expect(res.status).toBe(200);
    expect(typeof res.body.data.keys.total).toBe('number');
    expect(res.body.data.hsmBackend).toBe('in-memory');
  });
});
