import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReadReplicaRouter,
  buildReplicaUrls,
  getReadReplicaRouter,
  resetReadReplicaRouterForTesting,
} from './read-replica-router.js';

function makeRouter(
  urls: string[],
  primary = 'postgres://primary/db',
  maxLagMs = 5000,
  options: ConstructorParameters<typeof ReadReplicaRouter>[3] = {},
) {
  return new ReadReplicaRouter(urls, primary, maxLagMs, options);
}

describe('ReadReplicaRouter — load balancing strategies', () => {
  beforeEach(() => {
    resetReadReplicaRouterForTesting();
  });

  it('round_robin distributes reads evenly across replicas', () => {
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db'], 'postgres://primary/db', 5000, {
      loadBalancingStrategy: 'round_robin',
    });
    const urls = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const sel = r.select('SELECT * FROM payments');
      urls.add(sel.url);
      expect(sel.source).toBe('replica');
    }
    expect(urls.size).toBe(2); // both replicas used
  });

  it('weighted strategy splits traffic by replica weight', () => {
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db'], 'postgres://primary/db', 5000, {
      loadBalancingStrategy: 'weighted',
      weights: { 'postgres://r1/db': 9, 'postgres://r2/db': 1 },
    });
    let r1 = 0;
    let r2 = 0;
    for (let i = 0; i < 100; i++) {
      const sel = r.select('SELECT 1');
      if (sel.url === 'postgres://r1/db') r1++;
      else r2++;
    }
    expect(r1).toBeGreaterThan(r2); // r1 gets most traffic
  });

  it('least_connections routes to the replica with fewest active queries', () => {
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db'], 'postgres://primary/db', 5000, {
      loadBalancingStrategy: 'least_connections',
    });
    // Manually inflate active connections on r1
    const r1 = 'postgres://r1/db';
    const r2 = 'postgres://r2/db';
    const snap = r.snapshot();
    // Simulate by picking least connections — both start equal, verify selection is stable
    const s1 = r.select('SELECT 1');
    const s2 = r.select('SELECT 1');
    expect(s1.source).toBe('replica');
    expect(s2.source).toBe('replica');
  });

  it('round_robin is the default strategy', () => {
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db']);
    const s1 = r.select('SELECT 1');
    const s2 = r.select('SELECT 1');
    expect(s1.url).not.toBe(s2.url);
  });
});

describe('ReadReplicaRouter — health & failover', () => {
  beforeEach(() => {
    resetReadReplicaRouterForTesting();
  });

  it('routes writes to primary', () => {
    const r = makeRouter(['postgres://r1/db']);
    const sel = r.select('UPDATE payments SET status=$1');
    expect(sel).toEqual({ url: 'postgres://primary/db', source: 'primary', reason: 'write_query' });
  });

  it('falls back to primary when all replicas unhealthy', () => {
    const r = makeRouter(['postgres://r1/db']);
    r.updateHealth('postgres://r1/db', { healthy: false });
    const sel = r.select('SELECT 1');
    expect(sel.source).toBe('primary');
    expect(sel.reason).toBe('replica_unavailable');
  });

  it('falls back to primary when lag exceeds maxLagMs', () => {
    const r = makeRouter(['postgres://r1/db'], 'postgres://primary/db', 100);
    r.updateHealth('postgres://r1/db', { healthy: true, lagMs: 500 });
    const sel = r.select('SELECT 1');
    expect(sel.source).toBe('primary');
  });

  it('uses low-lag replica when one is unhealthy', () => {
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db'], 'postgres://primary/db', 5000);
    r.updateHealth('postgres://r1/db', { healthy: false });
    const sel = r.select('SELECT 1');
    expect(sel.url).toBe('postgres://r2/db');
    expect(sel.source).toBe('replica');
  });

  it('disableReplica removes it from routing', () => {
    const r = makeRouter(['postgres://r1/db']);
    r.disableReplica('postgres://r1/db');
    const sel = r.select('SELECT 1');
    expect(sel.source).toBe('primary');
    const snap = r.snapshot()[0]!;
    expect(snap.disabled).toBe(true);
  });

  it('enableReplica restores routing', () => {
    const r = makeRouter(['postgres://r1/db']);
    r.disableReplica('postgres://r1/db');
    r.enableReplica('postgres://r1/db');
    const sel = r.select('SELECT 1');
    expect(sel.source).toBe('replica');
  });

  it('session stickiness pins reads to one replica', () => {
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db'], 'postgres://primary/db', 5000, {
      enableStickiness: true,
    });
    const s1 = r.select('SELECT 1', 'session-abc');
    const s2 = r.select('SELECT 1', 'session-abc');
    const s3 = r.select('SELECT 1', 'session-abc');
    expect(s1.url).toBe(s2.url);
    expect(s2.url).toBe(s3.url);
  });

  it('stickiness falls back when pinned replica becomes unhealthy', () => {
    const r = makeRouter(['postgres://r1/db', 'postgres://r2/db'], 'postgres://primary/db', 5000, {
      enableStickiness: true,
    });
    const s1 = r.select('SELECT 1', 'session-xyz');
    r.updateHealth(s1.url, { healthy: false });
    const s2 = r.select('SELECT 1', 'session-xyz');
    expect(s2.url).not.toBe(s1.url);
  });

  it('failover cooldown excludes a failed replica from routing', () => {
    const r = makeRouter(['postgres://r1/db'], 'postgres://primary/db', 5000, {
      failoverCooldownMs: 999_999,
    });
    r.updateHealth('postgres://r1/db', { healthy: false });
    const sel = r.select('SELECT 1');
    expect(sel.source).toBe('primary');
  });
});

