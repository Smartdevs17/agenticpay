'use client';

import React, { Component, type ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Error boundary for dynamically imported code-split chunks.
 * Catches network or chunk load errors and allows the user to retry loading.
 */
export class ChunkErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ChunkErrorBoundary] Chunk load failed:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20 my-4">
          <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-3">
            <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">
                {this.props.fallbackTitle ?? 'Component could not be loaded'}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                A network glitch prevented this visualization from loading.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={this.handleRetry}
              className="mt-2"
              aria-label="Retry loading visualization"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}
