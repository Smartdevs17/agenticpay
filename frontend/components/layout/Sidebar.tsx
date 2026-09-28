'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Folder, FileText, Wallet, Scale, Menu, X, QrCode, ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/contexts/SidebarContext';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Projects', href: '/dashboard/projects', icon: Folder },
  { name: 'Invoices', href: '/dashboard/invoices', icon: FileText },
  { name: 'Payments', href: '/dashboard/payments', icon: Wallet },
  { name: 'QR / NFC Pay', href: '/dashboard/payments/qr', icon: QrCode },
  { name: 'Disputes', href: '/dashboard/disputes', icon: Scale },
  { name: 'Identity (KYC)', href: '/dashboard/kyc', icon: ShieldCheck },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { isCollapsed, setIsCollapsed } = useSidebar();

  return (
    <>
      {/* Mobile menu button */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="bg-white shadow-lg"
          aria-label={isMobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={isMobileOpen}
          aria-controls="sidebar-navigation"
        >
          {isMobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </Button>
      </div>

      {/* Sidebar */}
      <aside
        id="sidebar-navigation"
        role="navigation"
        aria-label="Main navigation"
        className={cn(
          'fixed inset-y-0 left-0 z-40 bg-white border-r border-gray-200 transform transition-all duration-200 ease-in-out lg:translate-x-0',
          isCollapsed ? 'w-20' : 'w-64',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className={cn('flex items-center gap-2 px-6 py-6 border-b border-gray-200 justify-between', isCollapsed && 'px-3')}>
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="w-8 h-8 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 flex items-center justify-center flex-shrink-0"
                role="img"
                aria-label="AgenticPay logo"
              >
                <Wallet className="h-5 w-5 text-white" aria-hidden="true" />
              </div>
              {!isCollapsed && <span className="text-xl font-bold text-gray-900 truncate">AgenticPay</span>}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="hidden lg:flex"
              onClick={() => setIsCollapsed(!isCollapsed)}
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
            </Button>
          </div>

          {/* Navigation */}
          <nav className={cn('flex-1 py-6 space-y-1', isCollapsed ? 'px-2' : 'px-4')}>
            {navigation.map((item) => {
              const isActive =
                item.href === '/dashboard'
                  ? pathname === item.href
                  : pathname === item.href || pathname?.startsWith(item.href + '/');

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onMouseEnter={() => router.prefetch(item.href)}
                  onFocus={() => router.prefetch(item.href)}
                  onClick={() => setIsMobileOpen(false)}
                  title={isCollapsed ? item.name : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500',
                    isCollapsed ? 'px-2 py-3 justify-center' : 'px-4 py-3',
                    isActive
                      ? 'bg-gradient-to-r from-blue-50 to-purple-50 text-blue-700 border border-blue-100'
                      : 'text-gray-700 hover:bg-gray-50'
                  )}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <item.icon
                    className={cn('h-5 w-5 flex-shrink-0', isActive ? 'text-blue-600' : 'text-gray-500')}
                    aria-hidden="true"
                  />
                  {!isCollapsed && <span className="truncate">{item.name}</span>}
                </Link>
              );
            })}
          </nav>

          {/* User section */}
          <div className={cn('py-4 border-t border-gray-200', isCollapsed ? 'px-2' : 'px-4')}>
            <div
              className={cn('rounded-lg bg-gray-50', isCollapsed ? 'px-2 py-3 flex justify-center' : 'px-4 py-3 flex items-center gap-3')}
              role="region"
              aria-label="User information"
            >
              <div
                className={cn('rounded-full bg-gradient-to-r from-blue-500 to-purple-500 flex items-center justify-center text-white font-semibold flex-shrink-0', isCollapsed ? 'w-8 h-8 text-xs' : 'w-10 h-10')}
                aria-hidden="true"
              >
                JD
              </div>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">John Doe</p>
                  <p className="text-xs text-gray-500 truncate">Freelancer</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile overlay */}
        {isMobileOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={() => setIsMobileOpen(false)}
            aria-hidden="true"
          />
        )}
      </aside>
    </>
  );
}
