# Provider secret rotation runbook

This runbook covers rotation of provider webhook signing secrets with automated key swap.

## Configuration

- `PROVIDER_SECRET_OVERLAP_MS` — overlap window for the old and new signing key (default: 24 hours).
- `PROVIDER_SECRET_ROTATION_CHECK_INTERVAL_MS` — rotation check interval (default: 1 hour).
- `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_SECRET_PATH` — optional HashiCorp Vault sink for rotated plaintext secrets.
- Credential labels use `provider:<provider>:webhook_signing_secret` and are stored as hashes in the rotation registry.

## Register a provider secret

Call `registerProviderSecret({ provider, rotationPolicyDays })` once when onboarding a provider. The plaintext is returned only at registration and is written to Vault when Vault is configured.

## Scheduled rotation

`startProviderSecretRotation()` runs on process startup. On each interval it:

1. Lists credentials due for rotation.
2. Rotates the credential in the rotation registry.
3. Swaps the active key in the webhook key registry with the new secret.
4. Retires the previous key for the configured overlap window.
5. Writes a tamper-evident audit entry with key IDs, provider, and overlap expiry.

No plaintext secret is included in audit entries, logs, or API responses.

## Manual rotation

Call `rotateProviderSecret({ provider, performedBy, eventType: 'manual' })`. It returns the new key ID, previous key ID, overlap expiry, and audit IDs. Update the provider dashboard with the new signing secret during the overlap window.

## Verification

- Confirm the new key ID is active in the webhook key registry.
- Confirm webhook deliveries signed with both old and new secrets verify during overlap.
- Confirm the rotation audit entry exists and contains no plaintext.
- Confirm the old key is inactive after the overlap expires.

## Emergency rotation

Use a short `overlapMs` or call `emergencyRevoke` on the credential label, then call `rotateProviderSecret` immediately. Update the provider dashboard first, then revoke the old key once delivery is confirmed.
