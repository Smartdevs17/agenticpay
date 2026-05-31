'use client';

/**
 * Root providers — intentionally minimal.
 * Only Toaster lives here so it's available on every page (landing, auth, dashboard).
 * WagmiProvider and QueryClientProvider are scoped to the dashboard layout
 * via DashboardProviders to avoid loading wagmi/viem on the landing page.
 */

import { Toaster } from '@/components/ui/sonner';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
