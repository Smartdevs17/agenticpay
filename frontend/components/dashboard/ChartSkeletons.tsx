'use client';

import { Card, CardContent, CardHeader } from '@/components/ui/card';

/**
 * Lightweight loading skeletons for code-split dashboard chart chunks.
 * Kept in a dedicated module with zero charting-library imports so page
 * bundles can render immediate placeholders without pulling `recharts`
 * into the initial route chunk.
 */

export function AnalyticsChartsSkeleton() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-label="Loading analytics charts"
      aria-busy="true"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardHeader>
              <div className="h-6 w-36 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
            </CardHeader>
            <CardContent>
              <div className="h-[260px] animate-pulse rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <span className="sr-only">Loading visualization...</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[3, 4].map((i) => (
          <Card key={i}>
            <CardHeader>
              <div className="h-6 w-32 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
            </CardHeader>
            <CardContent>
              <div className="h-[220px] animate-pulse rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <span className="sr-only">Loading visualization...</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function RateLimitChartsSkeleton() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-label="Loading rate limit charts"
      aria-busy="true"
    >
      <Card>
        <CardHeader>
          <div className="h-5 w-32 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        </CardHeader>
        <CardContent>
          <div className="h-[220px] animate-pulse rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <span className="sr-only">Loading trend chart...</span>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardHeader>
              <div className="h-5 w-28 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
            </CardHeader>
            <CardContent>
              <div className="h-[180px] animate-pulse rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <span className="sr-only">Loading distribution...</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <div className="h-5 w-28 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        </CardHeader>
        <CardContent>
          <div className="h-[180px] animate-pulse rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <span className="sr-only">Loading endpoint breakdown...</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function PayoutFailureChartsSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-6 lg:grid-cols-2"
      role="status"
      aria-label="Loading payout failure charts"
      aria-busy="true"
    >
      {[1, 2].map((i) => (
        <Card key={i}>
          <CardHeader>
            <div className="h-6 w-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
          </CardHeader>
          <CardContent>
            <div className="h-[260px] animate-pulse rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <span className="sr-only">Loading chart...</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
