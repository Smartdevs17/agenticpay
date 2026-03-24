'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useThemeStore } from '@/store/useThemeStore';
import { useRouter } from 'next/navigation';
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
import { Bell, LogOut, User, Settings, Sun, Moon, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useDisconnect } from 'wagmi';
import { web3auth } from '@/lib/web3auth';
import { ThemeSettingsModal } from '@/components/theme/ThemeSettingsModal';

export function Header() {
  const { name, email, address, logout } = useAuthStore();
  const { isDark, mode, toggle, setIsDark } = useThemeStore();
  const { disconnect } = useDisconnect();
  const router = useRouter();
  const [themeSettingsOpen, setThemeSettingsOpen] = useState(false);

  const handleLogout = async () => {
    disconnect();
    if (web3auth) {
      await web3auth.logout();
    }
    logout();
    toast.success('Logged out successfully');
    router.push('/auth');
  };

  const handleManualToggle = () => {
    const next = !isDark;
    setIsDark(next);
    // Apply to DOM immediately (ThemeProvider's effect will also fire)
    document.documentElement.classList.toggle('dark', next);
  };

  const initials =
    name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'U';

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : 'Not connected';

  return (
    <>
      <header className="sticky top-0 z-30 w-full bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700/60 transition-colors duration-700">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
              Dashboard
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Notifications */}
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            </Button>

            {/* Dark mode toggle — only interactive label when manual */}
            <Button
              variant="ghost"
              size="icon"
              onClick={mode === 'manual' ? handleManualToggle : undefined}
              title={
                mode === 'manual'
                  ? isDark
                    ? 'Switch to light mode'
                    : 'Switch to dark mode'
                  : `Auto: ${mode} mode`
              }
              className="relative"
            >
              {isDark ? (
                <Moon className="h-5 w-5 transition-transform duration-300" />
              ) : (
                <Sun className="h-5 w-5 transition-transform duration-300" />
              )}
              {mode !== 'manual' && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary flex items-center justify-center">
                  <Clock className="h-2 w-2 text-primary-foreground" />
                </span>
              )}
            </Button>

            {/* Theme schedule settings */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setThemeSettingsOpen(true)}
              title="Dark mode schedule"
            >
              <Clock className="h-5 w-5" />
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
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <ThemeSettingsModal open={themeSettingsOpen} onClose={() => setThemeSettingsOpen(false)} />
    </>
  );
}
