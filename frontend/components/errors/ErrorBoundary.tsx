'use client';

import {
  Component,
  Fragment,
  ReactNode,
  ErrorInfo,
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
  context?: string;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  resetCount: number;
}

declare global {
  interface Window {
    Sentry?: {
      captureException?: (
        error: Error,
        context?: {
          extra?: Record<string, unknown>;
          tags?: Record<string, string>;
        }
      ) => void;
    };
    reportError?: (error: Error) => void;
  }
}

function logErrorToMonitoring(error: Error, errorInfo: ErrorInfo, context?: string) {
  window.Sentry?.captureException?.(error, {
    extra: { componentStack: errorInfo.componentStack },
    tags: context ? { boundary: context } : undefined,
  });
  window.reportError?.(error);
  console.error('Error caught by boundary:', error, errorInfo);
}

// ─── Default fallback UI ──────────────────────────────────────────────────────

function DefaultFallback({ error, onReset }: { error: Error | null; onReset: () => void }) {
  return (
    <div className="flex min-h-[400px] items-center justify-center p-6">
      <Card className="w-full max-w-lg border-red-200 shadow-sm">
        <CardHeader className="items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <AlertCircle className="h-6 w-6 text-red-500" />
          </div>
          <CardTitle>We hit a problem loading this page</CardTitle>
          <CardDescription>
            Something unexpected happened. You can try again, and if it keeps happening our team can
            investigate it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
            {error?.message || 'An unexpected error occurred.'}
          </p>
        </CardContent>
        <CardFooter className="justify-center">
          <Button onClick={onReset}>Retry</Button>
        </CardFooter>
      </Card>
    </div>
  );
}

// ─── Context for functional consumers ────────────────────────────────────────

interface ErrorBoundaryContextValue {
  resetBoundary: () => void;
}

const ErrorBoundaryContext = createContext<ErrorBoundaryContextValue | null>(null);

/** Access the nearest error boundary's reset function from any functional component. */
export function useErrorBoundary(): ErrorBoundaryContextValue {
  const ctx = useContext(ErrorBoundaryContext);
  if (!ctx) {
    throw new Error('useErrorBoundary must be used inside an <ErrorBoundary>');
  }
  return ctx;
}

// ─── Class boundary (React requires a class for getDerivedStateFromError) ────

class InternalErrorBoundary extends Component<
  ErrorBoundaryProps & { onReset: () => void },
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps & { onReset: () => void }) {
    super(props);
    this.state = { hasError: false, error: null, resetCount: 0 };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, resetCount: 0 };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps & { onReset: () => void }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.resetBoundary();
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logErrorToMonitoring(error, errorInfo, this.props.context);
  }

  resetBoundary = () => {
    this.props.onReset();
    this.setState((s) => ({ hasError: false, error: null, resetCount: s.resetCount + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <DefaultFallback error={this.state.error} onReset={this.resetBoundary} />
        )
      );
    }
    return (
      <Fragment key={this.state.resetCount}>
        <ErrorBoundaryContext.Provider value={{ resetBoundary: this.resetBoundary }}>
          {this.props.children}
        </ErrorBoundaryContext.Provider>
      </Fragment>
    );
  }
}

// ─── Public functional wrapper ────────────────────────────────────────────────

export function ErrorBoundary({ children, resetKey, context, fallback }: ErrorBoundaryProps) {
  const [resetToken, setResetToken] = useState(0);
  const handleReset = useCallback(() => setResetToken((t) => t + 1), []);

  return (
    <InternalErrorBoundary
      key={resetToken}
      resetKey={resetKey}
      context={context}
      fallback={fallback}
      onReset={handleReset}
    >
      {children}
    </InternalErrorBoundary>
  );
}

// ─── withErrorBoundary HOC ────────────────────────────────────────────────────

export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  boundaryProps?: Omit<ErrorBoundaryProps, 'children'>
) {
  const displayName = WrappedComponent.displayName ?? WrappedComponent.name ?? 'Component';

  function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary {...boundaryProps}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  }

  WithErrorBoundary.displayName = `withErrorBoundary(${displayName})`;
  return WithErrorBoundary;
}

// ─── useComponentError hook ───────────────────────────────────────────────────

/**
 * Lets functional components trigger the nearest error boundary imperatively.
 * Usage: const { throwError } = useComponentError(); throwError(new Error('oops'));
 */
export function useComponentError() {
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  const throwError = useCallback((err: Error) => setError(err), []);
  return { throwError };
}
