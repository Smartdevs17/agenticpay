import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Offline — AgenticPay',
};

// Static (no dynamic data, no auth checks) so the service worker can precache
// it at install time and serve it as the last-resort navigation fallback.
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-4">
        <h1 className="text-xl font-semibold">You&apos;re offline</h1>
        <p className="text-sm text-gray-600">
          This page isn&apos;t available offline yet. Check your connection and try again —
          previously visited pages and queued payments are still available.
        </p>
        <a
          href="/"
          className="inline-block rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          Go to home
        </a>
      </div>
    </div>
  );
}
