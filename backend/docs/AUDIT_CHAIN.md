# Tamper-Evident Audit Logging

Issue #1356 — cryptographic hash chain over audit entries.

## How it works

Each audit entry stores:

- `previousHash` — SHA-256 of the prior entry (genesis `00…00` for the first)
- `hash` — SHA-256 over identity fields + `previousHash`

Verification walks the retained chain from the chain anchor and recomputes hashes. Any edit or deletion in the hot log breaks verification.

## Surfaces

| Path | Purpose |
|------|---------|
| Middleware `backend/src/middleware/audit.ts` | Writes chained entries after each response |
| `GET /api/v1/audit/verify` | Integrity check + `chainTip`, `entryCount`, `algorithm` |
| `GET /api/v1/audit/chain` | Chain tip without requiring a full CSV/JSON export |

Middleware entries carry `details.hashAlgorithm = sha256` so exported logs identify the chain algorithm. Chain tips are read from the endpoints below rather than response headers, since entries are written after the response finishes.

## Example

```bash
curl -s "$API/api/v1/audit/chain" | jq
# { "algorithm": "sha256", "chainTip": "...", "entryCount": 12, "valid": true }
```
