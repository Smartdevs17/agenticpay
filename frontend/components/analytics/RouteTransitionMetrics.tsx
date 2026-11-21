'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const METRICS_ENDPOINT = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api/v1/analytics/web-vitals`
  : null;

function sendTransitionMetric(from: string, to: string, durationMs: number) {
  if (!METRICS_ENDPOINT) return;

  const payload = {
    name: 'route-transition',
    value: durationMs,
    rating: durationMs <= 200 ? 'good' : durationMs <= 500 ? 'needs-improvement' : 'poor',
    url: to,
    from,
    timestamp: Date.now(),
  };

  if (navigator.sendBeacon) {
    navigator.sendBeacon(METRICS_ENDPOINT, JSON.stringify(payload));
  } else {
    fetch(METRICS_ENDPOINT, { method: 'POST', body: JSON.stringify(payload), keepalive: true }).catch(() => {});
  }
}

/** Times App Router navigations (pathname change -> next paint) and reports them. */
export function RouteTransitionMetrics() {
  const pathname = usePathname();
  const previous = useRef<{ path: string; startedAt: number } | null>(null);

  useEffect(() => {
    const now = performance.now();
    if (previous.current && previous.current.path !== pathname) {
      const duration = now - previous.current.startedAt;
      sendTransitionMetric(previous.current.path, pathname, duration);
    }
    previous.current = { path: pathname, startedAt: now };
  }, [pathname]);

  return null;
}
