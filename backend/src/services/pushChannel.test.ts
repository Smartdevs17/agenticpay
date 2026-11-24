import { describe, expect, it, vi } from 'vitest';
import {
  PushChannel,
  PushEvent,
  PushMessage,
  PushTransport,
  PushTransportError,
  pushRetryDelayMs,
  tokenHint,
} from './pushChannel.js';

const MESSAGE: PushMessage = { title: 'Invoice paid', body: 'Thanks!' };

function devices(map: Record<string, string[]>) {
  const removed: Array<{ userId: string; token: string }> = [];
  return {
    removed,
    registry: {
      tokensFor: vi.fn(async (userId: string) => [...(map[userId] ?? [])]),
      removeToken: vi.fn(async (userId: string, token: string) => {
        removed.push({ userId, token });
        map[userId] = (map[userId] ?? []).filter((t) => t !== token);
      }),
    },
  };
}

function channel(
  transport: PushTransport,
  registry: ReturnType<typeof devices>['registry'],
  overrides: { events?: PushEvent[]; sleep?: (ms: number) => Promise<void>; maxAttempts?: number } = {},
) {
  const events = overrides.events ?? [];
  // One shared mock, so the test inspects the same sleep the channel calls.
  const sleep = overrides.sleep ?? vi.fn(async () => undefined);
  return {
    events,
    sleep,
    channel: new PushChannel({
      transport,
      devices: registry,
      policy: { maxAttempts: overrides.maxAttempts ?? 3, baseDelayMs: 100, maxDelayMs: 1_000 },
      sleep,
      random: () => 0,
      observe: (event) => events.push(event),
    }),
  };
}

describe('PushChannel.send', () => {
  it('returns no_devices without calling the transport when the user has none', async () => {
    const transport = { send: vi.fn(async () => undefined) };
    const { registry } = devices({});
    const { channel: push } = channel(transport, registry);

    await expect(push.send('u1', MESSAGE)).resolves.toMatchObject({ status: 'no_devices', devices: 0 });
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('delivers to every registered device', async () => {
    const transport = { send: vi.fn(async () => undefined) };
    const { registry } = devices({ u1: ['a', 'b'] });
    const { channel: push } = channel(transport, registry);

    await expect(push.send('u1', MESSAGE)).resolves.toEqual({
      status: 'delivered',
      devices: 2,
      deliveredTo: 2,
      attemptsTotal: 2,
    });
    expect(transport.send).toHaveBeenCalledTimes(2);
  });

  it('retries a transient failure silently and then succeeds', async () => {
    const transport = {
      send: vi
        .fn()
        .mockRejectedValueOnce(new PushTransportError('transient', 'timeout'))
        .mockResolvedValueOnce(undefined),
    };
    const { registry } = devices({ u1: ['a'] });
    const events: PushEvent[] = [];
    const { channel: push, sleep } = channel(transport, registry, { events });

    const result = await push.send('u1', MESSAGE);

    expect(result).toMatchObject({ status: 'delivered', attemptsTotal: 2 });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'attempt_failed', kind: 'transient', attempt: 1 }));
  });

  it('gives up after maxAttempts transient failures and reports failed', async () => {
    const transport = { send: vi.fn(async () => { throw new PushTransportError('transient', 'down'); }) };
    const { registry } = devices({ u1: ['a'] });
    const events: PushEvent[] = [];
    const { channel: push } = channel(transport, registry, { events, maxAttempts: 3 });

    await expect(push.send('u1', MESSAGE)).resolves.toMatchObject({ status: 'failed', attemptsTotal: 3 });
    expect(transport.send).toHaveBeenCalledTimes(3);
    expect(events.at(-1)).toMatchObject({ type: 'failed', userId: 'u1' });
  });

  it('removes an unregistered token, does not retry it, and still delivers to other devices', async () => {
    const transport = {
      send: vi.fn(async (token: string) => {
        if (token === 'dead') throw new PushTransportError('unregistered', 'gone');
      }),
    };
    const map = { u1: ['dead', 'live'] };
    const { registry, removed } = devices(map);
    const { channel: push } = channel(transport, registry);

    await expect(push.send('u1', MESSAGE)).resolves.toMatchObject({ status: 'delivered', deliveredTo: 1 });
    expect(transport.send.mock.calls.filter(([t]) => t === 'dead')).toHaveLength(1);
    expect(removed).toEqual([{ userId: 'u1', token: 'dead' }]);
    expect(map.u1).toEqual(['live']);
  });

  it('does not retry or remove a token on a permanent failure', async () => {
    const transport = {
      send: vi.fn(async () => {
        throw new PushTransportError('permanent', 'bad payload');
      }),
    };
    const map = { u1: ['a'] };
    const { registry, removed } = devices(map);
    const { channel: push, sleep } = channel(transport, registry);

    await expect(push.send('u1', MESSAGE)).resolves.toMatchObject({ status: 'failed', attemptsTotal: 1 });
    expect(sleep).not.toHaveBeenCalled();
    expect(removed).toEqual([]);
  });

  it('treats an unclassified error as permanent', async () => {
    const transport = { send: vi.fn(async () => { throw new Error('boom'); }) };
    const { registry } = devices({ u1: ['a'] });
    const { channel: push } = channel(transport, registry);

    await expect(push.send('u1', MESSAGE)).resolves.toMatchObject({ status: 'failed', attemptsTotal: 1 });
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it('never puts the raw token into observability events', async () => {
    const transport = { send: vi.fn(async () => { throw new PushTransportError('transient', 'x'); }) };
    const { registry } = devices({ u1: ['SECRET-DEVICE-TOKEN'] });
    const events: PushEvent[] = [];
    const { channel: push } = channel(transport, registry, { events, maxAttempts: 2 });

    await push.send('u1', MESSAGE);
    expect(JSON.stringify(events)).not.toContain('SECRET-DEVICE-TOKEN');
  });

  it('rejects an invalid retry policy', () => {
    const { registry } = devices({});
    expect(
      () => new PushChannel({ transport: { send: async () => undefined }, devices: registry, policy: { maxAttempts: 0 } }),
    ).toThrow(RangeError);
  });
});

describe('pushRetryDelayMs', () => {
  const policy = { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 1_000 };

  it('grows exponentially and is capped', () => {
    // random() = 0 gives the lower half of the ceiling, so the ceiling is easy to read off.
    expect(pushRetryDelayMs(1, policy, undefined, () => 0)).toBe(50);
    expect(pushRetryDelayMs(2, policy, undefined, () => 0)).toBe(100);
    expect(pushRetryDelayMs(3, policy, undefined, () => 0)).toBe(200);
    expect(pushRetryDelayMs(20, policy, undefined, () => 0)).toBe(500);
  });

  it('honours a server Retry-After but never beyond maxDelayMs', () => {
    expect(pushRetryDelayMs(1, policy, 300, () => 0)).toBe(300);
    expect(pushRetryDelayMs(1, policy, 60_000, () => 0)).toBe(1_000);
  });
});

describe('tokenHint', () => {
  it('is stable and does not contain the token', () => {
    expect(tokenHint('abc')).toBe(tokenHint('abc'));
    expect(tokenHint('abc')).not.toContain('abc');
    expect(tokenHint('abc')).toMatch(/^tok_[0-9a-f]{8}$/);
  });
});
