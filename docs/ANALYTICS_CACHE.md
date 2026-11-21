# Analytics Rollup Caching with Partition-Aware Invalidation

Implemented under **Issue #1458**.

## Architecture & Partition Design

Analytics rollups aggregate financial transaction data over temporal windows and dimensions.
In this codebase, a **"partition"** represents a discrete time bucket (daily `YYYY-MM-DD` or hourly `YYYY-MM-DDTHH:00:00Z`) scoped strictly to a `tenantId`.

### 1. Partition Types & TTL Strategy
- **Closed (Historical) Partition**: Any time bucket strictly prior to the current active bucket (e.g. past days `2026-11-20`).
  - Historical payments/refunds are finalized, so closed partitions are effectively immutable.
  - Assigned a **Long TTL** (default: `86,400s` / 24 hours).
- **Open (Current) Partition**: The currently ongoing bucket (e.g. today `2026-11-21`).
  - Actively ingests new transactions, updates, and status transitions.
  - Assigned a **Short TTL** (default: `60s`).
  - Actively invalidated whenever a write occurs.

### 2. Cache Key Structure
Format:
```
analytics:rollup:v{SCHEMA_VERSION}:{tenantId}:{metric}:{partition}:{filtersHash}
```
Example:
```
analytics:rollup:v1:tenant_123:timeSeries:2026-11-20:5e884898da28
```
- `SCHEMA_VERSION`: Bumped when the schema or calculation logic changes, rendering old entries obsolete without explicit cache purges.
- `tenantId`: Mandatory authorization scope. Rollups are partitioned per tenant; a tenant can never access another tenant's cached data.
- `metric`: The specific analytics query (`timeSeries`, `summary`, `funnel`, `segmentation`).
- `partition`: Partition date string (`YYYY-MM-DD`).
- `filtersHash`: Deterministic SHA-256 slice (12 hex chars) of sorted filter parameters (e.g., `granularity=hour`, `network=stellar`).

### 3. Stampede Protection (Single-Flight)
Concurrent cache misses for the same key join a single in-flight computation promise (`SingleFlight`). If N concurrent requests arrive simultaneously for an uncached key, the computation executes exactly once.
If the underlying computation throws an error, the promise is immediately cleared and **never cached**, ensuring transient errors do not poison the cache.

### 4. Memory Bounds & Multi-Instance Behavior
- **In-process store**: Implemented as a bounded LRU cache with eviction when `maxEntries` (default 2,000) is exceeded.
- **Shared store (Redis)**: When `REDIS_URL` and `REDIS_ENABLED` are configured, reads and writes propagate through Redis.
- **Multi-Instance Semantics**:
  - In a multi-replica deployment without Redis, in-process caches cannot invalidate peer instances. The short TTL for open partitions (60s) bounds any inter-instance inconsistency to at most 1 minute.
  - With Redis configured, invalidations delete keys in Redis, keeping all instances synchronized.

### 5. Fail-Open Correctness
If the cache layer encounters an internal error or Redis timeout, it catches the error, increments `errors`, logs a warning, and falls back directly to computing from the source. A cache fault will **never fail** an end-user request.

### 6. Write-Path Invalidation Hook
Invalidations are centralized through a single function:
`invalidateAnalyticsRollups({ tenantId, timestamp, metric? })`

Covered write paths:
1. `PaymentRepository.create`: On new payment intake.
2. `PaymentRepository.updateStatus`: On payment state transitions (confirmed, completed, failed).
3. `PaymentAnalyticsService.trackPayment`: On in-memory analytics ingestion.
4. Late-arriving corrections / past partition writes: By passing the transaction's historical `timestamp`, the specific historical partition is purged along with the current open partition.

Write paths not covered directly:
- Direct raw SQL database updates bypassing repository methods (recommended to use repository or event bus).

### 7. Observability
`analyticsRollupCache.getMetrics()` tracks:
- `hits`: Successful cache reads.
- `misses`: Cache misses triggering source computation.
- `stale`: Expired entries found.
- `invalidations`: Keys deleted on write events.
- `errors`: Exceptions handled via fail-open.
- `computations`: Total source executions executed.
- `size`: Current entry count in the LRU.

Debug logs record cache keys and partition dates; no sensitive financial data or PII is ever logged.

### 8. Configuration
| Environment Variable | Type | Default | Description |
|---|---|---|---|
| `ANALYTICS_CACHE_ENABLED` | boolean | `true` | Enable/disable analytics rollup caching |
| `ANALYTICS_CACHE_OPEN_TTL_SECONDS` | number | `60` | TTL for the open (current) partition |
| `ANALYTICS_CACHE_CLOSED_TTL_SECONDS` | number | `86400` | TTL for closed (past) partitions |
| `ANALYTICS_CACHE_MAX_ENTRIES` | number | `2000` | Maximum LRU capacity |
| `ANALYTICS_CACHE_SCHEMA_VERSION` | number | `1` | Schema version for global key invalidation |
