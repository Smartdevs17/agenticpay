'use client';

import { useAuthStore } from '@/store/useAuthStore';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { DashboardProviders } from '@/components/providers-dashboard';
import { ErrorBoundary } from '@/components/errors/ErrorBoundary';

// Sidebar and Header are dashboard-only — load them as part of the dashboard
// chunk rather than the root bundle.
const Sidebar = dynamic(
  () => import('@/components/layout/Sidebar').then((m) => m.Sidebar),
  { ssr: false }
);
const Header = dynamic(
  () => import('@/components/layout/Header').then((m) => m.Header),
  { ssr: false }
);

// PWA components are non-critical — load after the dashboard is interactive.
const PWAWrapper = dynamic(() => import('@/components/PWAWrapper'), {
  ssr: false,
});

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/auth');
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <DashboardProviders>
      <ErrorBoundary>
        <div className="flex h-screen bg-gray-50">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden lg:ml-64">
            <Header />
            <main className="flex-1 overflow-y-auto p-4 sm:p-6">
              <ErrorBoundary>{children}</ErrorBoundary>
            </main>
          </div>
        </div>
        <PWAWrapper />
      </ErrorBoundary>
    </DashboardProviders>
  );
}
