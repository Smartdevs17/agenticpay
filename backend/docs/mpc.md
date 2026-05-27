# MPC threshold signing

AgenticPay signs Stellar transactions with Ed25519 keys. The original
single-key layout is a single point of compromise: any process that
touches the signer is effectively the signer. This service replaces
that with an **M-of-N threshold** scheme: the key is generated inside a
distributed ceremony, split into `N` Shamir shares, and no single host
can sign on its own.

The implementation lives under [`src/services/mpc/`](../src/services/mpc/);
the HTTP API is in [`src/routes/mpc.ts`](../src/routes/mpc.ts) mounted at
`/api/v1/mpc`.

## Architecture at a glance

```
           POST /mpc/ceremony                   POST /mpc/sign
                   │                                    │
                   ▼                                    ▼
    ┌────────────────────────────┐      ┌────────────────────────────┐
    │   coordinator.runCeremony  │      │ coordinator.startSigning… │
    └──────────┬─────────────────┘      └──────────┬─────────────────┘
               │                                   │
               ▼                                   ▼
      ┌──────────────┐                  collect N approvals
      │   shamir.ts  │ split 32-byte    from node identity keys
      │              │ seed → N shares  (verified via ed25519.ts)
      └──────┬───────┘                             │
             ▼                                     ▼
     ┌────────────────┐   when threshold met:
     │   hsm backend  │ ←──── fetch ──── coordinator reconstructs the
     │ (in-mem | Vault│                 seed in-process, signs, wipes.
     │  | KMS | HSM)  │
     └────────────────┘
```

Four primitives sit underneath: `shamir.ts` (GF(256) secret sharing),
`ed25519.ts` (key / sign / verify), `bft.ts` (equivocation + fault
bounds), and `hsm.ts` (pluggable share custody). The coordinator is a
thin orchestration layer; you can replace any single piece without
touching the others.

## What the service delivers

| Acceptance criterion              | Implementation                                             |
|-----------------------------------|------------------------------------------------------------|
| MPC key-generation ceremony       | `coordinator.runCeremony` + `POST /mpc/ceremony`           |
| Threshold Signature Scheme        | `shamir.split/reconstruct` + `signWithShares` (Ed25519)    |
| Key share storage (distributed)   | `hsm.ts` pluggable backend (Vault / KMS / HSM swap-in)     |
| Transaction signing via MPC       | `POST /mpc/sign` + `/sign/:id/contribute`                   |
| Key rotation protocol             | `rotateKey` — new seed, same key id, bumped version        |
| Member add / remove               | `addMember` / `removeMember` (re-share, public key stable) |
| Byzantine fault tolerance         | `assertByzantineCompatible` (n ≥ 3f+1, m ≥ 2f+1)           |
| HSM integration                   | `HsmBackend` interface; in-memory default; Vault hooks     |

## Ceremony protocol

Today's ceremony is a **coordinator-driven distributed key generation**.
Strictly speaking, the coordinator learns the secret once — during the
split. For a true DKG (no single party ever holds the full secret) swap
the ceremony for a Pedersen / Feldman VSS variant without touching the
storage or signing layers. The coordinator API was deliberately designed
so that this swap is local.

Steps:
1. Operators register each participating node (`POST /mpc/nodes`),
   uploading the node's Ed25519 identity public key.
2. A ceremony is kicked off with `POST /mpc/ceremony` containing the
   target threshold and the list of node IDs.
3. `runCeremony` generates a 32-byte Ed25519 seed, derives the public
   key, splits the seed via Shamir (GF(256), byte-wise), and hands one
   share to each node through the HSM backend.
4. The seed buffer is zeroised immediately after distribution.
5. The response includes the resulting `ManagedKey` (id + public key +
   threshold + node set) and the `Ceremony` record.

## Signing protocol

1. Client posts a payload to `POST /mpc/sign`. The coordinator creates
   a `SigningSession` with a configurable timeout (default 5 minutes).
2. Each approving node fetches the session, signs
   `sha256(sessionId || payload)` with its identity key, and posts the
   approval to `POST /mpc/sign/:id/contribute`.
3. The coordinator verifies the Ed25519 approval and updates the
   session. When `contributions.length >= threshold`:
   - Pulls the required number of shares from the HSM backend.
   - Runs Lagrange interpolation to reconstruct the seed in a local
     `Buffer`.
   - Signs the payload with `crypto.sign(null, payload, key)`.
   - Zeroises the reconstructed seed and the local copies of the
     shares before returning.
4. The session's `signatureHex` is populated and the state flips to
   `signed`. Further contributions are refused.

## Byzantine tolerance

`assertByzantineCompatible(threshold, nodeCount)` enforces the classical
PBFT bound: `nodes >= 3f + 1` and `threshold >= 2f + 1`, where `f` is
the maximum number of colluding or faulty nodes the scheme tolerates.
Operators can still choose a weaker threshold (e.g. 2-of-3) for dev,
but the computed `faultTolerance` drops to 0, which surfaces in
`/mpc/status` for audit dashboards.

Equivocation detection (`bft.ts`) is deliberately kept in the code path
as a safety net. With the current deterministic Ed25519 approvals it is
largely dead code, but it will immediately catch byzantine behaviour if
this service is later extended with non-deterministic contributions
(FROST / GG18 / threshold ECDSA).

