import { createHash } from 'node:crypto';

export interface Receipt { id: string; payer: string; payee: string; amount: bigint; currency: string; issuedAt: number; }
export interface ReceiptBatch { id: string; receiptIds: string[]; merkleRoot: string; committedAt: string; }

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const leaf = (receipt: Receipt) => hash([receipt.id, receipt.payer, receipt.payee, receipt.amount.toString(), receipt.currency, receipt.issuedAt].join('|'));

export function merkleRoot(receipts: Receipt[]): string {
  if (!receipts.length) throw new Error('cannot anchor an empty batch');
  let level = receipts.map(leaf);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(hash(level[i]! + (level[i + 1] ?? level[i]!)));
    level = next;
  }
  return level[0]!;
}

export class ReceiptAnchorService {
  private readonly batches = new Map<string, ReceiptBatch>();
  anchor(id: string, receipts: Receipt[]): ReceiptBatch {
    if (!id || this.batches.has(id)) throw new Error('batch id must be unique');
    const batch = { id, receiptIds: receipts.map((receipt) => receipt.id), merkleRoot: merkleRoot(receipts), committedAt: new Date().toISOString() };
    this.batches.set(id, batch);
    return batch;
  }
  get(id: string) { return this.batches.get(id); }
  verify(receipts: Receipt[], root: string) { return merkleRoot(receipts) === root; }
}
