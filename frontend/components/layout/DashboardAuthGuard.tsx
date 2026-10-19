'use client';

import React, { useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { ErrorBoundary } from '@/components/errors/ErrorBoundary';
import { SidebarProvider, useSidebar } from '@/contexts/SidebarContext';
import { cn } from '@/lib/utils';

function DashboardContent({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const router = useRouter();
  const pathname = usePathname();
  const { isCollapsed } = useSidebar();

  const mainRef = React.useRef<HTMLDivElement>(null);
  const scrollPositions = React.useRef<Record<string, number>>({});

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/auth');
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const handleScroll = () => {
      scrollPositions.current[pathname] = main.scrollTop;
    };
    main.addEventListener('scroll', handleScroll);
    return () => main.removeEventListener('scroll', handleScroll);
  }, [pathname]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const saved = scrollPositions.current[pathname];
    main.scrollTop = saved ?? 0;
  }, [pathname]);

  if (!isAuthenticated) return null;

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className={cn('flex-1 flex flex-col overflow-hidden transition-all duration-200', isCollapsed ? 'lg:ml-20' : 'lg:ml-64')}>
        <Header />
        <main ref={mainRef} className="flex-1 overflow-y-auto p-4 sm:p-6">
          <ErrorBoundary context="dashboard-page" resetKey={pathname}>
            {children}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export function DashboardAuthGuard({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <DashboardContent>{children}</DashboardContent>
    </SidebarProvider>
  );
}
