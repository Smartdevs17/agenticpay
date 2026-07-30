'use client';

import { useEffect } from 'react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AdminError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error('[admin] Unhandled error:', error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[50vh] p-4">
      <div className="max-w-md w-full rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <h2 className="text-lg font-semibold text-red-600">Admin panel error</h2>
        <p className="mt-2 text-sm text-gray-600">
          {error.message || 'An unexpected error occurred in the admin panel.'}
        </p>
        {error.digest && <p className="mt-2 text-xs text-gray-400 font-mono">Error ID: {error.digest}</p>}
        <button
          onClick={reset}
          className="mt-4 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm hover:bg-gray-50"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
