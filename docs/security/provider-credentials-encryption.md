# Provider credential encryption at rest

Third-party provider credentials — Stripe secret keys, PayPal client secrets,
webhook signing secrets and OAuth client secrets — are never stored in plaintext.

## Where credentials live

- **Database columns** (e.g. `Webhook.secret`, `PushSubscription.auth`) are sealed
  transparently by the column-encryption Prisma extension. The field registry is
  defined in `backend/src/encryption/index.ts`; adding a new secret column means
  adding it to `PII_FIELDS`, not calling the crypto inline.
- **The provider credential vault** (`backend/src/services/provider-credentials.ts`)
  covers credentials that need to be read back in plaintext to call a provider.
  `ProviderCredentialVault.put()` seals the value before it is retained, and only
  `$enc1$…` ciphertext is ever kept.

## Cryptographic design

- Algorithm: **AES-256-GCM** with a random 96-bit IV per value.
- Envelope encryption: a per-tenant data-encryption key (DEK) is derived via
  **HKDF-SHA256** from the managed master key (`COLUMN_ENCRYPTION_MASTER_KEY`,
  hex-encoded 32 bytes).
- The managed master key is required in production; the development fallback exists
  only so local runs work and logs a warning.
- Decryption is authenticated: a tampered ciphertext throws rather than returning a
  partial or forged value.

## API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/v1/provider-credentials` | List credential metadata (never secrets) |
| `PUT` | `/api/v1/provider-credentials/:provider/:name` | Store or replace a secret |
| `GET` | `/api/v1/provider-credentials/:provider/:name` | Metadata for one credential |
| `POST` | `/api/v1/provider-credentials/:provider/:name/reveal` | Decrypt a secret (audited) |
| `DELETE` | `/api/v1/provider-credentials/:provider/:name` | Remove a secret |
| `POST` | `/api/v1/provider-credentials/rotate-key` | Re-encrypt everything under the current key |

## Key rotation

1. Provision the new master key as `COLUMN_ENCRYPTION_MASTER_KEY`.
2. Keep the previous key as `COLUMN_ENCRYPTION_OLD_MASTER_KEY`.
3. `POST /api/v1/provider-credentials/rotate-key`.

`rotateMasterKey()` drops the derived-key cache, decrypts each value with the old
key, re-encrypts it with the new key and bumps its version. A record that fails to
re-seal is reported in `failed` instead of aborting the whole rotation. Once every
value is rotated, remove `COLUMN_ENCRYPTION_OLD_MASTER_KEY`.

## Auditing

Every `create`, `update`, `reveal`, `rotate` and `delete` is written to the
tamper-evident audit trail (`auditService`) with the actor, provider and credential
name. The plaintext and the ciphertext are **never** part of an audit entry. Reads
are also logged field-level by the encryption primitive itself.

## Tests

`backend/src/services/__tests__/provider-credentials.test.ts` asserts that:

- stored values are ciphertext and never appear in `list()` output,
- round-tripping returns the original value,
- attributes are isolated per `(provider, name)`,
- master-key rotation re-encrypts every credential and values remain readable,
- the audit trail records the operations without leaking the secret.
