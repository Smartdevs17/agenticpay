# SEP-10 Auth Evaluation — Recommendation

**Issue:** #418  
**Date:** 2026-06-24  
**Status:** Recommendation — Adopt in phases; defer full implementation past v0.4

---

## Summary

SEP-10 (Stellar Web Authentication) is a suitable long-term authentication primitive for AgenticPay given its Stellar-native architecture, but it is **not the right thing to implement now**. The current repository has no backend auth middleware, no protected API routes, and no JWT issuance or validation layer. Adopting SEP-10 on top of that gap would layer a Stellar-specific auth protocol onto a foundation that is not ready for any authentication at the API level.

**Recommendation: Phase SEP-10 adoption.**

- Batch 0 (now, v0.4): No SEP-10 work. Stabilise the existing testnet build.
- Batch 1: Add a minimal API auth layer (JWT + Stellar public key in session). Design type and service boundaries to be SEP-10-aware.
- Batch 2+: Implement SEP-10 challenge/verify on `backend/src/services/stellar.ts`. Migrate wallet-authenticated sessions to SEP-10 JWTs.

---

## What SEP-10 Is

SEP-10 defines a challenge–response authentication flow for Stellar wallets:

1. **Backend issues a challenge**: A time-bounded Stellar transaction (not submitted to the network) signed by the server's Stellar key. The transaction contains a `manageData` operation with a nonce and the server domain.
2. **Client signs the challenge**: The wallet (e.g. Freighter) signs the transaction with the user's Stellar keypair and returns the signed XDR.
3. **Backend verifies and issues a JWT**: The server verifies the signature(s), checks the nonce and time bounds, and returns a signed JWT that the client uses as a bearer token for subsequent API calls.

Key protocol properties:
- No password or secret is transmitted.
- The JWT audience is scoped to the specific server domain (`home_domain`).
- Supports multisig accounts (multiple signers can co-sign the challenge).
- The JWT is short-lived (typically 1–24 hours), stateless, and contains the Stellar account address as the `sub` claim.
- Specified in full at: https://stellar.org/protocol/sep-10

---

## Current Repository Auth State

| Area | Current state |
|------|--------------|
| `frontend/store/useAuthStore.ts` | Tracks `address`, `email`, `loginType` (`'wallet'` \| `'social'`). No SEP-10 token. No backend token sent on API calls. |
| `frontend/components/auth/WalletConnect.tsx` | Connects Freighter. Does not call a backend challenge endpoint. |
| `frontend/lib/web3auth.ts` | Social login via Web3Auth. Returns an address + provider info, not a Stellar keypair. |
| `backend/src/middleware/` | No `authenticate` or `requireAuth` middleware exists. All routes are effectively unauthenticated. |
| `backend/src/routes/sessions.ts` | Exists but handles social-login session state, not Stellar keypair auth. |
| `backend/src/services/stellar.ts` | Horizon client + transaction builder. No challenge generation or signature verification. |
| `backend/src/services/2fa-service.ts` | TOTP 2FA exists for social-login users. Independent of wallet auth. |
| `packages/types/src/exports.ts` | `User` type has `id`, `email`, `displayName`, `role`. No `stellarPublicKey`, no `sep10Jwt`. |

There is no `apps/stellar-service` or `apps/api` directory in this repository. The issue refers to these as logical boundaries; they map to `backend/src/services/stellar.ts` and `backend/` (the Express API), respectively.

---

## Fit Analysis

### Where SEP-10 fits well in AgenticPay

- **Wallet-authenticated users**: Any user connecting via Freighter already has a Stellar keypair. SEP-10 replaces the implicit trust of "user told us their address" with a cryptographic proof of key ownership.
- **Agent-to-agent payments** (long-term roadmap): Autonomous agents need to authenticate without human interaction. SEP-10 is stateless and programmatic — a natural fit.
- **Mainnet launch**: A formal security audit will flag unauthenticated API routes. SEP-10 provides a well-specified, auditable auth mechanism that reviewers in the Stellar ecosystem already understand.
- **`backend/src/middleware/internalSignature.ts`**: Service-to-service signing already exists. SEP-10 extends this pattern to user-facing authentication.

