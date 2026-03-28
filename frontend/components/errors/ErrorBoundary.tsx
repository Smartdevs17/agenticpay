'use client';

import { Component, Fragment, ReactNode, ErrorInfo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
  resetKey?: string;
  context?: string;
}

interface State {
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
    extra: {
      componentStack: errorInfo.componentStack,
    },
    tags: context ? { boundary: context } : undefined,
  });

  window.reportError?.(error);
  console.error('Error caught by boundary:', error, errorInfo);
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, resetCount: 0 };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, resetCount: 0 };
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.resetBoundary();
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logErrorToMonitoring(error, errorInfo, this.props.context);
  }

  resetBoundary = () => {
    this.setState((currentState) => ({
      hasError: false,
      error: null,
      resetCount: currentState.resetCount + 1,
    }));
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[400px] items-center justify-center p-6">
          <Card className="w-full max-w-lg border-red-200 shadow-sm">
            <CardHeader className="items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
                <AlertCircle className="h-6 w-6 text-red-500" />
              </div>
              <CardTitle>We hit a problem loading this page</CardTitle>
              <CardDescription>
                Something unexpected happened. You can try again, and if it keeps happening our team can investigate it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
                {this.state.error?.message || 'An unexpected error occurred.'}
              </p>
            </CardContent>
            <CardFooter className="justify-center">
              <Button onClick={this.resetBoundary}>
                Retry
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return <Fragment key={this.state.resetCount}>{this.props.children}</Fragment>;
  }
}

