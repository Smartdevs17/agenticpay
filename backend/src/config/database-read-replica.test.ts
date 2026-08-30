import { describe, expect, it } from 'vitest';
import {
  ReadReplicaRouter,
  buildReplicaConfigs,
  isReadQuery,
} from './database';

describe('read replica routing', () => {
  it('detects read queries conservatively', () => {
    expect(isReadQuery('select * from payments')).toBe(true);
    expect(isReadQuery(' WITH recent AS (select 1) select * from recent')).toBe(true);
    expect(isReadQuery('update payments set status = $1')).toBe(false);
  });

  it('routes writes to primary and reads to healthy replicas', () => {
    const router = new ReadReplicaRouter(
      ['postgres://replica-1/db', 'postgres://replica-2/db'],
      'postgres://primary/db',
      5000,
    );

    expect(router.select('UPDATE payments SET status = $1')).toEqual({
      url: 'postgres://primary/db',
      source: 'primary',
      reason: 'write_query',
    });

    expect(router.select('SELECT * FROM payments')).toEqual({
      url: 'postgres://replica-1/db',
      source: 'replica',
      reason: 'healthy_replica',
    });
    expect(router.select('SELECT * FROM invoices')).toMatchObject({
      url: 'postgres://replica-2/db',
      source: 'replica',
    });
  });

  it('fails over to primary when all replicas are unhealthy or lagging', () => {
    const router = new ReadReplicaRouter(
      ['postgres://replica-1/db', 'postgres://replica-2/db'],
      'postgres://primary/db',
      100,
    );

    router.updateHealth('postgres://replica-1/db', { healthy: false });
    router.updateHealth('postgres://replica-2/db', { healthy: true, lagMs: 500 });

    expect(router.select('SELECT * FROM payments')).toEqual({
      url: 'postgres://primary/db',
      source: 'primary',
      reason: 'replica_unavailable',
    });
  });

  it('builds replica configs from environment URLs', () => {
    const previous = process.env.DB_READ_REPLICA_URLS;
    process.env.DB_READ_REPLICA_URLS = 'postgres://user:pass@replica-a:5432/app, postgres://user:pass@replica-b/app';

    try {
      expect(buildReplicaConfigs()).toMatchObject([
        { host: 'replica-a', port: 5432, database: 'app', user: 'user', enabled: true },
        { host: 'replica-b', port: 5432, database: 'app', user: 'user', enabled: true },
      ]);
    } finally {
      if (previous === undefined) delete process.env.DB_READ_REPLICA_URLS;
      else process.env.DB_READ_REPLICA_URLS = previous;
    }
  });
});
