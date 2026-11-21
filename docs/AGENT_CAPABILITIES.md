# Agent capabilities, identity and streaming payments

AgenticPay exposes small, deterministic primitives for agent-to-agent commerce:

- `AgentMarketplace` signs a versioned capability manifest with Ed25519, hashes its canonical payload, and supports revocation. The API exposes `GET /api/v1/marketplace/manifests` and `POST /api/v1/marketplace/manifests/verify`.
- `IdentityAttestationService` issues signed verifiable credentials and checks expiry and revocation before a credential is accepted.
- `StreamingPayments` settles integer token units per second. Settlement is idempotent and `settleMany` handles multiple recipients at the same timestamp.
- The Soroban `identity` and `stream` modules contain the corresponding contract-safe value types and accounting helpers.

All signatures are verified against the exact canonical payload. Production deployments should persist manifests, credentials, revocation records, and stream balances in their tenant database rather than relying on the process-local reference stores.
