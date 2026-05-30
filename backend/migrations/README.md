# Database Migrations (#410)

Prisma Migrate with versioned SQL under `prisma/migrations/`.

## Commands

| Command | Description |
|---------|-------------|
| `npm run db:migrate` | Apply pending migrations (`prisma migrate deploy`) |
| `npm run db:migrate:status` | Show migration status |
| `npm run db:migrate:check` | CI — detect schema drift / conflicts |
| `npm run db:rollback` | Dev — reset DB and re-apply (destructive) |
| `npm run db:rollback:one` | Dev — run `down.sql` for latest migration |
| `npm run db:seed` | Seed development data |

## Creating migrations

```bash
npx tsx migrations/runner.ts create-migration add_feature_name
```

Review generated SQL, add optional `down.sql` for reversible rollbacks.

## Deployment

`scripts/deploy.sh` runs `db:generate` + `db:migrate` before starting the backend (unless `--skip-migrations`).

## CI

`.github/workflows/migrations.yml` applies migrations against Postgres and runs `db:migrate:check`.
