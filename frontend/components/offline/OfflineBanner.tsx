'use client';

import { CloudOff, RefreshCw, Wifi } from 'lucide-react';
import { useOfflineStatus } from './OfflineProvider';

export function OfflineBanner() {
  const { isOnline, queueLength, isSyncing } = useOfflineStatus();

  if (isOnline && queueLength === 0 && !isSyncing) {
    return null;
  }

  const icon = isSyncing ? (
    <RefreshCw className="h-4 w-4 animate-spin" />
  ) : isOnline ? (
    <Wifi className="h-4 w-4" />
  ) : (
    <CloudOff className="h-4 w-4" />
  );

  const message = isSyncing
    ? `Syncing ${queueLength} queued action${queueLength === 1 ? '' : 's'}`
    : isOnline
      ? `${queueLength} queued action${queueLength === 1 ? '' : 's'} ready to sync`
      : `Offline mode enabled${queueLength > 0 ? `, ${queueLength} action${queueLength === 1 ? '' : 's'} queued` : ''}`;

  return (
    <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 shadow-lg">
      {icon}
      <span>{message}</span>
    </div>
  );
}
