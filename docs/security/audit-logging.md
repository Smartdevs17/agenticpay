# Sensitive Operation Audit Logging (#793)

Every sensitive request — authentication, payments, administration, identity,
and compliance — is written to the tamper-evident audit log so security teams
can answer *who did what, when, from where, and with what result*.

## What gets logged

`backend/src/middleware/sensitiveAudit.ts` classifies request paths and, once
the response finishes, appends an entry through `auditService.logAction`:

| Field | Source |
|-------|--------|
| `timestamp` | Epoch milliseconds captured when the entry is written |
| `userId` | Authenticated user, `x-user-id`, or an API-key fingerprint |
| `action` | `<category>.<method>` (e.g. `auth.post`, `payments.post`) |
| `resource` | Sensitive category (`auth`, `payments`, `admin`, `identity`, `compliance`) |
| `resourceId` | `req.params.id` when present |
| `outcome` | `success` for 2xx/3xx, `failure` for 4xx/5xx or aborted requests |
| `ipAddress` / `userAgent` | Request metadata |
| `details` | Category, method, path, status code, duration |

### Categories

| Category | Matches |
|----------|---------|
| `auth` | `/auth`, `/login`, `/register`, `/password`, `/2fa`, `/sessions`, `/oauth` |
| `payments` | `/payments`, `/transfers`, `/payouts`, `/withdrawals`, `/refunds`, `/invoices`, `/escrow`, `/subscriptions` |
| `admin` | `/admin`, `/users`, `/roles`, `/permissions`, `/api-keys`, `/secrets`, `/merchants` |
| `identity` | `/kyb`, `/kyc`, `/verification`, `/zk-identity` |
| `compliance` | `/audit`, `/compliance`, `/security`, `/gdpr` |

## Wiring

The middleware is mounted once, before the versioned routers, so it wraps every
API route:

```ts
// backend/src/index.ts
import { auditSensitiveOperations } from './middleware/sensitiveAudit.js';

app.use(auditSensitiveOperations());
```

Customise behaviour with `sensitiveAuditMiddleware(options)`:

```ts
sensitiveAuditMiddleware({
  excludePaths: ['/api/v1/auth/refresh'], // noisy or non-sensitive routes
  actionMapper: (req, category) => `${category}:${req.method}`,
  userIdResolver: (req) => req.user?.id,
});
```

## Outcome

`AuditService.logAction` accepts an explicit `outcome`, but when it is omitted
the outcome is derived from `response.status` (`>= 400` is a failure). Aborted
connections are recorded as `failure` because they never emit `finish`.

The outcome participates in the entry hash, so tampering with it breaks
`GET /api/v1/audit/verify`.

## Querying

- `GET /api/v1/audit/entries?resource=payments&limit=50`
- `POST /api/v1/audit/log` — accepts an optional `outcome` of `success` or `failure`
- `GET /api/v1/audit/export/csv` — includes an `Outcome` column

Sensitive request bodies are sanitized before storage: `password`, `token`,
`apiKey`, `secret`, `creditCard`, and `ssn` are replaced with `[REDACTED]`.
