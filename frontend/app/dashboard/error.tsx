'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error('[dashboard] Unhandled error:', error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Card className="max-w-md w-full">
        <CardHeader className="flex flex-row items-center gap-3">
          <AlertCircle className="h-6 w-6 text-red-600" aria-hidden="true" />
          <CardTitle className="text-red-600">Something went wrong</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            {error.message || 'An unexpected error occurred in the dashboard.'}
          </p>
          {error.digest && (
            <p className="text-xs text-gray-400 font-mono">Error ID: {error.digest}</p>
          )}
          <Button onClick={reset} variant="outline" className="w-full">
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
