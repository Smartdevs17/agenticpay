# Verification quotas

Every work verification runs a paid model call, so each calling agent has a
per-minute burst limit and a daily quota on the verification endpoints (#1480).

Code: [`backend/src/services/verification.ts`](../../backend/src/services/verification.ts).

## What counts

| Endpoint | Cost |
| --- | --- |
| `POST /api/v1/verification/verify` | 1 |
| `POST /api/v1/verification/verify/batch` | 1 per item |

A request is admitted only if it fits in both windows, and is then charged to
both at once. A rejected request consumes nothing. Idempotent replays (same
`Idempotency-Key`) are answered from the idempotency cache before the quota is
checked, so they are free.

## Who is an agent

Agents are identified only from credentials the server can verify:

1. A registered API key (`X-Api-Key`): its tier from the key registry. The
   quota key is a hash of the key, never the key itself.
2. An authenticated principal (`req.user`): tier from its role if that is
   `free`, `pro` or `enterprise`, otherwise `free`. Keyed by tenant and ID.
3. Anyone else: an anonymous agent per client IP. Behind the edge worker, the
   client IP is the one the worker reports, and only when the request carries
   a verified service token with `edge:forward-client-ip` (see
   [service tokens](service-tokens.md)). Otherwise it is the socket peer.

Self-declared headers such as `X-User-Tier` or `X-Agent-Id` are ignored, so
they cannot be rotated to get fresh quota.

## Default limits

| Tier | Per minute | Per UTC day |
| --- | --- | --- |
| anonymous | 5 | 50 |
| free | 10 | 200 |
| pro | 60 | 5,000 |
| enterprise | 300 | 50,000 |

The minute window is the clock minute; the day window resets at 00:00 UTC.
`verificationQuotaService.setOverride(agentId, { perMinute, perDay })` sets
limits for one agent.

## Responses

Every verification response carries:

- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`: for the
  window closest to running out (the one that rejected, if any).
- `X-Verification-Quota-Minute-Remaining`, `X-Verification-Quota-Day-Remaining`.

| Status | Code | When |
| --- | --- | --- |
| 429 | `VERIFICATION_QUOTA_EXCEEDED` | Not enough quota left now. `Retry-After` and `details.retryAfterSeconds` say when the blocking window resets. |
| 413 | `VERIFICATION_BATCH_TOO_LARGE` | The batch is bigger than a whole window, so retrying will never succeed. Split it. |

## Storage

With `REDIS_URL` set, counters are kept in Redis and checked and charged by
one atomic script, so the limits hold across instances. Without Redis, or if
Redis fails, each instance keeps its own counters and keeps enforcing them;
quotas are never switched off.

## Observability

- Rejections are logged (`module: verification-quota`) with agent, tier,
  window, limit and cost.
- `verificationQuotaService.stats()` returns counts such as
  `free.allowed`, `anonymous.exceeded_minute` and `pro.too_large`.