### Where SEP-10 does not fit yet

- **Social login users (Web3Auth)**: Web3Auth generates a keypair on behalf of the user, but the UX and key-management path differ from Freighter. A SEP-10 challenge requires the client to sign with the Stellar key — this is technically possible with Web3Auth but requires careful integration and adds UX friction today.
- **TOTP 2FA users**: The current 2FA flow is for social-login accounts and is orthogonal to SEP-10. Merging them before a stable auth layer exists creates unnecessary coupling.
- **No protected routes today**: Implementing SEP-10 when no route requires authentication means the implementation cannot be exercised and will likely drift or break unnoticed.

---

## Tradeoffs

### Benefits of adopting SEP-10

- Cryptographic proof of Stellar account ownership replaces implicit address trust.
- JWT-based sessions are stateless and cache-friendly; fits the existing ETag/caching infrastructure.
- Aligns with Stellar ecosystem standards; anchor integrations, SEP-31 cross-border payments, and future SEP-6/SEP-24 (deposit/withdraw) all expect SEP-10 for auth.
- Reduces custom auth surface area: the challenge/verify flow is specified and has reference implementations (`@stellar/stellar-sdk` supports it directly).
- Enables agent-to-agent payment flows without human login.

### Risks and implementation costs

- `backend/src/services/stellar.ts` needs `challenge()` and `verify()` functions. The server must have its own Stellar keypair (`STELLAR_SECRET_KEY`) configured and rotated.
- `backend/src/middleware/` needs an `authenticate` middleware that validates the SEP-10 JWT on protected routes.
- `packages/types/src/exports.ts` `User` type needs `stellarPublicKey?: string` and the session model needs a `sep10Jwt` field.
- `frontend/store/useAuthStore.ts` needs a `sep10Token` field and the Freighter connect flow must call the challenge endpoint and sign before setting `isAuthenticated: true`.
- Social-login users (Web3Auth) either need a parallel session strategy or Web3Auth's embedded wallet must be used to sign the SEP-10 challenge. This is non-trivial.
- Rotating the server Stellar keypair invalidates all active JWTs — needs a key rotation strategy.
- Time-bound challenges require the client clock and server clock to be reasonably in sync. Drift can cause spurious auth failures.

### Developer experience impact

- Adds a mandatory async round-trip (challenge fetch → sign → verify) before any API call from a wallet user. This is one extra step in the login flow.
- The JWT is standard and works with existing `Authorization: Bearer` middleware patterns — no exotic tooling.
- `@stellar/stellar-sdk` provides `Utils.buildChallengeTx` and `Utils.verifyChallengeTxSigned` — the core implementation is small (~50–100 lines per service).
- Social-login developers need to understand two parallel auth paths until they are unified.

### Operational complexity

- Server Stellar keypair must be managed as a secret (`STELLAR_SECRET_KEY` is already referenced in the README but not yet used for auth).
- JWT signing key (separate from Stellar keypair) needs to be stored securely.
- Short-lived JWTs reduce the blast radius of a leaked token but require refresh logic on the frontend.
- No new infrastructure is required — Horizon is already available; no SEP-10 server binary is needed.

### Alignment with current repository maturity

The repo is on testnet, has no auth middleware, and is in v0.4 hardening. Introducing SEP-10 now would be premature. The better path is to establish the auth scaffolding (JWT middleware, `authenticate` guard, protected route examples) first, then slot SEP-10 into the challenge/verify layer.

---

## SEP-10-Aware Boundaries

These are the interfaces and types that should be designed with future SEP-10 support in mind, even before implementation:

### Shared types (`packages/types/src/exports.ts`)

```typescript
// Future additions — do not add yet, but design User to accommodate:
// stellarPublicKey?: string;   — the verified Stellar G-address
// authMethod: 'social' | 'sep10' | 'both';
```

The `User` type does **not** need to change now, but new fields must not conflict with these future additions. Avoid using `stellarPublicKey` for any other purpose.

### `backend/` (maps to `apps/api` in the issue)

