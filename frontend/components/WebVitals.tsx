'use client';

import { useReportWebVitals } from 'next/web-vitals';
import { useEffect } from 'react';

const METRICS_ENDPOINT = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api/v1/analytics/web-vitals`
  : null;

const THRESHOLDS: Record<string, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  FID: { good: 100, poor: 300 },
  CLS: { good: 0.1, poor: 0.25 },
  INP: { good: 200, poor: 500 },
  TTFB: { good: 800, poor: 1800 },
};

function sendMetric(name: string, value: number, rating: string) {
  if (!METRICS_ENDPOINT) return;

  const payload = {
    name,
    value,
    rating,
    url: window.location.pathname,
    userAgent: navigator.userAgent,
    timestamp: Date.now(),
    connection: (navigator as any).connection?.effectiveType || 'unknown',
  };

  if (navigator.sendBeacon) {
    navigator.sendBeacon(METRICS_ENDPOINT, JSON.stringify(payload));
  } else {
    fetch(METRICS_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }
}

function getRating(name: string, value: number): string {
  const threshold = THRESHOLDS[name];
  if (!threshold) return 'unknown';
  if (value <= threshold.good) return 'good';
  if (value <= threshold.poor) return 'needs-improvement';
  return 'poor';
}

export function WebVitals() {
  useReportWebVitals(({ name, id, value, rating, delta, navigationType }) => {
    const metricRating = rating || getRating(name, value);
    sendMetric(name, value, metricRating);

    if (metricRating === 'poor') {
      console.warn(`[WebVitals] Poor ${name}: ${value}`, {
        id,
        delta,
        navigationType,
      });
    }
  });

  useEffect(() => {
    if (!('performance' in window) || !('getEntriesByType' in performance)) return;

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'largest-contentful-paint') {
          sendMetric('LCP', entry.startTime, getRating('LCP', entry.startTime));
        }
        if (entry.entryType === 'first-input') {
          const fiEntry = entry as PerformanceEventTiming;
          sendMetric('FID', fiEntry.processingStart - fiEntry.startTime, getRating('FID', fiEntry.processingStart - fiEntry.startTime));
        }
      }
    });

    observer.observe({ type: 'largest-contentful-paint', buffered: true });
    observer.observe({ type: 'first-input', buffered: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
