import { randomUUID } from 'node:crypto';

export interface Session {
  id: string;
  userId: string;
  deviceId: string;
  browser: string;
  os: string;
  ip: string;
  lastActive: string;
  isTrusted: boolean;
  status: 'active' | 'terminated';
  createdAt: string;
}

const sessions: Map<string, Session> = new Map();
const MAX_CONCURRENT_SESSIONS = 5;

/**
 * Creates a new session for a user.
 * If concurrent limits are exceeded, terminates the oldest session.
 */
export function createSession(userId: string, metadata: { deviceId: string; browser: string; os: string; ip: string }): Session {
  const userSessions = getUserSessions(userId);
  
  if (userSessions.length >= MAX_CONCURRENT_SESSIONS) {
    const oldest = userSessions.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
    terminateSession(oldest.id);
  }

  const session: Session = {
    id: `sess_${randomUUID()}`,
    userId,
    ...metadata,
    lastActive: new Date().toISOString(),
    isTrusted: false,
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  sessions.set(session.id, session);
  return session;
}

/**
 * Gets all active sessions for a user.
 */
export function getUserSessions(userId: string): Session[] {
  return Array.from(sessions.values()).filter(s => s.userId === userId && s.status === 'active');
}

/**
 * Gets a specific session.
 */
export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

/**
 * Terminates a specific session.
 */
export function terminateSession(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (session) {
    session.status = 'terminated';
    return true;
  }
  return false;
}

/**
 * Terminates all other sessions for a user except the current one.
 */
export function terminateOtherSessions(userId: string, currentSessionId: string): number {
  let count = 0;
  sessions.forEach(session => {
    if (session.userId === userId && session.id !== currentSessionId && session.status === 'active') {
      session.status = 'terminated';
      count++;
    }
  });
  return count;
}

/**
 * Updates the last active timestamp for a session.
 */
export function updateSessionActivity(sessionId: string, ip?: string): void {
  const session = sessions.get(sessionId);
  if (session && session.status === 'active') {
    session.lastActive = new Date().toISOString();
    if (ip) session.ip = ip;
  }
}

/**
 * Detects anomalies in session activity (e.g., sudden IP change).
 */
export function checkSessionAnomaly(session: Session, currentIp: string): string | null {
  if (session.ip !== currentIp && !session.isTrusted) {
    return 'IP_CHANGE_DETECTED';
  }
  return null;
}

/**
 * Marks a device as trusted for a session.
 */
export function trustDevice(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (session) {
    session.isTrusted = true;
    return true;
  }
  return false;
}

/**
 * Gets session history (including terminated ones).
 */
export function getSessionHistory(userId: string): Session[] {
  return Array.from(sessions.values())
    .filter(s => s.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