- `backend/src/middleware/`: The slot for a future `authenticate.ts` that validates either a SEP-10 JWT or a social-login session token. The middleware interface should accept both and attach a normalised `req.user` object.
- `backend/src/routes/sessions.ts`: Should eventually issue SEP-10 JWTs in addition to social-login sessions. Keep session creation and verification logic in a service layer (`backend/src/services/session.ts` already exists) rather than inline in route handlers.
- `backend/src/routes/2fa.ts`: TOTP 2FA is orthogonal to SEP-10 for wallet users. When both auth paths coexist, 2FA should apply to social-login sessions only unless explicitly extended.

### `backend/src/services/stellar.ts` (maps to `apps/stellar-service` in the issue)

This is the natural home for SEP-10 challenge generation and verification:

```typescript
// Future functions — not to be added now:
// export function buildSep10Challenge(accountId: string, clientDomain?: string): string  // returns XDR
// export function verifySep10Challenge(signedXdr: string, accountId: string): boolean
```

The existing `server` (Horizon client) and `networkPassphrase` variables are already what SEP-10 verification needs. No new infrastructure dependencies are required.

### Frontend (`frontend/`)

- `frontend/store/useAuthStore.ts`: Reserve the `sep10Token` field name. Do not introduce conflicting state.
- `frontend/components/auth/WalletConnect.tsx`: The Freighter connect flow is the integration point. After wallet address is obtained, a future step calls `GET /api/v1/auth/challenge?account=<G-address>` then signs and posts to `POST /api/v1/auth/verify`.
- `frontend/lib/web3auth.ts`: Social login path. Needs separate treatment — either Web3Auth embedded wallet signs the challenge, or social-login users authenticate via a different session token.

---

## Batch Planning

### Batch 0 — Current (v0.4, now)

No SEP-10 work. Focus: production hardening as per the roadmap (Zod env validation, retry logic, caching, infrastructure).

Preparatory actions that cost nothing:
- Do not use `stellarPublicKey` as a field name for anything other than the Stellar G-address.
- Do not put auth logic inline in route handlers — keep it in service functions so it is easy to replace.

### Batch 1 — Auth scaffold (pre-mainnet)

Minimal viable auth layer that SEP-10 slots into:

1. Add `authenticate.ts` middleware to `backend/src/middleware/` — accepts a bearer JWT, attaches `req.user`.
2. Add a session token issuance endpoint to `backend/src/routes/sessions.ts` — initially can issue opaque tokens for social-login users.
3. Add `stellarPublicKey?: string` to `packages/types/src/exports.ts` `User` type.
4. Protect at least one sensitive route (e.g. invoice creation, project creation) with the `authenticate` middleware. This creates the test surface.
5. Document the auth flow in `docs/` so that SEP-10 implementation has a spec to work against.

None of this requires SEP-10 — it creates the foundation.

### Batch 2 — SEP-10 implementation

With the auth scaffold in place:

1. Add `buildSep10Challenge` and `verifySep10Challenge` to `backend/src/services/stellar.ts`.
2. Add `GET /api/v1/auth/challenge` and `POST /api/v1/auth/verify` to `backend/src/routes/stellar.ts` (or a new `backend/src/routes/auth.ts`).
3. Update `frontend/components/auth/WalletConnect.tsx` to call challenge/verify after Freighter signs.
4. Update `frontend/store/useAuthStore.ts` to store the SEP-10 JWT and send it as `Authorization: Bearer` on API calls.
5. Update `frontend/lib/api.ts` to attach the bearer token from the store.

### Batch 3 — Unify social and wallet auth

After SEP-10 is live for wallet users, evaluate whether Web3Auth's embedded wallet can sign SEP-10 challenges, or whether social-login users remain on a separate session token path. Decide before mainnet.

---

## References

- SEP-10 specification: https://stellar.org/protocol/sep-10
- Stellar SDK helpers: `StellarSdk.Utils.buildChallengeTx`, `StellarSdk.Utils.verifyChallengeTxSigned`, `StellarSdk.Utils.verifyChallengeTxThreshold`
- Freighter signing API: `signTransaction()` in `@stellar/freighter-api`
- Web3Auth + Stellar: https://web3auth.io/docs/connect-blockchain/other/stellar
