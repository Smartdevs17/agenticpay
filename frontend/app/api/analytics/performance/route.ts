/**
 * Performance Analytics Collection Endpoint
 * Collects Core Web Vitals and performance metrics from frontend clients
 */

import { NextRequest, NextResponse } from 'next/server';

export interface PerformanceReport {
  metrics: {
    webVitals: {
      lcp?: number;
      fid?: number;
      cls?: number;
      ttfb?: number;
      fcp?: number;
    };
    navigation: {
      domContentLoaded: number;
      loadComplete: number;
      timeToFirstByte: number;
    };
    resources: {
      totalSize: number;
      jsSize: number;
      cssSize: number;
      imageSize: number;
    };
    pageLoad: {
      startTime: number;
      endTime: number;
      duration: number;
    };
    timestamp: string;
  };
  url: string;
  userAgent: string;
}

const metricsBuffer: PerformanceReport[] = [];
const BUFFER_SIZE = 100;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as PerformanceReport;

    // Validate required fields
    if (!body.metrics || !body.url) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Add to buffer
    metricsBuffer.push(body);

    // Flush if buffer is full
    if (metricsBuffer.length >= BUFFER_SIZE) {
      await flushMetrics();
    }

    return NextResponse.json(
      { success: true, buffered: metricsBuffer.length },
      { status: 202 }
    );
  } catch (error) {
    console.error('Error collecting performance metrics:', error);
    return NextResponse.json(
      { error: 'Failed to collect metrics' },
      { status: 500 }
    );
  }
}

/**
 * Flush metrics to persistent storage or monitoring service
 */
async function flushMetrics() {
  if (metricsBuffer.length === 0) return;

  try {
    const metrics = [...metricsBuffer];
    metricsBuffer.length = 0;

    // Aggregate metrics
    const aggregated = aggregateMetrics(metrics);

    // Log summary
    console.log('[Performance Analytics]', {
      count: metrics.length,
      avgLcp: aggregated.avgLcp,
      avgFid: aggregated.avgFid,
      avgCls: aggregated.avgCls,
      avgPageLoadTime: aggregated.avgPageLoadTime,
      cacheHitRate: aggregated.cacheHitRate,
      timestamp: new Date().toISOString(),
    });

    // TODO: Send to external monitoring service (e.g., Sentry, DataDog, custom backend)
    // await fetch('https://monitoring.example.com/api/metrics', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ metrics: aggregated })
    // });
  } catch (error) {
    console.error('Error flushing performance metrics:', error);
  }
}

/**
 * Aggregate metrics for analysis
 */
function aggregateMetrics(metrics: PerformanceReport[]) {
  const vitals = metrics.map((m) => m.metrics.webVitals);
  const pageTimes = metrics.map((m) => m.metrics.pageLoad.duration);
  const resourceSizes = metrics.map((m) => m.metrics.resources.totalSize);

  const getAvg = (values: (number | undefined)[]) => {
    const filtered = values.filter((v) => v !== undefined) as number[];
    return filtered.length > 0
      ? filtered.reduce((a, b) => a + b, 0) / filtered.length
      : 0;
  };

  return {
    avgLcp: Math.round(getAvg(vitals.map((v) => v.lcp))),
    avgFid: Math.round(getAvg(vitals.map((v) => v.fid))),
    avgCls: Math.round(getAvg(vitals.map((v) => v.cls)) * 1000) / 1000,
    avgTtfb: Math.round(getAvg(vitals.map((v) => v.ttfb))),
    avgFcp: Math.round(getAvg(vitals.map((v) => v.fcp))),
    avgPageLoadTime: Math.round(getAvg(pageTimes)),
    avgResourceSize: Math.round(getAvg(resourceSizes)),
    p95Lcp: Math.round(percentile(vitals.map((v) => v.lcp || 0), 95)),
    p95PageLoad: Math.round(percentile(pageTimes, 95)),
    cacheHitRate: calculateCacheHitRate(metrics),
    errorRate: calculateErrorRate(metrics),
  };
}

/**
 * Calculate percentile
 */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] || 0;
}

/**
 * Estimate cache hit rate from bundle sizes
 */
function calculateCacheHitRate(metrics: PerformanceReport[]): number {
  // Rough estimate based on page load time vs resource size
  const avgLoadTime = metrics.reduce((sum, m) => sum + m.metrics.pageLoad.duration, 0) / metrics.length;
  const avgResourceSize = metrics.reduce((sum, m) => sum + m.metrics.resources.totalSize, 0) / metrics.length;

  // If load time is much faster than expected for size, likely good cache
  const bytesPerMs = avgResourceSize / avgLoadTime;
  return Math.min(100, Math.round((bytesPerMs / 1000) * 100));
}

/**
 * Calculate error rate (resources that failed to load)
 */
function calculateErrorRate(metrics: PerformanceReport[]): number {
  // This is a simplified calculation - would need actual error data from client
  return 0;
}

/**
 * Schedule periodic metrics flush (every 5 minutes)
 */
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    flushMetrics().catch(console.error);
  }, 5 * 60 * 1000);
}
