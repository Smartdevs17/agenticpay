# Read Replica Load Balancing (Issue #947)

Pluggable read-replica load balancing for the database layer. Read queries are
distributed across healthy replicas while writes always go to the primary, with
health tracking, failover cooldown, replication-lag gating, session stickiness,
and disable/enable controls.

## Strategies

| Strategy | Behavior |
|----------|----------|
| `round_robin` | Equal distribution across healthy replicas (default). |
| `weighted` | Traffic split by per-replica weight (e.g. bigger replica gets more reads). |
| `least_connections` | Route to the replica with the fewest active queries. |

## File layout

```
backend/src/db/read-replica-router.ts   # Load balancer implementation
backend/src/db/__tests__/read-replica-router.test.ts
backend/src/config/database.ts          # Re-exports + singleton readReplicaRouter
backend/docs/READ_REPLICA_LOAD_BALANCING.md
```

## Usage

```ts
import { ReadReplicaRouter } from '../db/read-replica-router.js';

const router = new ReadReplicaRouter(
  ['postgres://replica-1/db', 'postgres://replica-2/db'],
  'postgres://primary/db',
  5000, // max replication lag (ms)
  { loadBalancingStrategy: 'least_connections' },
);

// Route a read query — returns { url, source, reason }
const sel = router.select('SELECT * FROM payments WHERE status = $1', ['pending']);
// sel.url === one of the replica URLs, sel.source === 'replica'

// Writes always go to primary
const write = router.select('UPDATE payments SET status = $1');
// write.source === 'primary'
```

### With the Prisma proxy

`PrismaReplicaClient` already routes Prisma model operations transparently.
The router is used under the hood:

```ts
import { getPrismaReplicaClient } from '../db/PrismaReplicaClient.js';

const client = getPrismaReplicaClient();
// findMany → replica, create → primary (automatic)
await client.proxy.payment.findMany({ where: { status: 'pending' } });
await client.proxy.payment.create({ data: { ... } });
```

### Health management

```ts
router.updateHealth('postgres://replica-1/db', { healthy: false });
router.disableReplica('postgres://replica-1/db');
router.enableReplica('postgres://replica-1/db');

const snap = router.snapshot(); // [{ url, health, lagMs, failureCount, disabled, ... }]
```

### Session stickiness

Pin reads from the same logical session (e.g. same HTTP request / user) to one
replica for read-after-write consistency:

```ts
const r1 = router.select('SELECT * FROM payments WHERE id = $1', [id], 'session-abc');
const r2 = router.select('SELECT * FROM payments WHERE id = $2', [id], 'session-abc');
// r1.url === r2.url
```

### Background health checks

```ts
router.startHealthChecks(10_000); // probes replicas every 10s
// ...
router.stopHealthChecks();
```

Pass a `lagProbe` to measure actual WAL replay lag:

```ts
const router = new ReadReplicaRouter(urls, primary, 5000, {
  lagProbe: async (url) => {
    const rows = await client.$queryRaw`SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000 AS lag_ms`;
    return Number(rows[0]?.lag_ms) ?? 0;
  },
});
```

## Configuration via env

- `DB_READ_REPLICA_URLS` — comma-separated replica URLs
- `DATABASE_URL` — primary URL
- `DB_READ_REPLICA_MAX_LAG_MS` — max acceptable replication lag (default 5000)

## Testing

```bash
cd backend
npx vitest run src/db/__tests__/read-replica-router.test.ts
```

## Notes

- When no healthy replica is available, reads fall back to the primary (no
  dropped reads).
- Failed replicas enter a failover cooldown (`failoverCooldownMs`, default
  60s) before being re-probed.
- Disabled replicas are excluded entirely until re-enabled.
