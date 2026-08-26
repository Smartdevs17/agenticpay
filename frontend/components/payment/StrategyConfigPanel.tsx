'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface StrategyMetrics {
  successCount: number;
  errorCount: number;
  totalLatencyMs: number;
  lastErrorAt?: number;
}

interface Strategy {
  id: string;
  healthy: boolean;
  metrics: StrategyMetrics;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

/** Admin panel: shows every registered payment strategy (Stellar/EVM/fiat/credit), its live health, and routing metrics. */
export function StrategyConfigPanel() {
  const [strategies, setStrategies] = useState<Strategy[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/v1/payment-strategies`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load strategies (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setStrategies(data.strategies);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-sm text-red-600">Failed to load payment strategies: {error}</p>;
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Payment Strategies</h2>
      {!strategies && <p className="text-sm text-gray-500">Loading strategies…</p>}
      {strategies?.map((strategy) => {
        const avgLatency = strategy.metrics.successCount > 0 ? Math.round(strategy.metrics.totalLatencyMs / strategy.metrics.successCount) : null;
        return (
          <Card key={strategy.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base capitalize">{strategy.id}</CardTitle>
              <Badge variant={strategy.healthy ? 'default' : 'destructive'}>
                {strategy.healthy ? 'Healthy' : 'Unhealthy'}
              </Badge>
            </CardHeader>
            <CardContent className="text-sm text-gray-600 flex gap-6">
              <span>Successes: {strategy.metrics.successCount}</span>
              <span>Errors: {strategy.metrics.errorCount}</span>
              <span>Avg latency: {avgLatency !== null ? `${avgLatency}ms` : '—'}</span>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
