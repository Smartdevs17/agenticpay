
'use client';

import React, { useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import { useEffect, useRef } from 'react'; // Added useRef here
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

  /* ================================
     ✅ STEP 1: SIDEBAR STATE (NEW)
  ================================= */
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = () => {
    setSidebarOpen((prev) => !prev);
  };

  /* ================================
     EXISTING SCROLL LOGIC (UNCHANGED)
  ================================= */
  const mainRef = React.useRef<HTMLDivElement>(null);
  const scrollPositions = React.useRef<Record<string, number>>({});

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/auth');
    }
  }, [isAuthenticated, router]);

  // Save scroll position
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const handleScroll = () => {
      scrollPositions.current[pathname] = main.scrollTop;
    };

    main.addEventListener('scroll', handleScroll);
    return () => main.removeEventListener('scroll', handleScroll);
  }, [pathname]);

  // Restore scroll position
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
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
      {/* ✅ Sidebar now controlled */}
      <Sidebar
        isOpen={sidebarOpen}
        toggleSidebar={toggleSidebar}
      />

      <div className="flex flex-1 flex-col min-w-0">
        {/* ✅ Header can open sidebar */}
        <Header onMenuClick={toggleSidebar} />

        <main
          ref={mainRef}
          className="flex-1 overflow-y-auto p-4 sm:p-6 min-w-0"
        >
          <ErrorBoundary context="dashboard-page" resetKey={pathname}>
            {children}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
import type { Metadata } from 'next';
import { DashboardAuthGuard } from '@/components/layout/DashboardAuthGuard';

export const metadata: Metadata = {
  title: {
    template: '%s | AgenticPay Dashboard',
    default: 'Dashboard | AgenticPay',
  },
  description: 'Manage your projects, invoices, payments, and real-time analytics.',
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardAuthGuard>{children}</DashboardAuthGuard>;
}
