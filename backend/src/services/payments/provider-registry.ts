import type { PaymentProvider, ProviderMetrics } from './providers/types.js';

function emptyMetrics(): ProviderMetrics {
  return { successCount: 0, errorCount: 0, totalLatencyMs: 0 };
}

export class PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();
  private readonly metrics = new Map<string, ProviderMetrics>();

  register(provider: PaymentProvider): void {
    this.providers.set(provider.id, provider);
    if (!this.metrics.has(provider.id)) {
      this.metrics.set(provider.id, emptyMetrics());
    }
  }

  get(id: string): PaymentProvider | undefined {
    return this.providers.get(id);
  }

  getMetrics(id: string): ProviderMetrics {
    return this.metrics.get(id) ?? emptyMetrics();
  }

  recordSuccess(id: string, latencyMs: number): void {
    const m = this.metrics.get(id) ?? emptyMetrics();
    m.successCount += 1;
    m.totalLatencyMs += latencyMs;
    this.metrics.set(id, m);
  }

  recordError(id: string): void {
    const m = this.metrics.get(id) ?? emptyMetrics();
    m.errorCount += 1;
    m.lastErrorAt = Date.now();
    this.metrics.set(id, m);
  }

  async listHealthy(): Promise<string[]> {
    const checks = await Promise.allSettled(
      Array.from(this.providers.entries()).map(async ([id, p]) => ({ id, healthy: await p.healthCheck() })),
    );
    return checks
      .filter((r): r is PromiseFulfilledResult<{ id: string; healthy: boolean }> => r.status === 'fulfilled' && r.value.healthy)
      .map((r) => r.value.id);
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }

  allMetrics(): Record<string, ProviderMetrics> {
    const out: Record<string, ProviderMetrics> = {};
    for (const [id, m] of this.metrics) out[id] = { ...m };
    return out;
  }
}

export const providerRegistry = new PaymentProviderRegistry();
