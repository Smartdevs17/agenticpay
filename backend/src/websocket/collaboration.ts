/**
 * Real-Time Collaborative Editing WebSocket Handler
 *
 * Handles operational transform (OT)-based synchronization for project
 * configuration edits. Supports presence indicators, conflict resolution,
 * edit history with per-user attribution, and critical section locking.
 *
 * Uses Redis pub/sub (stubbed) to broadcast across multiple server instances.
 */

import { randomUUID } from 'node:crypto';
import type { Server as SocketIOServer, Socket } from 'socket.io';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditOperation {
  id: string;
  projectId: string;
  userId: string;
  path: string[];       // JSON path to the field being edited, e.g. ["webhookUrl"]
  type: 'set' | 'delete' | 'append' | 'increment';
  value?: unknown;
  previousValue?: unknown;
  timestamp: string;
  version: number;      // Monotonic version for OT ordering
}

export interface PresenceState {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  cursorField?: string; // Which field the user is currently editing
  lastSeenAt: string;
  connectionId: string;
}

export interface ProjectEditHistory {
  id: string;
  projectId: string;
  operations: EditOperation[];
  createdAt: string;
}

export interface CollabSession {
  projectId: string;
  participants: Map<string, PresenceState>;
  version: number;
  pendingOps: EditOperation[];
  lockedFields: Map<string, string>; // field path → userId holding lock
}

// ---------------------------------------------------------------------------
// In-memory session store (replace with Redis in production)
// ---------------------------------------------------------------------------

const sessions = new Map<string, CollabSession>();
const editHistory = new Map<string, EditOperation[]>(); // projectId → ops

function getOrCreateSession(projectId: string): CollabSession {
  if (!sessions.has(projectId)) {
    sessions.set(projectId, {
      projectId,
      participants: new Map(),
      version: 0,
      pendingOps: [],
      lockedFields: new Map(),
    });
  }
  return sessions.get(projectId)!;
}

// ---------------------------------------------------------------------------
// Operational Transform helpers
// ---------------------------------------------------------------------------

function applyOperation(
  session: CollabSession,
  op: EditOperation
): { applied: boolean; transformed?: EditOperation } {
  // Simple last-write-wins OT for scalar fields
  // Full OT (e.g. Yjs) would be used in production
  if (op.version < session.version) {
    // Stale op — transform by bumping version, keep value
    const transformed: EditOperation = { ...op, version: session.version + 1 };
    session.version++;
    storeHistory(session.projectId, transformed);
    return { applied: true, transformed };
  }

  session.version++;
  const withVersion: EditOperation = { ...op, version: session.version };
  storeHistory(session.projectId, withVersion);
  return { applied: true, transformed: withVersion };
}

function storeHistory(projectId: string, op: EditOperation): void {
  if (!editHistory.has(projectId)) editHistory.set(projectId, []);
  editHistory.get(projectId)!.push(op);
}

// ---------------------------------------------------------------------------
// Lock service
// ---------------------------------------------------------------------------

const CRITICAL_FIELDS = new Set(['apiKey', 'webhookUrl', 'signingSecret', 'stripeKey']);

function isCriticalField(fieldPath: string[]): boolean {
  return fieldPath.some((seg) => CRITICAL_FIELDS.has(seg));
}

function acquireLock(session: CollabSession, fieldPath: string, userId: string): boolean {
  const existing = session.lockedFields.get(fieldPath);
  if (existing && existing !== userId) return false;
  session.lockedFields.set(fieldPath, userId);
  return true;
}

function releaseLock(session: CollabSession, fieldPath: string, userId: string): void {
  if (session.lockedFields.get(fieldPath) === userId) {
    session.lockedFields.delete(fieldPath);
  }
}

// ---------------------------------------------------------------------------
// Socket.IO room management
// ---------------------------------------------------------------------------

function projectRoom(projectId: string): string {
  return `collab:project:${projectId}`;
}

// ---------------------------------------------------------------------------
// Main collaboration handler
// ---------------------------------------------------------------------------

