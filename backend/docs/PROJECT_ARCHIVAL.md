# Automated Project Archival & Data Retention

Projects that go quiet are archived automatically, retained for a configurable
window, and then purged — with restoration available at any point before the
purge runs.

Service: [`backend/src/services/project-archival/index.ts`](../src/services/project-archival/index.ts)
Routes: [`backend/src/routes/project-archival.ts`](../src/routes/project-archival.ts) — mounted at `/api/v1/project-archival`
Schedule: `project-archival-sweep` in [`backend/src/config/scheduled-tasks.ts`](../src/config/scheduled-tasks.ts)

## Lifecycle

```
active/completed ──(inactive ≥ archiveAfterDays)──▶ archived ──(retention elapsed)──▶ purged
                                                       │
                                                       └──(restore)──▶ previous status
```

1. **Sweep** — the daily job scans every project and resolves the retention
   policy that applies to it.
2. **Archive** — projects whose status is listed in `eligibleStatuses` and whose
   last activity (`endDate`, else `updatedAt`) is older than `archiveAfterDays`
   are archived. An `ArchiveRecord` captures the previous status, milestone
   count, budget, and the `purgeEligibleAt` timestamp.
3. **Warn** — an archive within 7 days of its purge date emits a `purge_due`
   notification to the project owner and client.
4. **Purge** — once `purgeAfterDays` has elapsed the project, its milestones,
   and its payment releases are deleted permanently.
5. **Restore** — restoring before the purge returns the project to its
   pre-archive status and closes the archive record.

## Retention policies

Policies resolve most-specific-first: `owner` → `client` → `global`. The seeded
`default` policy is global and cannot be deleted.

| Field | Meaning |
| --- | --- |
| `scope` / `scopeId` | `global`, or `client`/`owner` bound to an id |
| `archiveAfterDays` | Inactivity required before archival |
| `purgeAfterDays` | Retention window after archival (must be ≥ `archiveAfterDays`) |
| `eligibleStatuses` | Statuses eligible for archival (default `completed`, `abandoned`) |
| `enabled` | Disabled policies are skipped during resolution |
| `notify` | Whether the policy emits archival notifications |

Defaults come from `PROJECT_ARCHIVE_AFTER_DAYS` (90) and
`PROJECT_PURGE_AFTER_DAYS` (365).

## Scheduling

The sweep runs daily at `04:00 UTC`. Override it without a code change:

```bash
SCHEDULE_OVERRIDE_PROJECT_ARCHIVAL_SWEEP="0 */6 * * *"
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/policies` | List retention policies |
| `POST` | `/policies` | Create or update a policy (pass `id` to update) |
| `DELETE` | `/policies/:policyId` | Delete a non-default policy |
| `GET` | `/candidates` | Preview what the next sweep would archive |
| `POST` | `/run` | Run the sweep now; `{ "dryRun": true }` for a no-op preview |
| `POST` | `/archive` | Archive one project immediately, bypassing the window |
| `GET` | `/archives` | List archives (`clientId`, `ownerId`, `policyId`, `includeRestored`, `includePurged`) |
| `POST` | `/restore/:projectId` | Restore the project's latest active archive |
| `GET` | `/analytics` | Archival analytics |
| `GET` | `/notifications` | Notification feed (`limit`, `projectId`) |

Reads require the `projects:read` permission, writes `projects:write`, and
policy deletion `projects:delete`.

## Analytics

`GET /analytics` returns archived/retained/restored/purged totals, the budget
value currently held in archives, pending candidate count, restoration rate,
average inactivity at archival, average time spent in retention, breakdowns by
reason, policy, and month, the next 20 upcoming purges, and `lastRunAt`.

## Notifications

Four notification types are emitted to the owner and client: `archived`,
`purge_due`, `purged`, and `restored`. The feed is capped at the 500 most recent
entries and each is mirrored to the application log.
