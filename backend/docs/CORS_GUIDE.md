# CORS Policy Management with Dynamic Origin Whitelisting

Express CORS enforcement backed by a **runtime-mutable origin allowlist**. The
allowlist can be changed at any time (admin API, code, or an async loader)
and the new policy applies to the very next request — **no redeploy required**.

Files:

- `backend/src/middleware/cors.ts` — `createCorsMiddleware()` / `cors()`
- `backend/src/services/cors.ts` — `CORSOriginPolicy` + shared singleton
- `backend/src/routes/cors.ts` — `corsRouter` management endpoints

## Supported allowlist patterns

| Pattern                      | Matches                                                        |
| ---------------------------- | -------------------------------------------------------------- |
| `https://app.example.com`    | Exactly that origin (scheme + host, port ignored)              |
| `https://*.example.com`      | `example.com` and every subdomain, HTTPS only                  |
| `*.example.com`              | `example.com` and every subdomain, any scheme                  |
| `example.com`                | `example.com` only, any scheme                                 |
| `*`                          | Any origin (open mode)                                         |

Matching is case-insensitive and ignores the port. `null` and empty origins
(sandboxed/`file://` browsers) are always denied. Syntax is validated on
write: origins with paths, queries, fragments, whitespace, or control
characters are rejected with `INVALID_CORS_ORIGIN`.

## Bootstrapping

The app seeds the shared policy from `CORS_ALLOWED_ORIGINS` at startup and
mounts the middleware globally:

```ts
initCorsPolicy({
  allowedOrigins: config.cors.allowedOrigins, // CSV from env
  allowCredentials: true,
});

app.use(
  createCorsMiddleware({
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Trace-Id', REQUEST_ID_HEADER],
  })
);
```

## Service API (`services/cors.ts`)

```ts
import {
  CORSOriginPolicy,
  initCorsPolicy,
  getCorsPolicy,
  addAllowedOrigin,        // (pattern) => size
  removeAllowedOrigin,     // (pattern) => boolean
  setAllowedOrigins,       // (patterns: string[])  — atomic, throws on bad entry
  getAllowedOrigins,       // () => string[]
  isOriginAllowed,         // (origin) => boolean
  refreshAllowedOrigins,   // () => Promise<string[]>
  getCorsMetrics,          // () => CorsMetrics
  resetCorsMetrics,
  originMatches, isValidOrigin, isValidPattern,
} from '../services/cors.js';

const policy = getCorsPolicy();
policy.add('https://dashboard.example.com');   // live on the next request
policy.remove('https://legacy.example.com');
policy.setCredentials(false);                  // stop reflecting credentials
```

`CorsPolicyOptions.loader` plugs in an async source of truth so the allowlist
can be kept in sync with a database or config service:

```ts
initCorsPolicy({
  loader: async () => (await db.corsAllowlist.findMany()).map((r) => r.origin),
});
await refreshAllowedOrigins(); // re-pull; fails safe — the old list is kept
```

## Middleware behaviour

| Request                                            | Response                                              |
| -------------------------------------------------- | ----------------------------------------------------- |
| No `Origin` header                                 | Passthrough; `Vary: Origin`                           |
| Allowed origin (simple GET/POST/…)                 | Reflects the origin (`Access-Control-Allow-Origin`), `Vary: Origin` |
| Denied origin                                      | Passthrough with **no** CORS headers (browser blocks) |
| Preflight (`OPTIONS` + `Access-Control-Request-Method`) | Answered with `204` + negotiated headers (or handed to the app with `preflightContinue`) |

Open mode (`*`) plus credentials never emits a bare
`Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials` —
browsers reject that combination — the concrete origin is reflected instead.

## Management endpoints (`/api/v1/cors`)

| Method      | Path            | Body / Params                                          |
| ----------- | --------------- | ------------------------------------------------------ |
| `GET`       | `/config`       | Policy: origins, wildcard, credentials, version, metrics |
| `PUT`       | `/config`       | `{ allowedOrigins, allowCredentials? }` (atomic replace) |
| `GET`       | `/origins`      | Current allowlist                                      |
| `POST`      | `/origins`      | `{ origin }` → adds one entry                          |
| `DELETE`    | `/origins?origin=…` | Removes one entry                                   |
| `POST`      | `/refresh`      | Re-pull the allowlist from the loader                  |

```bash
curl -X POST localhost:3001/api/v1/cors/origins \
  -H 'content-type: application/json' \
  -d '{"origin":"https://dashboard.example.com"}'

curl -X PUT localhost:3001/api/v1/cors/config \
  -H 'content-type: application/json' \
  -d '{"allowedOrigins":["https://app.example.com","https://*.tenant.example.com"]}'
```

Invalid input returns `400`; the current allowlist is never partially
mutated.

## Security notes

- Denied origins are passed through **without** CORS headers. The browser
  enforces the block — the API never needs to reject cross-origin requests
  itself, and proxied requests still work.
- The `corsRouter` mutates cross-origin policy for the whole API. In
  production mount it behind the API-key / ACL middleware (it follows the
  same convention as `ip-allowlistRouter` in this codebase).
- Keep `allowCredentials` disabled unless you use cookie/session auth, and
  prefer explicit origins over `*` in production.

## Performance benchmarks

Run from `backend/`:

```sh
npm run benchmark:baseline   # regenerate benchmarks/baseline.json
npm run benchmark
npm run benchmark:compare    # fail if p99 regressed >10%
```

The suite benchmarks the middleware resolving an exact origin
(`cors_allowed`), a wildcard tenant pattern (`cors_wildcard`), and a fully
negotiated preflight (`cors_preflight`) against the same logical payload.
Typical results on local hardware: exact-origin reflection ≈ 1 900 rps
(p99 ≈ 12 ms), preflight ≈ 2 800 rps (p99 ≈ 8 ms), 0 errors.

## Testing

```sh
npx vitest run src/services/__tests__/cors.test.ts \
  src/middleware/__tests__/cors.test.ts \
  src/middleware/__tests__/cors.integration.test.ts

npx vitest run --coverage \
  --coverage.include='src/services/cors.ts' \
  --coverage.include='src/middleware/cors.ts' \
  --coverage.include='src/routes/cors.ts' \
  src/services/__tests__/cors.test.ts \
  src/middleware/__tests__/cors.test.ts \
  src/middleware/__tests__/cors.integration.test.ts
```

Coverage: service ≈ 98% statements/100% lines, middleware ≈ 98%,
management router ≈ 96% — all comfortably above the 80% gate.