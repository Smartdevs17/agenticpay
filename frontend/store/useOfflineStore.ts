'use client';

import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface OfflineState {
  isOnline: boolean;
  queueLength: number;
  isSyncing: boolean;

  setOnline: (online: boolean) => void;
  setQueueLength: (length: number) => void;
  setSyncing: (syncing: boolean) => void;
}

export const useOfflineStore = create<OfflineState>((set) => ({
  isOnline: true,
  queueLength: 0,
  isSyncing: false,

  setOnline: (isOnline) => set({ isOnline }),
  setQueueLength: (queueLength) => set({ queueLength }),
  setSyncing: (isSyncing) => set({ isSyncing }),
}));

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectIsOnline = (s: OfflineState) => s.isOnline;
export const selectQueueLength = (s: OfflineState) => s.queueLength;
export const selectIsSyncing = (s: OfflineState) => s.isSyncing;
