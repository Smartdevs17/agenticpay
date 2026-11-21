import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebSocketStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface PresenceUser {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  cursorField?: string;
  lastSeenAt: string;
}

export interface CollabEvent {
  type: string;
  payload: unknown;
  timestamp: number;
}

export interface WebSocketMetrics {
  messagesReceived: number;
  messagesSent: number;
  reconnectCount: number;
  connectedSince: number | null;
  lastEventAt: number | null;
}

export interface WebSocketSlice {
  status: WebSocketStatus;
  error: string | null;
  activeChannels: string[];
  presence: PresenceUser[];
  recentEvents: CollabEvent[];
  lockedFields: Record<string, string>;
  sessionVersion: number;
  metrics: WebSocketMetrics;

  // Actions
  setStatus: (status: WebSocketStatus, error?: string) => void;
  addChannel: (channel: string) => void;
  removeChannel: (channel: string) => void;
  setPresence: (users: PresenceUser[]) => void;
  upsertPresenceUser: (user: PresenceUser) => void;
  removePresenceUser: (userId: string) => void;
  pushEvent: (event: CollabEvent) => void;
  setLockedFields: (fields: Record<string, string>) => void;
  setFieldLocked: (fieldPath: string, userId: string) => void;
  setFieldUnlocked: (fieldPath: string) => void;
  setSessionVersion: (version: number) => void;
  incrementSent: () => void;
  reset: () => void;
}

const MAX_RECENT_EVENTS = 150;

const initialMetrics = (): WebSocketMetrics => ({
  messagesReceived: 0,
  messagesSent: 0,
  reconnectCount: 0,
  connectedSince: null,
  lastEventAt: null,
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWebSocketStore = create<WebSocketSlice>()((set) => ({
  status: 'idle',
  error: null,
  activeChannels: [],
  presence: [],
  recentEvents: [],
  lockedFields: {},
  sessionVersion: 0,
  metrics: initialMetrics(),

  setStatus: (status, error) =>
    set((s) => ({
      status,
      error: error ?? (status !== 'error' ? null : s.error),
      metrics: {
        ...s.metrics,
        connectedSince: status === 'connected' ? Date.now() : s.metrics.connectedSince,
        reconnectCount:
          status === 'reconnecting' ? s.metrics.reconnectCount + 1 : s.metrics.reconnectCount,
      },
    })),

  addChannel: (channel) =>
    set((s) => ({
      activeChannels: s.activeChannels.includes(channel)
        ? s.activeChannels
        : [...s.activeChannels, channel],
    })),

  removeChannel: (channel) =>
    set((s) => ({ activeChannels: s.activeChannels.filter((c) => c !== channel) })),

  setPresence: (users) => set(() => ({ presence: users })),

  upsertPresenceUser: (user) =>
    set((s) => {
      const next = s.presence.filter((u) => u.userId !== user.userId);
      return { presence: [...next, user] };
    }),

  removePresenceUser: (userId) =>
    set((s) => ({ presence: s.presence.filter((u) => u.userId !== userId) })),

  pushEvent: (event) =>
    set((s) => {
      const next = [...s.recentEvents, event];
      return {
        recentEvents: next.length > MAX_RECENT_EVENTS ? next.slice(-MAX_RECENT_EVENTS) : next,
        metrics: {
          ...s.metrics,
          messagesReceived: s.metrics.messagesReceived + 1,
          lastEventAt: event.timestamp,
        },
      };
    }),

  setLockedFields: (fields) => set(() => ({ lockedFields: fields })),

  setFieldLocked: (fieldPath, userId) =>
    set((s) => ({ lockedFields: { ...s.lockedFields, [fieldPath]: userId } })),

  setFieldUnlocked: (fieldPath) =>
    set((s) => {
      const next = { ...s.lockedFields };
      delete next[fieldPath];
      return { lockedFields: next };
    }),

  setSessionVersion: (version) => set(() => ({ sessionVersion: version })),

  incrementSent: () =>
    set((s) => ({
      metrics: { ...s.metrics, messagesSent: s.metrics.messagesSent + 1 },
    })),

  reset: () =>
    set(() => ({
      status: 'idle',
      error: null,
      activeChannels: [],
      presence: [],
      recentEvents: [],
      lockedFields: {},
      sessionVersion: 0,
      metrics: initialMetrics(),
    })),
}));

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectIsConnected = (s: WebSocketSlice) => s.status === 'connected';
export const selectActiveUserCount = (s: WebSocketSlice) => s.presence.length;
export const selectFieldOwner = (fieldPath: string) => (s: WebSocketSlice) =>
  s.lockedFields[fieldPath] ?? null;
export const selectEventsByType = (type: string) => (s: WebSocketSlice) =>
  s.recentEvents.filter((e) => e.type === type);
export const selectUptimeSeconds = (s: WebSocketSlice) =>
  s.metrics.connectedSince ? Math.floor((Date.now() - s.metrics.connectedSince) / 1000) : 0;
