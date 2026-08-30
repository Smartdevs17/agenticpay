# Performance Monitoring & Optimization Guide

This guide explains the comprehensive performance monitoring and optimization system implemented in AgenticPay.

## Table of Contents

1. [Core Web Vitals Tracking](#core-web-vitals-tracking)
2. [API Response Compression](#api-response-compression)
3. [Cursor-Based Pagination](#cursor-based-pagination)
4. [Database Connection Pooling](#database-connection-pooling)
5. [Redis Caching Layer](#redis-caching-layer)
6. [Monitoring Dashboard](#monitoring-dashboard)
7. [Performance Budgets](#performance-budgets)

---

## Core Web Vitals Tracking

### Overview

Core Web Vitals are critical metrics that measure user experience:

- **LCP (Largest Contentful Paint)**: Time for the largest content element to render (target: <2.5s)
- **FID (First Input Delay)**: Time from first user interaction to browser response (target: <100ms)
- **CLS (Cumulative Layout Shift)**: Measure of visual stability (target: <0.1)
- **TTFB (Time to First Byte)**: Time for first response (target: <600ms)
- **FCP (First Contentful Paint)**: Time for first content to appear (target: <1.8s)

### Implementation

Located in: `frontend/lib/performance.ts`

```typescript
import { performanceMonitor } from '@/lib/performance';

// Automatically initialized on page load
// Tracks all Core Web Vitals and sends to Sentry
```

### Metrics Collection

- Real-time metric collection using `PerformanceObserver`
- Automatic reporting on page hide/unload
- Sentry integration for RUM
- Analytics API endpoint for custom tracking

### Route Transition Performance

Track navigation performance between routes:

```typescript
performanceMonitor.trackRouteTransition('/dashboard', '/payments');
```

---

## API Response Compression

### Overview

Reduces payload size by 60-80% on average, improving:
- Network transfer time
- Bandwidth costs
- Mobile performance

### Compression Methods

AgenticPay uses the maintained Express `compression` middleware with streaming
backpressure support, negotiated encodings, and route-level filters.

- Compression level: 6
- Minimum size threshold: 1KB by default
- Skips images, audio, video, archives, and already-compressed content

### Implementation

Located in: `backend/src/middleware/compression.ts`

```typescript
app.use(compressionMiddleware({
  level: 6,
  minSizeBytes: 1024,
}));
```

### Metrics

Access compression metrics via:

```
GET /api/v1/monitoring/compression
```

Returns:
```json
{
  "totalRequests": 1000,
  "compressedRequests": 950,
  "totalOriginalSize": 52428800,
  "totalCompressedSize": 10485760,
  "compressionRatio": 80.0,
  "brotliRequests": 600,
  "gzipRequests": 350
}
```

---

## API Response Streaming

Large exports are streamed with chunked transfer encoding instead of being buffered in memory.

Endpoints:

```bash
GET /api/v1/exports/audit/stream?format=csv&limit=100000
GET /api/v1/exports/audit/stream?format=jsonl&batchSize=1000
GET /api/v1/exports/payments/stream?format=csv
```

Reusable helpers live in `backend/src/middleware/streaming.ts`:

```typescript
const query = parseStreamingQuery(req.query);
await streamDataset({
  req,
  res,
  items: takeStreamItems(fetchRows(), query.limit),
  format: query.format,
});
```

The streaming helpers set `Transfer-Encoding: chunked`, disable proxy buffering with
`X-Accel-Buffering: no`, honor HTTP backpressure, and track completed, aborted, and failed streams.

---

## Cursor-Based Pagination

### Overview

Efficient pagination for large datasets using cursor-based approach instead of offset:

**Benefits:**
- O(1) query performance regardless of page position
- Handles data mutations between requests
- Smaller payloads with field selection

### API Usage

```bash
# Get first 20 items
GET /api/v1/payments?limit=20

# Get next page
GET /api/v1/payments?cursor=<endCursor>&limit=20

# Select specific fields
GET /api/v1/payments?limit=20&fields=id,amount,status

# With conditional requests
GET /api/v1/payments -H "If-None-Match: <etag>"
```

### Response Format

```json
{
  "data": [...],
  "pageInfo": {
    "startCursor": "base64_encoded_id",
    "endCursor": "base64_encoded_id",
    "hasNextPage": true,
    "hasPreviousPage": false,
    "totalCount": 1000,
    "pageSize": 20
  },
  "_meta": {
    "requestId": "req-123",
    "timestamp": "2024-01-01T00:00:00Z",
    "cacheStatus": "HIT"
  }
}
```

### Implementation

Located in: `backend/src/middleware/pagination.ts`

```typescript
import { paginationMiddleware, CursorPaginator } from './pagination';

// Apply middleware
app.use(paginationMiddleware);

// Use in routes
router.get('/items', async (req, res) => {
  const items = await db.items.findMany({
    take: req.pagination.limit,
    skip: req.pagination.cursor ? 1 : 0,
    cursor: req.pagination.cursor ? { id: CursorPaginator.decodeCursor(req.pagination.cursor) } : undefined,
  });

  res.sendPaginated(items, totalCount, cacheStatus);
});
```

### ETag Support

Automatic ETag generation for cache validation:

```
GET /api/v1/payments
ETag: "abc123def456"

GET /api/v1/payments -H "If-None-Match: abc123def456"
→ 304 Not Modified (no body sent)
```

---

## Database Connection Pooling

### Overview

Optimized connection pooling with PgBouncer for efficient resource utilization:

### Read Replicas and Failover

Read replica routing is configured with:

```bash
DB_READ_REPLICA_URLS=postgresql://user:pass@replica-a:5432/agenticpay,postgresql://user:pass@replica-b:5432/agenticpay
DB_REPLICA_MAX_LAG_MS=5000
DB_REPLICA_HEALTH_CHECK_INTERVAL_MS=30000
DB_REPLICA_FAILOVER_COOLDOWN_MS=15000
```

`backend/src/config/database.ts` exposes `ReadReplicaRouter`, which routes `SELECT` and `WITH`
queries across healthy replicas and falls back to `DATABASE_URL` when no replica is available or
replica lag exceeds the configured threshold. Terraform can provision replicas with
`db_read_replica_count` and wires `DB_READ_REPLICA_URLS` into the backend service.

### WebSocket Pooling

WebSocket connections are managed by `backend/src/websocket/pool.ts`. The pool enforces capacity,
tracks active and queued connections, batches outbound messages through `ManagedConnection`, and
supports clean shutdown. Tune batching with:

```typescript
attachWebSocketServer({
  server,
  options: {
    maxConnections: 250,
    maxQueueSizePerConnection: 500,
    flushIntervalMs: 25,
    maxBatchSize: 50,
  },
});
```

**Benefits:**
- Prevents connection exhaustion
- Detects and prevents connection leaks
- Monitors pool health in real-time
- Automatic alerting on degradation

### Configuration

Located in: `backend/src/config/database.ts`

Production settings:
```typescript
{
  max: 50,                    // Max connections
  min: 5,                     // Min connections
  acquireTimeoutMs: 10000,    // Timeout for acquiring connection
  idleTimeoutMs: 300000,      // Timeout for idle connections (5 min)
  maxConnectionAgeMs: 1800000 // Max age (30 min)
}
```

### PgBouncer Configuration

Located in: `backend/src/config/database.ts`

```typescript
{
  poolMode: "transaction",          // Per-transaction pooling
  defaultPoolSize: 25,
  maxPoolSize: 50,
  reservePoolSize: 5,
  queryTimeoutMs: 30000,
  serverLifetimeMs: 3600000         // Server lifetime (1 hour)
}
```

### Monitoring

Access pool health via:

```
GET /api/v1/monitoring/health
```

Returns:
```json
{
  "status": "healthy",
  "activeConnections": 25,
  "idleConnections": 10,
  "utilizationPercent": 50,
  "poolSize": { "min": 5, "max": 50 },
  "leaks": { "detected": 0, "threshold": 5 },
  "exhaustion": { "events": 0 },
  "recommendations": ["Pool operating normally"]
}
```

### Leak Detection

Automatic detection of connection leaks:

```
GET /api/v1/monitoring/leaks
```

- Monitors connection acquisition/release
- Alerts on connections held longer than threshold
- Automatic cleanup after timeout

### Metrics Endpoint

```
GET /api/v1/monitoring/metrics
```

Returns comprehensive pool statistics including:
- Connection counts (active, idle, waiting)
- Lease statistics (total, active, released, errors)
- Peak connection usage
- Average acquire time

---

## Redis Caching Layer

### Overview

Intelligent caching system with automatic invalidation for high-performance data access:

**Benefits:**
- 90%+ cache hit rate for hot data
- Sub-millisecond response times
- Event-driven automatic invalidation
- Cache warming on startup
- Real-time hit rate metrics

### Implementation

Located in: `backend/src/services/cache.ts`

### Cache Service API

```typescript
import { getCacheService } from '@/services/cache';

const cache = await getCacheService();

// Get with fallback loader
const user = await cache.get('user:123',
  () => db.users.findUnique({ where: { id: '123' } }),
  300 // 5-minute TTL
);

// Direct set
await cache.set('user:123', userData, 300);

// Delete
await cache.delete('user:123');

// Invalidate by pattern
await cache.invalidateKeys(['user:*', 'dashboard:*']);

// Get metrics
const metrics = cache.getMetrics();
console.log(`Hit rate: ${metrics.hitRate.toFixed(2)}%`);
```

### Automatic Invalidation Rules

Events automatically invalidate related cache:

```typescript
// Payment events
'payment.created'   → invalidates ['payments:list', 'dashboard:overview']
'payment.completed' → invalidates ['payments:list', 'analytics:*']

// Invoice events
'invoice.paid'      → invalidates ['invoices:list', 'dashboard:overview']

// User events
'user.updated'      → invalidates ['user:*', 'dashboard:*']
```

### Cache Warming

Critical data preloaded on startup:

```typescript
cache.registerWarmer('dashboard:overview',
  () => db.dashboards.getOverview(),
  3600 // 1 hour TTL
);

// Warming triggered during initialization
```

### Metrics Endpoint

```
GET /api/v1/monitoring/cache
```

Returns:
```json
{
  "hits": 1000,
  "misses": 100,
  "hitRate": 90.9,
  "sets": 150,
  "deletes": 50,
  "errors": 2,
  "avgSizeBytes": 2048
}
```

---

## Monitoring Dashboard

### Performance Overview

Comprehensive view of all performance metrics:

```
GET /api/v1/monitoring/performance
```

Returns combined metrics:
- Performance score (0-100)
- Pool health status
- Compression ratio
- Cache hit rate
- Recommendations

### Integration with Sentry

All Core Web Vitals are automatically sent to Sentry:

```
GET https://sentry.io/organizations/agenticpay/
  → agenticpay-frontend project
  → Performance tab
  → Core Web Vitals section
```

---

## Performance Budgets

### CI/CD Integration

Performance checks run on every commit:

```
GitHub Actions → .github/workflows/performance-monitoring.yml
```

### Checks Performed

1. **Bundle Size**: < 5MB total
2. **Core Web Vitals**: Within thresholds
3. **Lighthouse Score**: > 90
4. **Compression Ratio**: > 70%
5. **Cache Hit Rate**: > 80%
6. **Pool Health**: No exhaustion events

### Local Performance Testing

```bash
# Analyze bundle
npm run analyze:bundle

# Run Lighthouse locally
npm run lighthouse:ci

# Check performance metrics
npm run test:performance
```

---

## Best Practices

### For Backend Developers

1. **Use cursor pagination** for list endpoints
2. **Leverage cache service** for frequently accessed data
3. **Monitor pool health** before deploying
4. **Validate compression** is enabled for all text responses

### For Frontend Developers

1. **Import performance monitor** to track custom metrics
2. **Use pagination helper** for large data lists
3. **Minimize JavaScript** and defer non-critical code
4. **Optimize images** with Next.js Image component

### For DevOps

1. **Monitor pool exhaustion** alerts in production
2. **Tune pool size** based on actual usage patterns
3. **Configure PgBouncer** maintenance windows
4. **Scale Redis** horizontally when hit rate drops

---

## Troubleshooting

### High Cache Miss Rate

1. Check invalidation rules are correct
2. Verify cache warming is running
3. Increase TTL for stable data
4. Check Redis memory usage

### Connection Pool Exhaustion

1. Reduce query time with proper indexing
2. Increase pool size gradually
3. Check for connection leaks
4. Monitor slow queries

### Low Compression Ratio

1. Verify Brotli is supported by clients
2. Check minimum size threshold
3. Increase compression level (trade-off: speed)
4. Identify uncompressible content types

---

## References

- [Core Web Vitals](https://web.dev/vitals/)
- [Brotli Compression](https://github.com/google/brotli)
- [PgBouncer Documentation](https://www.pgbouncer.org/)
- [Redis Cluster Guide](https://redis.io/docs/manual/scaling/)
