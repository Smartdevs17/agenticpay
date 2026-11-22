'use client';

import { CloudOff, RefreshCw, Wifi } from 'lucide-react';
import { useOfflineStatus } from './OfflineProvider';
import { assertNever } from '@/components/common/discriminated-union';

export type OfflineBannerVariant =
  | { state: 'syncing'; queueLength: number }
  | { state: 'queued'; queueLength: number }
  | { state: 'offline'; queueLength: number }
  | { state: 'idle' };

export function resolveOfflineVariant(
  isOnline: boolean,
  queueLength: number,
  isSyncing: boolean,
): OfflineBannerVariant {
  if (isSyncing) {
    return { state: 'syncing', queueLength };
  }
  if (!isOnline) {
    return { state: 'offline', queueLength };
  }
  if (queueLength > 0) {
    return { state: 'queued', queueLength };
  }
  return { state: 'idle' };
}

export function OfflineBanner() {
  const { isOnline, queueLength, isSyncing } = useOfflineStatus();
  const variant = resolveOfflineVariant(isOnline, queueLength, isSyncing);

  switch (variant.state) {
    case 'idle':
      return null;
    case 'syncing':
      return (
        <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 shadow-lg">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>Syncing {variant.queueLength} queued action{variant.queueLength === 1 ? '' : 's'}</span>
        </div>
      );
    case 'queued':
      return (
        <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 shadow-lg">
          <Wifi className="h-4 w-4" />
          <span>{variant.queueLength} queued action{variant.queueLength === 1 ? '' : 's'} ready to sync</span>
        </div>
      );
    case 'offline':
      return (
        <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 shadow-lg">
          <CloudOff className="h-4 w-4" />
          <span>
            Offline mode enabled{variant.queueLength > 0 ? `, ${variant.queueLength} action${variant.queueLength === 1 ? '' : 's'} queued` : ''}
          </span>
        </div>
      );
    default: {
      const _exhaustive: never = variant;
      return assertNever(_exhaustive);
    }
  }
}
