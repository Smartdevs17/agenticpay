/** Deterministic per-second payment streams for many recipients (#1386). */
export interface PaymentStream { id: string; sender: string; recipient: string; ratePerSecond: bigint; startAt: number; endAt: number; total: bigint; withdrawn: bigint; }

export class StreamingPayments {
  private readonly streams = new Map<string, PaymentStream>();
  private nextId = 1;

  open(input: Omit<PaymentStream, 'id' | 'withdrawn'>): PaymentStream {
    if (input.ratePerSecond <= 0n || input.endAt <= input.startAt || input.total <= 0n) throw new Error('invalid stream terms');
    const stream = { ...input, id: `stream-${this.nextId++}`, withdrawn: 0n };
    this.streams.set(stream.id, stream);
    return stream;
  }

  accrued(id: string, now = Math.floor(Date.now() / 1000)): bigint {
    const stream = this.require(id);
    const elapsed = BigInt(Math.max(0, Math.min(now, stream.endAt) - stream.startAt));
    const amount = elapsed * stream.ratePerSecond;
    return amount > stream.total ? stream.total : amount;
  }

  settle(id: string, now = Math.floor(Date.now() / 1000)): bigint {
    const stream = this.require(id);
    const amount = this.accrued(id, now) - stream.withdrawn;
    stream.withdrawn += amount;
    return amount;
  }

  settleMany(ids: string[], now = Math.floor(Date.now() / 1000)): Map<string, bigint> {
    return new Map(ids.map((id) => [id, this.settle(id, now)]));
  }

  get(id: string): PaymentStream | undefined { return this.streams.get(id); }
  private require(id: string): PaymentStream { const stream = this.streams.get(id); if (!stream) throw new Error(`stream not found: ${id}`); return stream; }
}