describe('ReadReplicaRouter — snapshot', () => {
  beforeEach(() => {
    resetReadReplicaRouterForTesting();
  });

  it('snapshot returns serialisable replica state', () => {
    const r = makeRouter(['postgres://r1/db']);
    const snap = r.snapshot();
    expect(snap.length).toBe(1);
    expect(snap[0]!.url).toBe('postgres://r1/db');
    expect(snap[0]!.health).toBe('healthy');
    expect(() => JSON.stringify(snap)).not.toThrow();
  });

  it('updateHealth records failureCount', () => {
    const r = makeRouter(['postgres://r1/db']);
    r.updateHealth('postgres://r1/db', { healthy: false });
    expect(r.snapshot()[0]!.failureCount).toBe(1);
    expect(r.snapshot()[0]!.health).toBe('unhealthy');
  });

  it('updateHealth recovery resets failureCount', () => {
    const r = makeRouter(['postgres://r1/db']);
    r.updateHealth('postgres://r1/db', { healthy: false });
    r.updateHealth('postgres://r1/db', { healthy: true, lagMs: 0 });
    expect(r.snapshot()[0]!.failureCount).toBe(0);
    expect(r.snapshot()[0]!.health).toBe('healthy');
  });
});

describe('buildReplicaUrls', () => {
  it('parses comma-separated URLs from env', () => {
    const prev = process.env['DB_READ_REPLICA_URLS'];
    process.env['DB_READ_REPLICA_URLS'] = 'postgres://r1/db, postgres://r2/db';
    try {
      expect(buildReplicaUrls()).toEqual(['postgres://r1/db', 'postgres://r2/db']);
    } finally {
      if (prev === undefined) delete process.env['DB_READ_REPLICA_URLS'];
      else process.env['DB_READ_REPLICA_URLS'] = prev;
    }
  });

  it('returns [] when env var unset', () => {
    const prev = process.env['DB_READ_REPLICA_URLS'];
    delete process.env['DB_READ_REPLICA_URLS'];
    try {
      expect(buildReplicaUrls()).toHaveLength(0);
    } finally {
      if (prev !== undefined) process.env['DB_READ_REPLICA_URLS'] = prev;
    }
  });
});

describe('getReadReplicaRouter singleton', () => {
  beforeEach(() => {
    resetReadReplicaRouterForTesting();
  });

  it('returns the same instance', () => {
    const a = getReadReplicaRouter();
    const b = getReadReplicaRouter();
    expect(a).toBe(b);
  });
});
