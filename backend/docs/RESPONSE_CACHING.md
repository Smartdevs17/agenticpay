# API Response Caching with ETags

Two composable Express middlewares provide HTTP caching for read-heavy
endpoints: **`etag()`** (response tagging + conditional requests) and
**`cacheControl()`** (cache headers, optional in-memory storage, and
stale-while-revalidate). They are implemented in
`backend/src/middleware/etag.ts` and `backend/src/middleware/cache.ts`.

Use `etag()` for bandwidth savings on any GET/HEAD endpoint. Use
`cacheControl()` when a response body is stable enough to be stored and served
without re-running the handler.

## ETag middleware (`etag()`)

Generates an ETag from the serialised response body and answers matching
`If-None-Match` requests with a `304 Not Modified` (weak comparison, RFC 7232).

```ts
import { etag } from '../middleware/etag.js';

router.get('/api/v1/payments/:id', etag(), handler);
```

Options:

| Option                 | Default                | Effect                                          |
| ---------------------- | ---------------------- | ----------------------------------------------- |
| `algorithm`            | `sha256`               | Hash algorithm (`sha256`, `sha1`, `md5`)        |
| `weak`                 | `false`                | Always emit a weak ETag (`W/"…"`)               |
| `weakThresholdBytes`   | `1024`                 | Emit a weak ETag above this body size           |
| `maxBodySize`          | `1 MiB`                | Skip ETag logic for larger bodies               |
| `bypassAuthenticated`  | `false`                | Skip requests with `authorization`/`x-api-key`  |

Behaviour:

- Only GET/HEAD are processed; mutations pass straight through.
- Responses with `statusCode >= 400` are never tagged.
- An ETag already set by another middleware is honoured (no duplicate tags).
- A client `If-None-Match` of `"*"` always matches.
- Metrics are exposed via `getETagMetrics()` / `resetETagMetrics()`.

## Cache middleware (`cacheControl()`)

```ts
import { cacheControl, CacheTTL } from '../middleware/cache.js';

// Header-only mode: Cache-Control + ETag, no storage. Fast, zero risk.
router.get('/api/v1/customer/:id', cacheControl({ maxAge: CacheTTL.SHORT }), handler);

// In-memory mode: store the body, serve subsequent requests straight from memory.
router.get('/api/v1/catalog', cacheControl({
  maxAge: CacheTTL.STATIC,
  inMemory: true,
  staleWhileRevalidate: 60,
}), handler);
```

| Option                | Default      | Effect                                                    |
| --------------------- | ------------ | --------------------------------------------------------- |
| `maxAge`              | *required*   | Cache lifetime in seconds (`CacheTTL.*` presets provided) |
| `isPublic`            | `true`       | Emit `private` instead of `public`                        |
| `inMemory`            | `false`      | Store responses in memory and serve them directly         |
| `staleWhileRevalidate`| `undefined`  | Serve stale content for up to N seconds behind a re-fetch |
| `cacheKey`            | *method+URL* | Fixed cache-key override                                  |
| `maxBodySize`         | `1 MiB`      | Do not cache bodies larger than this                      |

`CacheTTL` presets: `STATIC=300`, `SHORT=30`, `IMMUTABLE=600`, `LONG=3600`,
`NONE=0`.

### Response semantics

- `X-Cache: MISS` — handler ran, response stored on completion.
- `X-Cache: HIT` — body served from memory without touching the handler.
- `X-Cache: STALE` — stale body served because `staleWhileRevalidate > 0`.
- `Cache-Control: no-store` — emitted for responses with `statusCode >= 400`
  (nothing is cached, no ETag is attached). Mutations pass through uncached.
- A matching `If-None-Match` yields a `304 Not Modified` from stored entries.

Responses are stored only after the socket `finish` event, so interrupted
responses never poison the cache.

### Warming & invalidation

```ts
import { warmCache, invalidateCache, clearMemoryCache } from '../middleware/cache.js';

warmCache('agenticpay:cache:GET:/api/v1/catalog', fetchCatalog, CacheTTL.LONG * 1000);
await invalidateCache('GET:/api/v1/catalog*'); // glob against the internal prefix
```

`getMemoryCache()` exposes the in-memory store (with `keys()`, `delete()`,
`clear()`), and `getCacheMonitor()` reports hits/misses/sets metrics. When
`REDIS_URL` is set, stored responses are mirrored to Redis; without it every
Redis operation becomes a safe no-op.

## Composition

Do **not** stack `etag()` and `cacheControl()` on the same route — `cacheControl`
already attaches an ETag and performs its own conditional-request handling.
Pick one strategy per route:

- `etag()` — the server still runs the handler each request, but sends a `304`
  to clients holding the current representation.
- `cacheControl({ inMemory: true })` — the handler runs only on a miss.
- `cacheControl({ maxAge })` — header-only; useful for CDN/browser caching of
  public, stable resources.

## Benchmarks

Run from `backend/`:

```sh
npm run benchmark:baseline   # regenerate benchmarks/baseline.json
npm run benchmark            # write results.json
npm run benchmark:compare    # fail if p99 regressed >10%
```

The suite includes `cache_plain`, `cache_header_only`, `cache_memory_hit` and
`cache_etag_304` endpoints measuring each strategy side by side against the same
logical payload.

## Testing

Unit and integration coverage lives in:

- `backend/src/middleware/__tests__/etag.test.ts`
- `backend/src/middleware/__tests__/cache.test.ts`
- `backend/src/middleware/__tests__/etag-cache.integration.test.ts` (real HTTP)

```sh
npx vitest run --coverage --coverage.include='src/middleware/{etag,cache}.ts' \
  src/middleware/__tests__/etag.test.ts src/middleware/__tests__/cache.test.ts
```

Both middleware files hold >90% statement and line coverage and >90% branch
coverage.