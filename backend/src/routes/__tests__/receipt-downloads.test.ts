import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Server } from 'node:http';

vi.mock('../../outbox/writer.js', () => ({
  enqueueStoredOutboxEventOutsideTransaction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../events/event-store.js', () => ({
  appendEvent: vi.fn().mockReturnValue({ id: 'evt-1', type: 'test' }),
}));

// The real authMiddleware needs credentials; these tests simulate an
// authenticated caller via the X-Test-User header.
vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const id = req.headers['x-test-user'];
    if (typeof id !== 'string') {
      next(Object.assign(new Error('Authentication required'), { statusCode: 401, code: 'AUTH_REQUIRED' }));
      return;
    }
    req.user = { id, tenantId: 'tenant-1', role: 'user', method: 'session' };
    next();
  },
}));

import { receiptsRouter } from '../receipts.js';
import { auditService } from '../../services/auditService.js';
import {
  mintReceipt,
  createReceiptDownloadGrant,
  verifyReceiptDownloadGrant,
  ReceiptDownloadError,
  RECEIPT_DOWNLOAD_MAX_TTL_SECONDS,
  RECEIPT_DOWNLOAD_DEFAULT_TTL_SECONDS,
} from '../../services/receipts.js';

/** Runs `fn` and returns the ReceiptDownloadError code it threw, failing the test if it did not throw one. */
function downloadErrorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ReceiptDownloadError) return err.code;
    throw err;
  }
  throw new Error('expected a ReceiptDownloadError but nothing was thrown');
}

const NOW = 1_800_000_000_000;
let counter = 0;
const uniq = () => `dl-${Date.now()}-${counter++}`;

