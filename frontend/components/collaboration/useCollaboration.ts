/**
 * useCollaboration hook
 *
 * Manages WebSocket connection to the collaboration namespace, applies
 * incoming remote operations, tracks presence, and handles offline queuing.
 */

'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CollabUser {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  cursorField?: string;
  lastSeenAt: string;
  connectionId: string;
}

export type OperationType = 'set' | 'delete' | 'append' | 'increment';

export interface EditOperation {
  id?: string;
  projectId: string;
  path: string[];
  type: OperationType;
  value?: unknown;
  previousValue?: unknown;
  version: number;
}

export interface SessionState {
  version: number;
  participants: CollabUser[];
  lockedFields: Record<string, string>;
  history: EditOperation[];
}

export interface UseCollaborationOptions {
  projectId: string;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  serverUrl?: string;
  onRemoteOperation?: (op: EditOperation) => void;
  onPresenceChange?: (participants: CollabUser[]) => void;
}

export interface UseCollaborationReturn {
  isConnected: boolean;
  participants: CollabUser[];
  lockedFields: Record<string, string>;
  currentVersion: number;
  sendOperation: (op: Omit<EditOperation, 'projectId' | 'version'>) => void;
  moveCursor: (fieldPath: string) => void;
  acquireLock: (fieldPath: string) => Promise<boolean>;
  releaseLock: (fieldPath: string) => void;
  rollbackTo: (version: number) => void;
  editHistory: EditOperation[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCollaboration({
  projectId,
  userId,
  displayName,
  avatarUrl,
  serverUrl = '',
  onRemoteOperation,
  onPresenceChange,
}: UseCollaborationOptions): UseCollaborationReturn {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [participants, setParticipants] = useState<CollabUser[]>([]);
  const [lockedFields, setLockedFields] = useState<Record<string, string>>({});
  const [currentVersion, setCurrentVersion] = useState(0);
  const [editHistory, setEditHistory] = useState<EditOperation[]>([]);

  // Offline queue — ops sent while disconnected
  const offlineQueueRef = useRef<EditOperation[]>([]);
  const versionRef = useRef(0);

  // ---------------------------------------------------------------------------
  // Connect
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const socket = io(`${serverUrl}/collaboration`, {
      auth: { userId, displayName, avatarUrl },
      transports: ['websocket'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      socket.emit('join-project', projectId);

      // Flush offline queue
      if (offlineQueueRef.current.length > 0) {
        socket.emit('offline-ops', { projectId, ops: offlineQueueRef.current });
        offlineQueueRef.current = [];
      }
    });

    socket.on('disconnect', () => setIsConnected(false));

    socket.on('session-state', (state: SessionState) => {
      setParticipants(state.participants);
      setLockedFields(state.lockedFields);
      setCurrentVersion(state.version);
      versionRef.current = state.version;
      setEditHistory(state.history);
    });

    socket.on('presence-update', (data: { participants: CollabUser[] }) => {
      setParticipants(data.participants);
      onPresenceChange?.(data.participants);
    });

    socket.on('remote-operation', (op: EditOperation) => {
      versionRef.current = op.version;
      setCurrentVersion(op.version);
      setEditHistory((prev) => [...prev, op]);
      onRemoteOperation?.(op);
    });

    socket.on('bulk-remote-operations', (ops: EditOperation[]) => {
      if (ops.length > 0) {
        const latest = ops[ops.length - 1];
        versionRef.current = latest.version;
        setCurrentVersion(latest.version);
        setEditHistory((prev) => [...prev, ...ops]);
        ops.forEach((op) => onRemoteOperation?.(op));
      }
    });

    socket.on('operation-ack', (data: { version: number }) => {
      versionRef.current = data.version;
      setCurrentVersion(data.version);
    });

    socket.on('field-locked', (data: { fieldPath: string; lockedBy: string }) => {
      setLockedFields((prev) => ({ ...prev, [data.fieldPath]: data.lockedBy }));
    });

    socket.on('field-unlocked', (data: { fieldPath: string }) => {
      setLockedFields((prev) => {
        const next = { ...prev };
        delete next[data.fieldPath];
        return next;
      });
    });

    socket.on('rollback-snapshot', (data: { version: number; operations: EditOperation[] }) => {
      setEditHistory(data.operations);
      setCurrentVersion(data.version);
      versionRef.current = data.version;
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, userId]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const sendOperation = useCallback(
    (op: Omit<EditOperation, 'projectId' | 'version'>) => {
      const fullOp: EditOperation = {
        ...op,
        projectId,
        version: versionRef.current,
      };

      if (socketRef.current?.connected) {
        socketRef.current.emit('operation', fullOp);
      } else {
        offlineQueueRef.current.push(fullOp);
      }
    },
    [projectId]
  );

  const moveCursor = useCallback(
    (fieldPath: string) => {
      socketRef.current?.emit('cursor-move', { projectId, fieldPath });
    },
    [projectId]
  );

  const acquireLock = useCallback(
    (fieldPath: string): Promise<boolean> =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) { resolve(false); return; }

        socket.once('lock-result', (data: { fieldPath: string; granted: boolean }) => {
          if (data.fieldPath === fieldPath) resolve(data.granted);
        });

        socket.emit('acquire-lock', { projectId, fieldPath });
      }),
    [projectId]
  );

  const releaseLock = useCallback(
    (fieldPath: string) => {
      socketRef.current?.emit('release-lock', { projectId, fieldPath });
    },
    [projectId]
  );

  const rollbackTo = useCallback(
    (version: number) => {
      socketRef.current?.emit('rollback', { projectId, toVersion: version });
    },
    [projectId]
  );

  return {
    isConnected,
    participants,
    lockedFields,
    currentVersion,
    sendOperation,
    moveCursor,
    acquireLock,
    releaseLock,
    rollbackTo,
    editHistory,
  };
}
