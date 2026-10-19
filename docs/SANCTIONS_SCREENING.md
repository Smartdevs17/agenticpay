# Sanctions Screening against OFAC Lists

Issue: **#923 — Add sanctions screening against OFAC lists**

AgenticPay screens counterparties and transactions against a watchlist that
models the OFAC Specially Designated Nationals (SDN) and consolidated lists, plus
EU, UN and UK OFSI lists. Screening is fuzzy: names are normalised and compared
with token and edit-distance similarity, then corroborated by strong identifiers
so transliteration, ordering and honorific differences do not hide a real hit.

## Implementation

| Layer | Location |
| --- | --- |
| Screening engine | `backend/src/services/sanctions/ofac-screening.ts` |
| HTTP API | `backend/src/routes/sanctions.ts` (mounted at `/api/v1/sanctions`) |
| Tests | `backend/src/services/sanctions/__tests__/ofac-screening.test.ts` |

## Matching algorithm

1. **Normalise** — strip diacritics and punctuation, lowercase, collapse
   whitespace, and drop honorifics/corporate noise tokens (`mr`, `ltd`, `llc`,
   `gmbh`, `pjsc`, …). `Ivanov, Sergei Petrovich` → `ivanov sergei petrovich`.
2. **Compare** — for every entity name and alias, compute the maximum of:
   - edit similarity (`1 - levenshtein / maxLength`), and
   - token-set similarity (Jaccard and token containment).
3. **Corroborate** —
   - an exact national-id match is decisive and forces a score of `1.0`;
   - a matching date of birth adds `+0.10`, a mismatch subtracts `0.05`;
   - a shared country adds `+0.05`;
   - an entity-type mismatch subtracts `0.10`.
4. **Classify** against the thresholds (defaults):
   - `score >= 0.85` → `match`
   - `0.65 <= score < 0.85` → `potential_match`
   - otherwise → `clear`

## API

### `POST /api/v1/sanctions/screen`

```json
{
  "query": { "name": "Sergey Ivanov", "countries": ["RU"] },
  "options": { "threshold": 0.85, "potentialThreshold": 0.65, "lists": ["OFAC_SDN"] }
}
```

Returns a `SanctionsScreeningResult` with `status`, ranked `matches` (each with a
`score`, matched name and `reasons`) and the thresholds used.

### `POST /api/v1/sanctions/screen/transaction`

Screens a payer and/or payee together and escalates to the highest status:

```json
{
  "transactionId": "tx_1",
  "payer": { "name": "Alice Wonderland" },
  "payee": { "name": "Ivanov, Sergei Petrovich" }
}
```

### Watchlist management

- `GET /sanctions/lists` — supported lists and current watchlist size.
- `GET /sanctions/entities?list=&entityType=&country=` — list entries.
- `GET /sanctions/entities/:id` — fetch a single entry (`404` if absent).
- `POST /sanctions/entities` — add or replace an entry.
- `DELETE /sanctions/entities/:id` — remove an entry (`404` if absent).
- `POST /sanctions/reload` — bulk-load entries, optionally replacing the list.

### `GET /api/v1/sanctions/history`

Returns recent screening decisions, filterable by `status` and `since`.

## Data source and refresh

The service seeds itself with **illustrative sample entries** so the engine is
usable out of the box. These are fictional fixtures and are not the real OFAC
list. Load production data with `loadSanctionsEntries(entries, { replace: true })`
(or `POST /sanctions/reload`) from a scheduled refresh job that downloads and
parses the official list files.

## Notes and limitations

- The watchlist and screening history are in-memory; wire them to durable storage
  before production use.
- Screening is deterministic and dependency-free so it can run inline on the
  payment path.
- Fuzzy matching intentionally favours recall (fewer false negatives); always
  require human review before freezing funds or filing reports.
