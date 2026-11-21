import { describe, it, expect, vi } from 'vitest';

vi.mock('../../outbox/writer.js', () => ({
  enqueueStoredOutboxEventOutsideTransaction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../events/event-store.js', () => ({
  appendEvent: vi.fn().mockReturnValue({ id: 'evt-1', type: 'test' }),
}));

import {
  mintReceipt,
  batchMintReceipts,
  transferReceipt,
  burnReceipt,
  getReceiptByTokenId,
  getReceiptByPaymentId,
  getReceiptByTxHash,
  getReceiptsByWallet,
  getAllReceipts,
  searchReceipts,
  getReceiptByMerkleRoot,
  verifyReceiptProof,
  verifyReceiptOnChain,
  generateReceiptPdf,
  exportReceipts,
  archiveReceipts,
} from '../receipts.js';

let counter = 0;
const uid = () => `test-${Date.now()}-${counter++}`;

describe('Receipts Service', () => {
  const baseReceipt = () => ({
    paymentId: uid(),
    transactionHash: `0x${uid()}`,
    sender: 'wallet-sender-1',
    recipient: 'wallet-recipient-1',
    amount: 100,
    currency: 'USDC',
  });

  describe('mintReceipt', () => {
    it('mints a receipt with correct fields', () => {
      const receipt = mintReceipt(baseReceipt());
      expect(receipt.tokenId).toMatch(/^RCPT-\d{8}$/);
      expect(receipt.amount).toBe(100);
      expect(receipt.currency).toBe('USDC');
      expect(receipt.burned).toBe(false);
      expect(receipt.archived).toBe(false);
      expect(receipt.metadata.name).toContain(receipt.tokenId);
    });

    it('builds merkle proof', () => {
      const receipt = mintReceipt(baseReceipt());
      expect(receipt.merkleRoot).toBeDefined();
      expect(receipt.merkleProof.length).toBeGreaterThan(0);
      expect(verifyReceiptProof(receipt)).toBe(true);
    });

    it('rejects duplicate paymentId', () => {
      const input = baseReceipt();
      mintReceipt(input);
      expect(() => mintReceipt(input)).toThrow();
    });

    it('defaults currency to USD when not provided', () => {
      const receipt = mintReceipt({ ...baseReceipt(), currency: undefined, asset: undefined });
      expect(receipt.currency).toBe('USD');
    });
  });

  describe('batchMintReceipts', () => {
    it('mints multiple receipts', () => {
      const receipts = batchMintReceipts({
        receipts: [baseReceipt(), baseReceipt(), baseReceipt()],
      });
      expect(receipts).toHaveLength(3);
      expect(receipts[0].tokenId).not.toBe(receipts[1].tokenId);
    });
  });

  describe('Lookups', () => {
    it('finds receipt by token id', () => {
      const receipt = mintReceipt(baseReceipt());
      expect(getReceiptByTokenId(receipt.tokenId)?.paymentId).toBe(receipt.paymentId);
    });

    it('finds receipt by payment id', () => {
      const input = baseReceipt();
      const receipt = mintReceipt(input);
      expect(getReceiptByPaymentId(input.paymentId)?.tokenId).toBe(receipt.tokenId);
    });

    it('finds receipt by tx hash', () => {
      const input = baseReceipt();
      const receipt = mintReceipt(input);
      expect(getReceiptByTxHash(input.transactionHash)?.tokenId).toBe(receipt.tokenId);
    });

    it('finds receipts by wallet', () => {
      mintReceipt(baseReceipt());
      mintReceipt(baseReceipt());
      const receipts = getReceiptsByWallet('wallet-recipient-1');
      expect(receipts.length).toBeGreaterThanOrEqual(2);
    });

    it('finds receipt by merkle root', () => {
      const receipt = mintReceipt(baseReceipt());
      expect(getReceiptByMerkleRoot(receipt.merkleRoot)?.tokenId).toBe(receipt.tokenId);
    });

    it('returns undefined for missing receipt', () => {
      expect(getReceiptByTokenId('nonexistent')).toBeUndefined();
    });
  });

  describe('transferReceipt', () => {
    it('transfers receipt to new owner', () => {
      const receipt = mintReceipt(baseReceipt());
      const transferred = transferReceipt(receipt.tokenId, 'wallet-new-owner');
      expect(transferred.owner).toBe('wallet-new-owner');
    });

    it('cannot transfer burned receipt', () => {
      const receipt = mintReceipt(baseReceipt());
      burnReceipt(receipt.tokenId);
      expect(() => transferReceipt(receipt.tokenId, 'wallet-new')).toThrow();
    });
  });

  describe('burnReceipt', () => {
    it('burns receipt', () => {
      const receipt = mintReceipt(baseReceipt());
      const burned = burnReceipt(receipt.tokenId);
      expect(burned.burned).toBe(true);
      expect(burned.burnedAt).toBeDefined();
    });

    it('cannot burn twice', () => {
      const receipt = mintReceipt(baseReceipt());
      burnReceipt(receipt.tokenId);
      expect(() => burnReceipt(receipt.tokenId)).toThrow();
    });
  });

  describe('searchReceipts', () => {
    it('filters by currency', () => {
      mintReceipt({ ...baseReceipt(), currency: 'ETH' });
      mintReceipt({ ...baseReceipt(), currency: 'BTC' });
      const results = searchReceipts({ currency: 'ETH' });
      expect(results.every((r) => r.currency === 'ETH')).toBe(true);
    });

    it('filters by date range', () => {
      const receipt = mintReceipt(baseReceipt());
      const results = searchReceipts({
        from: '2020-01-01',
        to: new Date(Date.parse(receipt.timestamp) + 10000).toISOString(),
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by wallet', () => {
      mintReceipt(baseReceipt());
      const results = searchReceipts({ wallet: 'wallet-sender-1' });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('archiveReceipts', () => {
    it('archives old receipts', () => {
      const receipt = mintReceipt({ ...baseReceipt(), timestamp: '2020-01-01T00:00:00.000Z' });
      const archived = archiveReceipts('2025-01-01T00:00:00.000Z');
      expect(archived.length).toBeGreaterThanOrEqual(1);
      const check = getReceiptByTokenId(receipt.tokenId);
      expect(check?.archived).toBe(true);
    });
  });

  describe('verifyReceiptOnChain', () => {
    it('validates receipt', () => {
      const receipt = mintReceipt(baseReceipt());
      const result = verifyReceiptOnChain(receipt);
      expect(result.valid).toBe(true);
      expect(result.txHash).toBeDefined();
    });
  });

  describe('generateReceiptPdf', () => {
    it('generates a PDF buffer', () => {
      const receipt = mintReceipt(baseReceipt());
      const pdf = generateReceiptPdf(receipt);
      expect(pdf).toBeInstanceOf(Buffer);
      expect(pdf.toString()).toContain('%PDF-1.4');
    });
  });

  describe('exportReceipts', () => {
    it('exports as JSON', () => {
      mintReceipt(baseReceipt());
      const json = exportReceipts('json');
      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json as string);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('exports as CSV', () => {
      mintReceipt(baseReceipt());
      const csv = exportReceipts('csv');
      expect(csv).toBeInstanceOf(Buffer);
      expect(csv.toString()).toContain('tokenId,paymentId');
    });
  });

  describe('getAllReceipts', () => {
    it('returns all non-burned receipts by default', () => {
      mintReceipt(baseReceipt());
      const r2 = mintReceipt(baseReceipt());
      burnReceipt(r2.tokenId);
      const all = getAllReceipts(false);
      expect(all.every((r) => !r.burned)).toBe(true);
    });

    it('includes burned when flag is true', () => {
      const r1 = mintReceipt(baseReceipt());
      burnReceipt(r1.tokenId);
      const all = getAllReceipts(true);
      expect(all.some((r) => r.burned)).toBe(true);
    });
  });
});
