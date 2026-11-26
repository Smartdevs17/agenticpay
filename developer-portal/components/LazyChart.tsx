'use client';

import React, {
  Component,
  Suspense,
  useCallback,
  useMemo,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { LazyChartController, type ChartDefinition } from '../app/charts/lazy-chart-registry';

export type ChartLoader = () => Promise<{ default: ComponentType<Record<string, never>> }>;

export interface LazyChartProps {
  chart: ChartDefinition;
  load: ChartLoader;
  controller: LazyChartController;
}

interface BoundaryProps {
  children: ReactNode;
  label: string;
  onError(error: Error, info: ErrorInfo): void;
  onRetry(): void;
}

interface BoundaryState {
  hasError: boolean;
}

class ChartErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError(error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-lg border border-amber-200 bg-amber-50/70 p-6 text-center dark:border-amber-800 dark:bg-amber-950/20"
          role="alert"
          aria-label={`${this.props.label} chart failed to load`}
        >
          <p className="font-medium text-gray-900 dark:text-white">{this.props.label} chart could not be loaded</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            A network glitch prevented this visualization from loading.
          </p>
          <button
            type="button"
            onClick={this.props.onRetry}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-white dark:border-gray-600 dark:text-gray-200"
          >
            Retry chart
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ChartSkeleton({ chart }: { chart: ChartDefinition }) {
  return (
    <div
      className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
      role="status"
      aria-label={`Loading ${chart.label} chart`}
      aria-busy="true"
    >
      <div className="h-5 w-40 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
      <div className="h-56 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
    </div>
  );
}

function LazyChartContent({ chart, load, controller }: LazyChartProps) {
  const Chart = useMemo(
    () => React.lazy(() => controller.load(chart.id, load)),
    [chart.id, controller, load],
  );

  return (
    <Suspense fallback={<ChartSkeleton chart={chart} />}>
      <Chart />
    </Suspense>
  );
}

export function LazyChart(props: LazyChartProps) {
  const [attempt, setAttempt] = useState(0);

  const handleError = useCallback(
    (error: Error, info: ErrorInfo) => {
      props.controller.reportRenderError(props.chart.id, error, { componentStack: info.componentStack });
    },
    [props.chart.id, props.controller],
  );

  const handleRetry = useCallback(() => {
    props.controller.reset(props.chart.id);
    setAttempt((value) => value + 1);
  }, [props.chart.id, props.controller]);

  return (
    <ChartErrorBoundary
      key={attempt}
      label={props.chart.label}
      onError={handleError}
      onRetry={handleRetry}
    >
      <LazyChartContent {...props} />
    </ChartErrorBoundary>
  );
}

export default LazyChart;
