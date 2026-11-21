export interface Invoice { id: string; debtor: string; faceValue: bigint; dueAt: number; status: 'open' | 'funded' | 'settled'; }
export interface Bid { bidder: string; discountBps: number; fundedAt: string; }

export class InvoiceFactoringService {
  private readonly invoices = new Map<string, Invoice>();
  private readonly bids = new Map<string, Bid[]>();
  addInvoice(invoice: Invoice) { if (invoice.faceValue <= 0n || this.invoices.has(invoice.id)) throw new Error('invalid invoice'); this.invoices.set(invoice.id, invoice); return invoice; }
  bid(invoiceId: string, bidder: string, discountBps: number): Bid {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice || invoice.status !== 'open') throw new Error('invoice is not available');
    if (discountBps <= 0 || discountBps >= 10_000) throw new Error('discount must be between 1 and 9999 bps');
    const bid = { bidder, discountBps, fundedAt: new Date().toISOString() };
    this.bids.set(invoiceId, [...(this.bids.get(invoiceId) ?? []), bid]);
    return bid;
  }
  bestBid(invoiceId: string) { return [...(this.bids.get(invoiceId) ?? [])].sort((a, b) => a.discountBps - b.discountBps)[0]; }
  advance(invoiceId: string): Bid { const bid = this.bestBid(invoiceId); const invoice = this.invoices.get(invoiceId); if (!bid || !invoice) throw new Error('no bid available'); invoice.status = 'funded'; return bid; }
  proceeds(invoiceId: string): bigint { const invoice = this.invoices.get(invoiceId); const bid = this.bestBid(invoiceId); if (!invoice || !bid) throw new Error('no bid available'); return invoice.faceValue * BigInt(10_000 - bid.discountBps) / 10_000n; }
}
