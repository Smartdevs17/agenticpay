'use client';

import React from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react'; // Added useRef here
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { ErrorBoundary } from '@/components/errors/ErrorBoundary';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const router = useRouter();
  const pathname = usePathname();

  const mainRef = React.useRef<HTMLDivElement>(null);
  const scrollPositions = React.useRef<Record<string, number>>({});

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/auth');
    }
  }, [isAuthenticated, router]);

  // Save scroll position when leaving a page
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const handleScroll = () => {
      scrollPositions.current[pathname] = main.scrollTop;
    };

    main.addEventListener('scroll', handleScroll);
    return () => main.removeEventListener('scroll', handleScroll);
  }, [pathname]);

  // Restore scroll position when arriving at a page
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const saved = scrollPositions.current[pathname];
    main.scrollTop = saved ?? 0;
  }, [pathname]);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden lg:ml-64">
        <Header />
        {/* FIX: Attach mainRef to the main element */}
        <main 
          ref={mainRef} 
          className="flex-1 overflow-y-auto p-4 sm:p-6"
        >
          <ErrorBoundary context="dashboard-page" resetKey={pathname}>
            {children}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}