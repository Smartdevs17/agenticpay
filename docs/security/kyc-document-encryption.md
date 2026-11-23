# KYC document encryption at rest

KYC uploads (passports, licences, statements) are stored encrypted with a key
that belongs to the applicant's tenant (#1470).

Code: [`backend/src/services/kms.ts`](../../backend/src/services/kms.ts),
[`backend/src/compliance/documentVault.ts`](../../backend/src/compliance/documentVault.ts).

## How it works

```
KMS_MASTER_KEY
  └─ tenant key (random, versioned, stored sealed by the master key)
       └─ data key (random, one per document file)
            └─ AES-256-GCM ciphertext of the file
```

- `POST /api/v1/kyc/:userId/documents` with `fileContent` encrypts the decoded
  file before the verification provider runs. The KYC document only keeps
  `storageRef` and `encryptedAtRest: true`; the bytes are never stored on it.
  If encryption fails, the upload fails with `503 DOCUMENT_STORAGE_UNAVAILABLE`
  and nothing is kept.
- Each ciphertext is bound (as GCM additional data) to its tenant, user,
  document ID, MIME type and SHA-256 digest. Each wrapped data key is bound to
  the tenant, key version and document. A blob or key copied to another record
  or tenant fails to decrypt.
- The applicant's tenant is fixed when their profile is created
  (`req.user.tenantId`, else `X-Tenant-Id`, else `default`). Another tenant
  cannot take the profile over.
- Replacing a document deletes the previous encrypted file.

## Reading a document

`GET /api/v1/kyc/:userId/documents/:documentId/content`

- Requires an authenticated principal with role `admin`, `owner` or
  `compliance`.
- The reader's tenant comes from their credentials, never from a header, and
  must own the document; otherwise the answer is `404` (the same as a missing
  document, so references cannot be probed across tenants).
- Send `X-Access-Reason` to record why the file was opened.
- Every read and every refused cross-tenant read is written to the audit log
  (`kyc.document.read`, `kyc.document.read_denied`).
- The response is `Cache-Control: no-store` and `Content-Disposition: attachment`.

| Status | Code | Meaning |
| --- | --- | --- |
| 404 | `KYC_DOCUMENT_NOT_FOUND` | No such document for the reader's tenant |
| 404 | `KYC_DOCUMENT_NOT_STORED` | The document was submitted by URL, so there is no stored file |
| 410 | `KYC_DOCUMENT_ERASED` | The tenant key was destroyed |
| 500 | `KYC_DOCUMENT_CORRUPT` | The ciphertext failed authentication |
| 503 | `DOCUMENT_STORAGE_UNAVAILABLE` | The KMS could not unwrap the key |

## Configuration

| Variable | Required | Notes |
| --- | --- | --- |
| `KMS_MASTER_KEY` | In production | 32 bytes as 64 hex characters or base64. Generate with `openssl rand -hex 32`. Store it in the secret manager, never in the repository. |

Without `KMS_MASTER_KEY`, production refuses to start the KMS. Other
environments generate a random key per process and log a warning, so
development uploads cannot be read after a restart.

The compliance status (`GET /api/v1/compliance/status`) includes
`kyc_documents_encrypted_at_rest`: `pass` with a configured master key, `fail`
in production without one, `warn` otherwise. It also shows the vault's
counters (`encrypted`, `decrypted`, `denied_tenant`, `integrity_failure`, ...).

## Runbook

- **Rotate a tenant key.** Call `kycDocumentVault.rotateTenant(tenantId)`. New
  documents use the new version. Existing documents keep their ciphertext;
  only their wrapped data keys are moved to the new version.
- **Erase a tenant (crypto-shredding).** Call
  `kycDocumentVault.shredTenant(tenantId)`. Every version of the tenant key is
  destroyed, so any copy of the ciphertext (including backups) can never be
  decrypted again. The tenant cannot be re-keyed afterwards. This cannot be
  undone.
- **Rotate the master key.** The master key seals the tenant keys. To rotate
  it, unseal every tenant key with the old master key and seal it with the
  new one, then deploy the new `KMS_MASTER_KEY`. Do this as a one-off script
  while both keys are available.
- **Use a cloud KMS.** Implement `KmsProvider` (AWS KMS, GCP KMS, Vault
  Transit) and install it with `setKms()` at start-up. The vault only depends
  on that interface.

## Limits

The vault and the tenant keyring use in-memory stores by default, like the
rest of the KYC service. Both sit behind interfaces (`EncryptedDocumentStore`,
`TenantKeyStore`), so persistent storage can be added without changing callers.
