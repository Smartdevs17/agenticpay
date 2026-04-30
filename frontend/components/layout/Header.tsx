'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useRouter, usePathname } from 'next/navigation';
import { useThemeStore } from '@/store/useThemeStore';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

import { 
  Bell, 
  LogOut, 
  User, 
  Settings, 
  Sun, 
  Moon, 
  Clock, 
  Menu, 
  Search,
  RefreshCw,
  CloudOff
} from 'lucide-react';
import { Bell, LogOut, User, Settings, Sun, Moon, Clock, CloudOff, RefreshCw, Menu } from 'lucide-react';

import { toast } from 'sonner';
import { useDisconnect, useAccount } from 'wagmi';
import { web3auth } from '@/lib/web3auth';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { getDashboardBreadcrumbs } from '@/lib/breadcrumbs';
import { ThemeSettingsModal } from '@/components/theme/ThemeSettingsModal';
import { TimezoneSettingsModal } from '@/components/settings/TimezoneSettingsModal';
import { getBrowserTimeZone, isValidTimeZone } from '@/lib/utils';
import { CommandMenu } from './CommandMenu';

import { useCommandStore } from '@/store/useCommandStore';
import { useOfflineStatus } from '@/components/offline/OfflineProvider';


import { useOfflineStatus } from '@/components/offline/OfflineProvider';

type BreadcrumbItemType = {
  label: string;
  href: string;
};

/* ---------------- NETWORK INDICATOR ---------------- */

