import { describe, it, expect, beforeEach } from 'vitest';
import { isReplayEvent, clearReplayCache } from '../replay.js';

describe('Webhook replay protection', () => {
  beforeEach(() => {
    clearReplayCache();
  });

  it('allows first delivery', () => {
    expect(isReplayEvent('stripe:evt_1')).toBe(false);
  });

  it('blocks duplicate event id within TTL', () => {
    expect(isReplayEvent('stripe:evt_1')).toBe(false);
    expect(isReplayEvent('stripe:evt_1')).toBe(true);
  });
});