/**
 * Maps errors to the JSON shape the app's errorHandler produces. It checks
 * `statusCode` and `code` by shape because `middleware/` has both a compiled
 * `errorHandler.js` and `errorHandler.ts`, so `instanceof AppError` can miss
 * under test.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function testErrorHandler(err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) {
  const status = typeof err?.statusCode === 'number' ? err.statusCode : 500;
  res.status(status).json({
    error: { code: err?.code ?? 'INTERNAL_SERVER_ERROR', message: err?.message, status, details: err?.details },
  });
}

function newReceipt() {
  return mintReceipt({
    paymentId: uniq(),
    transactionHash: `0x${uniq()}`,
    sender: 'sender-1',
    recipient: 'recipient-1',
    amount: 42,
    currency: 'USDC',
  });
}

const ALICE = 'alice';
const BOB = 'bob';

describe('receipt downloads (#1494)', () => {
  const originalSecret = process.env.RECEIPT_DOWNLOAD_SECRET;
  const originalEnv = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.RECEIPT_DOWNLOAD_SECRET = 's'.repeat(40);
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.RECEIPT_DOWNLOAD_SECRET;
    else process.env.RECEIPT_DOWNLOAD_SECRET = originalSecret;
    process.env.NODE_ENV = originalEnv;
  });

  describe('service: grant issue and verify', () => {
    it('issues a grant that verifies for the same user and receipt', () => {
      const receipt = newReceipt();
      const grant = createReceiptDownloadGrant({ tokenId: receipt.tokenId, userId: ALICE, now: NOW });

      expect(grant.expires - grant.iat).toBe(RECEIPT_DOWNLOAD_DEFAULT_TTL_SECONDS * 1000);
      const verified = verifyReceiptDownloadGrant({ ...grant, now: NOW + 1000 });
      expect(verified.tokenId).toBe(receipt.tokenId);
    });

    it('honours a custom lifetime up to the maximum', () => {
      const receipt = newReceipt();
      const grant = createReceiptDownloadGrant({
        tokenId: receipt.tokenId,
        userId: ALICE,
        ttlSeconds: RECEIPT_DOWNLOAD_MAX_TTL_SECONDS,
        now: NOW,
      });
      expect(grant.expires - grant.iat).toBe(RECEIPT_DOWNLOAD_MAX_TTL_SECONDS * 1000);
    });

    it.each([0, -1, 1.5, RECEIPT_DOWNLOAD_MAX_TTL_SECONDS + 1])('refuses a lifetime of %s seconds', (ttl) => {
      const receipt = newReceipt();
      expect(
        downloadErrorCode(() =>
          createReceiptDownloadGrant({ tokenId: receipt.tokenId, userId: ALICE, ttlSeconds: ttl, now: NOW })
        )
      ).toBe('TTL_EXCEEDED');
    });

    it('refuses to issue a grant for an unknown receipt', () => {
      expect(
        downloadErrorCode(() => createReceiptDownloadGrant({ tokenId: 'RCPT-99999999', userId: ALICE, now: NOW }))
      ).toBe('NOT_FOUND');
    });

    it('refuses to issue a grant without a user', () => {
      const receipt = newReceipt();
      expect(() => createReceiptDownloadGrant({ tokenId: receipt.tokenId, userId: '', now: NOW })).toThrow(/user/);
    });

    describe('tampering is rejected as INVALID', () => {
      const cases: Array<[string, (g: ReturnType<typeof createReceiptDownloadGrant>) => Record<string, unknown>]> = [
        ['another user', (g) => ({ ...g, userId: BOB })],
        ['a later expiry', (g) => ({ ...g, expires: g.expires + 60_000 })],
        ['an earlier issue time', (g) => ({ ...g, iat: g.iat - 1000 })],
        ['another receipt', (g) => ({ ...g, tokenId: 'RCPT-00000000' })],
        ['a malformed signature', (g) => ({ ...g, sig: 'zz' })],
      ];

      it.each(cases)('%s', (_label, mutate) => {
        const receipt = newReceipt();
        const grant = createReceiptDownloadGrant({ tokenId: receipt.tokenId, userId: ALICE, now: NOW });
        const tampered = mutate({ ...grant, tokenId: receipt.tokenId });
        expect(
          downloadErrorCode(() => verifyReceiptDownloadGrant({ ...(tampered as typeof grant), now: NOW + 1000 }))
        ).toBe('INVALID');
      });
    });

    it('rejects a grant after its expiry', () => {
      const receipt = newReceipt();
      const grant = createReceiptDownloadGrant({ tokenId: receipt.tokenId, userId: ALICE, ttlSeconds: 60, now: NOW });
      expect(downloadErrorCode(() => verifyReceiptDownloadGrant({ ...grant, now: grant.expires }))).toBe('EXPIRED');
    });

    it('rejects a grant issued in the future beyond clock skew', () => {
      const receipt = newReceipt();
      const grant = createReceiptDownloadGrant({ tokenId: receipt.tokenId, userId: ALICE, now: NOW + 10 * 60_000 });
      expect(downloadErrorCode(() => verifyReceiptDownloadGrant({ ...grant, now: NOW }))).toBe('INVALID');
    });

    it('fails closed in production when no download secret is configured', () => {
      delete process.env.RECEIPT_DOWNLOAD_SECRET;
      process.env.NODE_ENV = 'production';
      try {
        const receipt = newReceipt();
        expect(() => createReceiptDownloadGrant({ tokenId: receipt.tokenId, userId: ALICE, now: NOW })).toThrow(
          /required in production/
        );
      } finally {
        process.env.RECEIPT_DOWNLOAD_SECRET = 's'.repeat(40);
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('rejects a configured secret shorter than 32 characters', () => {
      process.env.RECEIPT_DOWNLOAD_SECRET = 'short';
      try {
        const receipt = newReceipt();
        expect(() => createReceiptDownloadGrant({ tokenId: receipt.tokenId, userId: ALICE, now: NOW })).toThrow(
          /at least 32/
        );
      } finally {
        process.env.RECEIPT_DOWNLOAD_SECRET = 's'.repeat(40);
      }
    });
  });

  describe('HTTP: download-url and pdf', () => {
    let server: Server;
    let base: string;
    let auditSpy: ReturnType<typeof vi.spyOn>;

    beforeAll(async () => {
      const app = express();
      app.use(express.json());
      app.use('/api/v1/receipts', receiptsRouter);
      app.use(testErrorHandler);
      server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });
      const { port } = server.address() as AddressInfo;
      base = `http://127.0.0.1:${port}/api/v1/receipts`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(() => {
      auditSpy = vi.spyOn(auditService, 'logAction').mockResolvedValue({} as never);
    });

    afterEach(() => {
      auditSpy.mockRestore();
    });

    async function issue(tokenId: string, user: string | undefined, body: unknown = {}) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (user) headers['x-test-user'] = user;
      return fetch(`${base}/${tokenId}/download-url`, { method: 'POST', headers, body: JSON.stringify(body) });
    }

    it('requires authentication to issue a download link', async () => {
      const receipt = newReceipt();
      const res = await issue(receipt.tokenId, undefined);
      expect(res.status).toBe(401);
    });

    it('issues a signed link bound to the caller and audits the issuance', async () => {
      const receipt = newReceipt();
      const res = await issue(receipt.tokenId, ALICE, { ttlSeconds: 120 });
      expect(res.status).toBe(201);

      const body = (await res.json()) as { url: string; expiresAt: string };
      const url = new URL(body.url, 'http://placeholder');
      expect(url.searchParams.get('uid')).toBe(ALICE);
      expect(url.searchParams.get('sig')).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isNaN(Date.parse(body.expiresAt))).toBe(false);

      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: ALICE,
          action: 'receipt.download_url_issued',
          resourceId: receipt.tokenId,
          outcome: 'success',
        })
      );
    });

    it('rejects a lifetime above the maximum with a validation error', async () => {
      const receipt = newReceipt();
      const res = await issue(receipt.tokenId, ALICE, { ttlSeconds: RECEIPT_DOWNLOAD_MAX_TTL_SECONDS + 1 });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_DOWNLOAD_REQUEST');
    });

    it('returns 404 when issuing a link for an unknown receipt', async () => {
      const res = await issue('RCPT-99999998', ALICE);
      expect(res.status).toBe(404);
    });

    it('downloads the PDF with a valid link and audits it against the grant user', async () => {
      const receipt = newReceipt();
      const issued = (await (await issue(receipt.tokenId, ALICE)).json()) as { url: string };
      auditSpy.mockClear();

      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${issued.url}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ALICE, action: 'receipt.download', outcome: 'success', resourceId: receipt.tokenId })
      );
    });

    it('refuses the PDF without a grant and audits the failed attempt', async () => {
      const receipt = newReceipt();
      const res = await fetch(`${base}/${receipt.tokenId}/pdf`);
      expect(res.status).toBe(401);
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'receipt.download', outcome: 'failure', details: { reason: 'INVALID' } })
      );
    });

    it('refuses a link after it has expired', async () => {
      const receipt = newReceipt();
      const grant = createReceiptDownloadGrant({ tokenId: receipt.tokenId, userId: ALICE, ttlSeconds: 1 });
      const qs = new URLSearchParams({ uid: grant.userId, iat: String(grant.iat), expires: String(grant.expires), sig: grant.sig });
      // Wait past expiry using a real (short) delay, since the route reads Date.now().
      await new Promise((r) => setTimeout(r, 1100));
      const res = await fetch(`${base}/${receipt.tokenId}/pdf?${qs}`);
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('RECEIPT_DOWNLOAD_EXPIRED');
    });

    it('refuses a link whose uid was changed to another user', async () => {
      const receipt = newReceipt();
      const issued = (await (await issue(receipt.tokenId, ALICE)).json()) as { url: string };
      const forged = issued.url.replace(`uid=${ALICE}`, `uid=${BOB}`);
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${forged}`);
      expect(res.status).toBe(401);
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({ userId: BOB, action: 'receipt.download', outcome: 'failure' })
      );
    });
  });
});