const NetworkIndicator = () => {
  const { chain, isConnected } = useAccount();

  if (!isConnected) return null;

  if (!chain) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] sm:text-xs font-bold border border-red-200 uppercase tracking-tight">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
        Error
      </div>
    );
  }

  const isTestnet = chain.testnet === true;
  const bgColor = isTestnet
    ? 'bg-yellow-100 text-yellow-800 border-yellow-200'
    : 'bg-green-100 text-green-800 border-green-200';
  const dotColor = isTestnet ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[10px] sm:text-xs font-bold uppercase tracking-tight ${bgColor}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`}></span>
      <span className="truncate max-w-[60px] sm:max-w-none">{chain.name}</span>
    </div>
  );
};

export function Header({ onMenuClick }: { onMenuClick: () => void }) {

  const { name, address, timezone, logout, setTimezone, email } = useAuthStore();
  const { name, email, address, timezone, logout, setTimezone } = useAuthStore();
  const { isDark, mode, setIsDark } = useThemeStore();
  const { open: openSearch } = useCommandStore();
  const { disconnect } = useDisconnect();
  const { isOnline, queueLength, isSyncing } = useOfflineStatus();
  const router = useRouter();
  const pathname = usePathname();

  const [breadcrumbs, setBreadcrumbs] = useState<{label: string; href: string}[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItemType[]>([]);
  const [themeSettingsOpen, setThemeSettingsOpen] = useState(false);
  const [timezoneSettingsOpen, setTimezoneSettingsOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs(getDashboardBreadcrumbs(pathname));
  }, [pathname]);

  useEffect(() => {
    if (timezone) return;
    const detectedTimeZone = getBrowserTimeZone();
    if (detectedTimeZone && isValidTimeZone(detectedTimeZone)) {
      setTimezone(detectedTimeZone);
    if (!timezone) {
      const detectedTimeZone = getBrowserTimeZone();
      if (detectedTimeZone && isValidTimeZone(detectedTimeZone)) {
        setTimezone(detectedTimeZone);
      }
    }
  }, [setTimezone, timezone]);

  const handleLogout = async () => {
    disconnect();
    if (web3auth) await web3auth.logout();
    logout();
    toast.success('Logged out successfully');
    router.push('/auth');
  };

  const handleManualToggle = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
  };

  const initials = name?.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || 'U';
  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected';

  return (
    <>
      <header className="sticky top-0 z-30 w-full bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700/60 transition-colors duration-700">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6">
          {/* LEFT */}

          <div className="flex items-center gap-2 sm:gap-4">
            <Button variant="ghost" size="icon" className="md:hidden -ml-2" onClick={onMenuClick}>
              <Menu className="h-5 w-5" />
            </Button>
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-3">
              <h1 className="text-base sm:text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent truncate max-w-[100px] sm:max-w-none">
                Dashboard
              </h1>
            </div>
          </div>

          {/* RIGHT */}
          <div className="flex items-center gap-1.5 sm:gap-3">
            {(!isOnline || queueLength > 0 || isSyncing) && (
              <div className="hidden sm:flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/50">
                {isSyncing ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CloudOff className="h-3.5 w-3.5" />
                )}
                <span>
                  {isSyncing
                    ? `Syncing ${queueLength}`
                    : !isOnline
                      ? `Offline${queueLength > 0 ? ` - ${queueLength} queued` : ''}`
                      : `${queueLength} queued`}
                </span>
              </div>
            )}

            <NetworkIndicator />
            
            <div className="hidden sm:block">
              <CommandMenu />
            </div>
            
            <Button variant="ghost" size="icon" className="sm:hidden" onClick={openSearch}>
              <Search className="h-4 w-4 text-gray-500" />
            </Button>

            <Button variant="ghost" size="icon" className="hidden sm:flex h-9 w-9">
              <Bell className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            </Button>
            
            <Button variant="ghost" size="icon" className="flex h-9 w-9" onClick={mode === 'manual' ? handleManualToggle : undefined}>
              {isDark ? <Moon className="h-4 w-4 text-gray-500 dark:text-gray-400" /> : <Sun className="h-4 w-4 text-gray-500 dark:text-gray-400" />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2 h-9 px-1.5 sm:px-2 rounded-full sm:rounded-lg">
                  <Avatar className="h-7 w-7 sm:h-8 sm:w-8">
                    <AvatarFallback className="bg-gradient-to-r from-blue-500 to-purple-500 text-white text-[10px] sm:text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="hidden lg:block text-left">
                    <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">{name || 'User'}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-none">{shortAddress}</p>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-semibold">{name || 'User'}</p>
                    <p className="text-xs text-gray-500 truncate">{email || 'No email'}</p>
                    <p className="text-[10px] text-gray-400 font-mono mt-1">{address}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" /> Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTimezoneSettingsOpen(true)}>
                  <Clock className="mr-2 h-4 w-4" /> Timezone: {timezone}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setThemeSettingsOpen(true)}>
                  <Settings className="mr-2 h-4 w-4" /> Theme Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                  <LogOut className="mr-2 h-4 w-4" /> Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick}>
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-lg sm:text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent truncate max-w-[120px] sm:max-w-none">
              Dashboard
            </h1>
          </div>

          {/* RIGHT */}
          <div className="flex items-center gap-4">
            <NetworkIndicator />
            
            <div className="flex items-center gap-2">
              {(!isOnline || queueLength > 0 || isSyncing) && (
                <div className="hidden sm:flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900">
                  {isSyncing ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CloudOff className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {isSyncing
                      ? `Syncing ${queueLength}`
                      : !isOnline
                        ? `Offline${queueLength > 0 ? ` - ${queueLength} queued` : ''}`
                        : `${queueLength} queued`}
                  </span>
                </div>
              )}

              <CommandMenu />

              <Button variant="ghost" size="icon" className="relative hidden sm:flex">
                <Bell className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={mode === 'manual' ? handleManualToggle : undefined}
                className="relative hidden sm:flex"
              >
                {isDark ? <Moon className="h-5 w-5 text-gray-500 dark:text-gray-400" /> : <Sun className="h-5 w-5 text-gray-500 dark:text-gray-400" />}
              </Button>

              <Button variant="ghost" size="icon" className="hidden md:flex" onClick={() => setThemeSettingsOpen(true)}>
                <Clock className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              </Button>

              {/* User menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-3 h-auto py-2 px-3">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-gradient-to-r from-blue-500 to-purple-500 text-white">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="hidden sm:block text-left">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {name || 'User'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{shortAddress}</p>
                    </div>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium">{name || 'User'}</p>
                      <p className="text-xs text-gray-500">{email || 'No email'}</p>
                      <p className="text-xs text-gray-400 font-mono">{shortAddress}</p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <User className="mr-2 h-4 w-4" /> Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTimezoneSettingsOpen(true)}>
                    <Settings className="mr-2 h-4 w-4" /> Timezone Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                    <LogOut className="mr-2 h-4 w-4" /> Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {breadcrumbs.length > 0 && (
          <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 px-4 sm:px-6 py-2 overflow-x-auto no-scrollbar">
            <Breadcrumb>
              <BreadcrumbList className="flex-nowrap whitespace-nowrap">
                {breadcrumbs.map((item, index) => (
                  <div key={index} className="flex items-center gap-1.5 flex-shrink-0">
                    <BreadcrumbItem>
                      <BreadcrumbLink href={item.href} className="text-xs">{item.label}</BreadcrumbLink>
                      <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink
                    </BreadcrumbItem>
                    {index < breadcrumbs.length - 1 && <BreadcrumbSeparator className="text-[10px]" />}
                  </div>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        )}
      </header>

      <ThemeSettingsModal open={themeSettingsOpen} onClose={() => setThemeSettingsOpen(false)} />
      <TimezoneSettingsModal open={timezoneSettingsOpen} onClose={() => setTimezoneSettingsOpen(false)} />
    </>
  );
}