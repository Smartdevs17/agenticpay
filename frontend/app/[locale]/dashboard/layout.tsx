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
