# AgenticPay Developer Portal

Internal Next.js console for operators. The admin surface is protected by a base
operator session **plus** a fresh WebAuthn step-up assertion.

## Configuration

| Variable | Purpose |
| --- | --- |
| `WEBAUTHN_RP_ID` | Relying-party id (required) |
| `WEBAUTHN_ORIGIN` | Full ceremony origin, including scheme (required) |
| `WEBAUTHN_RP_NAME` | Browser prompt name (optional) |
| `WEBAUTHN_CHALLENGE_TTL_MS` | Challenge lifetime (default 60s) |
| `WEBAUTHN_STEP_UP_TTL_MS` | Step-up session lifetime (default 5m) |
| `WEBAUTHN_USER_VERIFICATION` | `required` (default), `preferred` or `discouraged` |
| `WEBAUTHN_STATE_DIR` | Directory for the durable credential file (default `.data`) |

The portal fails closed when either required variable is missing.

## Typed server actions

Client components call the actions in `app/actions/index.ts` directly instead of
hand-building JSON posts. Every action returns a serialisable result:

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionErrorCode; message: string };
```

| Action | Purpose |
| --- | --- |
| `startStepUpAction()` | Begin an assertion (requires the base session) |
| `finishStepUpAction(response)` | Verify the assertion and set the HttpOnly step-up cookie |
| `startEnrollAction()` | Begin registration; a second passkey requires step-up |
| `finishEnrollAction(response)` | Verify the attestation and persist the credential |

All untrusted payloads are parsed by the Zod schemas in `lib/schemas.ts` before
they reach the WebAuthn service. Validation, authentication, ceremony handling
and audit events live in `app/actions/core.ts`; the server actions and the
`app/admin/api/**` route handlers are thin adapters over that same core, so a
browser and a REST client cannot diverge in behaviour.

Errors use stable codes: `ADMIN_AUTH_REQUIRED`, `STEP_UP_REQUIRED`,
`INVALID_INPUT`, `NO_CREDENTIALS`, `CHALLENGE_INVALID`, `CREDENTIAL_UNKNOWN`,
`VERIFICATION_FAILED`, `COUNTER_REPLAYED` and `INTERNAL_ERROR`. The HTTP adapters
map these to 401/403/400/500 respectively.

## Observability

Every gate decision and ceremony outcome emits a structured JSON event through
`createSecurityEvents` (`admin.access_granted`, `admin.access_denied`,
`webauthn.*`), including `x-trace-id` / `x-request-id` correlation when present.
Rejected inputs are recorded with `reason: INVALID_INPUT`. Counters are available
via `events.snapshot()`.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run lint
```
