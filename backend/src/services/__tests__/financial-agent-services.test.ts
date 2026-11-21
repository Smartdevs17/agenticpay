import { describe, expect, it } from 'vitest';
import { merkleRoot, ReceiptAnchorService } from '../receiptAnchor.js';
import { SpendGuard } from '../spendGuard.js';
import { InvoiceFactoringService } from '../factoring.js';

const receipt = (id: string) => ({ id, payer: 'payer', payee: 'payee', amount: 10n, currency: 'XLM', issuedAt: 1 });

describe('receipt anchors', () => {
  it('commits and verifies a merkle batch', () => { const service = new ReceiptAnchorService(); const batch = service.anchor('batch-1', [receipt('r1'), receipt('r2')]); expect(batch.merkleRoot).toBe(merkleRoot([receipt('r1'), receipt('r2')])); expect(service.verify([receipt('r1'), receipt('r2')], batch.merkleRoot)).toBe(true); });
});

describe('autonomous spend controls', () => {
  it('enforces per-agent transaction and daily ceilings', () => { const guard = new SpendGuard(); guard.setPolicy({ agentId: 'agent-1', perTransactionCeiling: 50n, dailyCeiling: 100n }); guard.authorize('agent-1', 50n); expect(() => guard.authorize('agent-1', 51n)).toThrow(); expect(() => guard.authorize('agent-1', 50n)).not.toThrow(); expect(() => guard.authorize('agent-1', 1n)).toThrow(); });
});

describe('invoice factoring', () => {
  it('selects the lowest discount bid and computes proceeds', () => { const service = new InvoiceFactoringService(); service.addInvoice({ id: 'inv-1', debtor: 'merchant', faceValue: 100_000n, dueAt: 200, status: 'open' }); service.bid('inv-1', 'funder-a', 500); service.bid('inv-1', 'funder-b', 250); expect(service.advance('inv-1').bidder).toBe('funder-b'); expect(service.proceeds('inv-1')).toBe(97_500n); });
});