export function registerCollaborationHandlers(io: SocketIOServer): void {
  const collabNs = io.of('/collaboration');

  collabNs.on('connection', (socket: Socket & { userId?: string; projectId?: string }) => {
    const userId = (socket.handshake.auth.userId as string) || randomUUID();
    const displayName = (socket.handshake.auth.displayName as string) || `User ${userId.slice(0, 6)}`;
    const avatarUrl = socket.handshake.auth.avatarUrl as string | undefined;

    socket.userId = userId;

    // ── join-project ────────────────────────────────────────────────────────

    socket.on('join-project', (projectId: string) => {
      socket.projectId = projectId;
      void socket.join(projectRoom(projectId));

      const session = getOrCreateSession(projectId);
      const presence: PresenceState = {
        userId,
        displayName,
        avatarUrl,
        lastSeenAt: new Date().toISOString(),
        connectionId: socket.id,
      };
      session.participants.set(userId, presence);

      // Send current session state to the joining user
      socket.emit('session-state', {
        version: session.version,
        participants: Array.from(session.participants.values()),
        lockedFields: Object.fromEntries(session.lockedFields),
        history: (editHistory.get(projectId) ?? []).slice(-50),
      });

      // Broadcast updated presence to others in the room
      socket.to(projectRoom(projectId)).emit('presence-update', {
        type: 'join',
        user: presence,
        participants: Array.from(session.participants.values()),
      });
    });

    // ── cursor-move ─────────────────────────────────────────────────────────

    socket.on('cursor-move', (data: { projectId: string; fieldPath: string }) => {
      const session = sessions.get(data.projectId);
      if (!session) return;

      const presence = session.participants.get(userId);
      if (presence) {
        presence.cursorField = data.fieldPath;
        presence.lastSeenAt = new Date().toISOString();
      }

      socket.to(projectRoom(data.projectId)).emit('remote-cursor', {
        userId,
        fieldPath: data.fieldPath,
      });
    });

    // ── operation ────────────────────────────────────────────────────────────

    socket.on('operation', (rawOp: Omit<EditOperation, 'id' | 'userId' | 'timestamp'>) => {
      const projectId = socket.projectId;
      if (!projectId) return;

      const session = getOrCreateSession(projectId);

      // Check critical section lock
      const fieldKey = rawOp.path.join('.');
      if (isCriticalField(rawOp.path)) {
        const lockHolder = session.lockedFields.get(fieldKey);
        if (lockHolder && lockHolder !== userId) {
          socket.emit('operation-rejected', {
            reason: 'field_locked',
            lockedBy: lockHolder,
            field: fieldKey,
          });
          return;
        }
      }

      const op: EditOperation = {
        ...rawOp,
        id: randomUUID(),
        userId,
        timestamp: new Date().toISOString(),
      };

      const { applied, transformed } = applyOperation(session, op);

      if (applied && transformed) {
        // Acknowledge to sender
        socket.emit('operation-ack', { operationId: op.id, version: transformed.version });
        // Broadcast to other participants
        socket.to(projectRoom(projectId)).emit('remote-operation', transformed);
      }
    });

    // ── acquire-lock ─────────────────────────────────────────────────────────

    socket.on('acquire-lock', (data: { projectId: string; fieldPath: string }) => {
      const session = getOrCreateSession(data.projectId);
      const granted = acquireLock(session, data.fieldPath, userId);

      socket.emit('lock-result', { fieldPath: data.fieldPath, granted, userId });

      if (granted) {
        socket.to(projectRoom(data.projectId)).emit('field-locked', {
          fieldPath: data.fieldPath,
          lockedBy: userId,
        });
      }
    });

    // ── release-lock ─────────────────────────────────────────────────────────

    socket.on('release-lock', (data: { projectId: string; fieldPath: string }) => {
      const session = sessions.get(data.projectId);
      if (!session) return;

      releaseLock(session, data.fieldPath, userId);
      collabNs.to(projectRoom(data.projectId)).emit('field-unlocked', {
        fieldPath: data.fieldPath,
      });
    });

    // ── rollback ─────────────────────────────────────────────────────────────

    socket.on('rollback', (data: { projectId: string; toVersion: number }) => {
      const history = editHistory.get(data.projectId) ?? [];
      const snapshot = history.filter((op) => op.version <= data.toVersion);
      socket.emit('rollback-snapshot', { version: data.toVersion, operations: snapshot });
    });

    // ── offline-sync ─────────────────────────────────────────────────────────

    socket.on('offline-ops', (data: { projectId: string; ops: EditOperation[] }) => {
      const session = getOrCreateSession(data.projectId);
      const results: EditOperation[] = [];

      for (const op of data.ops) {
        const { transformed } = applyOperation(session, { ...op, userId });
        if (transformed) results.push(transformed);
      }

      socket.emit('offline-sync-complete', { applied: results.length, ops: results });
      socket.to(projectRoom(data.projectId)).emit('bulk-remote-operations', results);
    });

    // ── disconnect ────────────────────────────────────────────────────────────

    socket.on('disconnect', () => {
      const projectId = socket.projectId;
      if (!projectId) return;

      const session = sessions.get(projectId);
      if (!session) return;

      session.participants.delete(userId);

      // Release any locks held by this user
      for (const [field, holder] of session.lockedFields) {
        if (holder === userId) {
          session.lockedFields.delete(field);
          collabNs.to(projectRoom(projectId)).emit('field-unlocked', { fieldPath: field });
        }
      }

      collabNs.to(projectRoom(projectId)).emit('presence-update', {
        type: 'leave',
        userId,
        participants: Array.from(session.participants.values()),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Query helpers (for REST endpoints)
// ---------------------------------------------------------------------------

export function getEditHistory(projectId: string, limit = 100): EditOperation[] {
  return (editHistory.get(projectId) ?? []).slice(-limit);
}

export function getSessionParticipants(projectId: string): PresenceState[] {
  const session = sessions.get(projectId);
  if (!session) return [];
  return Array.from(session.participants.values());
}

export function getLockedFields(projectId: string): Record<string, string> {
  const session = sessions.get(projectId);
  if (!session) return {};
  return Object.fromEntries(session.lockedFields);
}
