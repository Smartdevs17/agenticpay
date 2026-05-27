import { describe, expect, it } from 'vitest';
import {
  checkSessionAnomaly,
  createSession,
  getSession,
  getSessionHistory,
  getUserSessions,
  terminateOtherSessions,
  terminateSession,
  trustDevice,
} from '../session.js';

// The session store is module-global with no reset hook, so each test uses a
// unique userId to stay isolated from the others.
let counter = 0;
function uniqueUser(): string {
  counter += 1;
  return `user_${Date.now()}_${counter}`;
}

const baseMeta = { deviceId: 'device-a', browser: 'Chrome', os: 'macOS', ip: '10.0.0.1' };

describe('session service', () => {
  it('creates an active session with the supplied device metadata', () => {
    const userId = uniqueUser();
    const session = createSession(userId, baseMeta);

    expect(session.id).toMatch(/^sess_/);
    expect(session.userId).toBe(userId);
    expect(session.deviceId).toBe('device-a');
    expect(session.status).toBe('active');
    expect(session.isTrusted).toBe(false);
    expect(getSession(session.id)).toBeDefined();
  });

  it('enforces the concurrent session limit by evicting the oldest', () => {
    const userId = uniqueUser();
    for (let i = 0; i < 6; i++) {
      createSession(userId, { ...baseMeta, deviceId: `device-${i}` });
    }

    // Cap is 5 active sessions; the 6th create should have terminated one.
    expect(getUserSessions(userId)).toHaveLength(5);
    // History keeps every session, including the terminated one.
    expect(getSessionHistory(userId)).toHaveLength(6);
  });

  it('lists only active sessions for the user', () => {
    const userId = uniqueUser();
    const a = createSession(userId, baseMeta);
    const b = createSession(userId, baseMeta);
    terminateSession(a.id);

    const active = getUserSessions(userId);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(b.id);
  });

  it('terminates a specific session and reports success/failure', () => {
    const session = createSession(uniqueUser(), baseMeta);
    expect(terminateSession(session.id)).toBe(true);
    expect(getSession(session.id)?.status).toBe('terminated');
    expect(terminateSession('sess_does_not_exist')).toBe(false);
  });

  it('terminates all other sessions except the current one', () => {
    const userId = uniqueUser();
    const current = createSession(userId, baseMeta);
    createSession(userId, baseMeta);
    createSession(userId, baseMeta);

    const count = terminateOtherSessions(userId, current.id);
    expect(count).toBe(2);

    const active = getUserSessions(userId);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(current.id);
  });

  describe('checkSessionAnomaly', () => {
    it('flags an IP change for an untrusted session', () => {
      const session = createSession(uniqueUser(), baseMeta);
      expect(checkSessionAnomaly(session, '203.0.113.9')).toBe('IP_CHANGE_DETECTED');
    });

    it('does not flag the same IP', () => {
      const session = createSession(uniqueUser(), baseMeta);
      expect(checkSessionAnomaly(session, baseMeta.ip)).toBeNull();
    });

    it('does not flag IP changes once the device is trusted', () => {
      const session = createSession(uniqueUser(), baseMeta);
      trustDevice(session.id);
      const refreshed = getSession(session.id)!;
      expect(checkSessionAnomaly(refreshed, '203.0.113.9')).toBeNull();
    });
  });

  it('marks a device as trusted', () => {
    const session = createSession(uniqueUser(), baseMeta);
    expect(trustDevice(session.id)).toBe(true);
    expect(getSession(session.id)?.isTrusted).toBe(true);
    expect(trustDevice('sess_missing')).toBe(false);
  });

  it('returns session history newest-first including terminated sessions', () => {
    const userId = uniqueUser();
    const first = createSession(userId, baseMeta);
    const second = createSession(userId, baseMeta);
    terminateSession(first.id);

    const history = getSessionHistory(userId);
    expect(history).toHaveLength(2);
    expect(history.map((s) => s.id)).toContain(first.id);
    expect(history.map((s) => s.id)).toContain(second.id);
    // Newest-first ordering by createdAt.
    expect(new Date(history[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(history[1].createdAt).getTime(),
    );
  });
});