## HSM integration

`HsmBackend` is a 6-method interface (`put`, `get`, `delete`,
`deleteKey`, `listNodes`, `isAvailable`). The default `InMemoryHsm` is
appropriate for tests and local dev; production operators plug in:

- **HashiCorp Vault Transit** — wraps each share under a node-specific
  KEK before `put`; `get` decrypts inside Vault.
- **AWS / GCP KMS** — a CMK per node, envelope-encrypt shares at rest.
- **CloudHSM / Fireblocks** — store shares in FIPS-grade hardware.

The interface lives in [`src/services/mpc/hsm.ts`](../src/services/mpc/hsm.ts);
runtime selection is driven by the coordinator's `setHsm()` call at
service bootstrap (follow-up PR will read the backend choice from
`VAULT_*` / `KMS_*` env vars already consumed by `vault.ts`).

## Key rotation & membership

- `POST /mpc/keys/:id/rotate` generates a **new seed**, re-splits, and
  bumps `version`. The public key changes, so Stellar accounts that
  reference the old signer must be updated (use Stellar's `setOptions`
  with the new public key + remove the old). The service emits
  `rotatedAt`; operators track the delta.
- `POST /mpc/keys/:id/members` and `DELETE /mpc/keys/:id/members/:nodeId`
  preserve the **same seed and public key** — the secret is
  reconstructed (threshold met), re-shared with the new membership set,
  and redistributed. This is the only place membership change and seed
  lifetime overlap; until FROST, there is no way to change the share
  set without briefly reconstructing the secret server-side.

## HTTP surface

| Method | Path                                       | Purpose                                       |
|--------|--------------------------------------------|-----------------------------------------------|
| GET    | `/api/v1/mpc/status`                       | Aggregate health / counts                     |
| GET    | `/api/v1/mpc/nodes`                        | List registered nodes                         |
| POST   | `/api/v1/mpc/nodes`                        | Register a node (identity pubkey)             |
| POST   | `/api/v1/mpc/nodes/:id/heartbeat`          | Liveness ping                                 |
| DELETE | `/api/v1/mpc/nodes/:id`                    | Unregister                                    |
| POST   | `/api/v1/mpc/ceremony`                     | Run a keygen ceremony                         |
| GET    | `/api/v1/mpc/ceremony`                     | List ceremonies                               |
| GET    | `/api/v1/mpc/keys`                         | List managed keys                             |
| GET    | `/api/v1/mpc/keys/:id`                     | Inspect a key                                 |
| POST   | `/api/v1/mpc/keys/:id/rotate`              | Rotate key (new seed / pubkey)                |
| POST   | `/api/v1/mpc/keys/:id/members`             | Add a member (re-share, pubkey stable)        |
| DELETE | `/api/v1/mpc/keys/:id/members/:nodeId`     | Remove a member                               |
| POST   | `/api/v1/mpc/keys/:id/revoke`              | Revoke a key                                  |
| POST   | `/api/v1/mpc/sign`                         | Request a threshold signature                 |
| GET    | `/api/v1/mpc/sign/:id`                     | Inspect a signing session                     |
| POST   | `/api/v1/mpc/sign/:id/contribute`          | Approve a pending session                     |

All error responses follow the project's standard `{ error: { code, message, status } }`
envelope via the global `errorHandler` middleware.

## Threat model (concise)

| Adversary                                              | Mitigation                                                                 |
|--------------------------------------------------------|----------------------------------------------------------------------------|
| Compromise of any `f < threshold` nodes                | Shamir guarantees < threshold shares reveal zero information about seed.   |
| Byzantine node submitting forged approval              | Ed25519 verification against pre-registered identity pubkey.               |
| Replay of approval across sessions                     | Approvals sign `sha256(sessionId || payload)`; session id is random UUID.  |
| Malicious coordinator during signing                   | Mitigated partially: coordinator must still gather threshold approvals.   |
|                                                         | Full mitigation requires FROST; documented as follow-up.                   |
| Lost node share                                        | Member replacement via `addMember` / `removeMember` preserves pubkey.      |
| HSM compromise                                         | Backend-specific — pluggable interface lets operators pick FIPS / HSM.    |

## Tests

```
npm --prefix backend test -- src/services/mpc src/routes/__tests__/mpc.test.ts
```

Covers Shamir arithmetic, Ed25519 helpers, HSM put/get/list/isolation,
BFT PBFT bounds and equivocation, the full coordinator lifecycle
(ceremony → sign → rotate → membership), and the HTTP API
(node-register → ceremony → sign → verify round trip).

## Follow-ups

- **FROST / true TSS** — swap `signWithShares` to compute partial
  signatures client-side; never reconstruct the secret in the
  coordinator. Interface already isolated.
- **Persistent state** — ceremonies, keys, and sessions are currently
  in-memory; add a SQL / KV store once an RDBMS exists in the repo.
- **Vault backend binding** — wire the existing `vault.ts` helpers to
  implement `HsmBackend` over Vault Transit.
- **Passive share refresh** — re-share the same seed periodically
  (same pubkey, new shares) to limit long-term share exposure.
