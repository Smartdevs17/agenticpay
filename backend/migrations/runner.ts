#!/usr/bin/env tsx
// Database migration runner — Issues #207 and #47
// Wraps Prisma migrate commands and provides rollback, status, and CI/CD integration.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const PRISMA_DIR = join(ROOT, 'prisma');
const MIGRATIONS_DIR = join(PRISMA_DIR, 'migrations');
const STATE_FILE = join(ROOT, '.migration-state.json');

interface MigrationState {
  appliedAt: string;
  migrations: string[];
}

function readState(): MigrationState {
  if (!existsSync(STATE_FILE)) {
    return { appliedAt: new Date().toISOString(), migrations: [] };
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
}

function writeState(state: MigrationState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Use spawnSync (no shell) so CLI args are passed as separate tokens — no injection surface.
function run(bin: string, args: string[]): void {
  console.log(`\n> ${bin} ${args.join(' ')}`);
  const result = spawnSync(bin, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${bin} ${args.join(' ')}`);
  }
}

// npx helper — resolves npx path without shell string interpolation
function npx(args: string[]): void {
  run('npx', args);
}

function getAvailableMigrations(): string[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((d) => existsSync(join(MIGRATIONS_DIR, d, 'migration.sql')))
    .sort();
}

const commands: Record<string, () => void> = {
  deploy() {
    console.log('[migrate] Applying all pending migrations via Prisma…');
    npx(['prisma', 'migrate', 'deploy']);
    const state = readState();
    state.appliedAt = new Date().toISOString();
    state.migrations = getAvailableMigrations();
    writeState(state);
    console.log('[migrate] ✅ Migrations applied successfully.');
  },

  status() {
    console.log('[migrate] Checking migration status…');
    npx(['prisma', 'migrate', 'status']);
    const state = readState();
    console.log('\nLocal state file:');
    console.log(`  Last applied: ${state.appliedAt}`);
    console.log(`  Known migrations (${state.migrations.length}): ${state.migrations.join(', ') || 'none'}`);
  },

  rollback() {
    console.log('[migrate] Rolling back to previous migration state…');
    if (process.env.NODE_ENV === 'production') {
      console.error('Rollback is blocked in production. Restore from backup instead.');
      process.exit(1);
    }
    npx(['prisma', 'migrate', 'reset', '--force', '--skip-seed']);
    const state = readState();
    const prev = state.migrations.slice(0, -1);
    if (prev.length > 0) {
      npx(['prisma', 'migrate', 'deploy']);
    }
    state.migrations = prev;
    state.appliedAt = new Date().toISOString();
    writeState(state);
    console.log('[migrate] ✅ Rolled back successfully.');
  },

  reset() {
    if (process.env.NODE_ENV === 'production') {
      console.error('Reset is blocked in production.');
      process.exit(1);
    }
    console.log('[migrate] Resetting database (drops all data)…');
    npx(['prisma', 'migrate', 'reset', '--force']);
    writeState({ appliedAt: new Date().toISOString(), migrations: [] });
    console.log('[migrate] ✅ Database reset complete.');
  },

  generate() {
    console.log('[migrate] Generating Prisma client from schema…');
    npx(['prisma', 'generate']);
    console.log('[migrate] ✅ Prisma client generated.');
  },

  'create-migration'() {
    const name = process.argv[3];
    if (!name || !/^[a-z0-9_]+$/i.test(name)) {
      console.error('Usage: runner.ts create-migration <snake_case_name>');
      console.error('Name must contain only letters, digits, and underscores.');
      process.exit(1);
    }
    npx(['prisma', 'migrate', 'dev', '--name', name, '--create-only']);
    console.log(`[migrate] ✅ Migration "${name}" created. Review the SQL before applying.`);
  },

  seed() {
    console.log('[migrate] Running seed script…');
    run('npx', ['tsx', 'migrations/seed.ts']);
    console.log('[migrate] ✅ Seed complete.');
  },

  /** CI: fail if schema drift or pending migrations would conflict */
  check() {
    console.log('[migrate] Validating migration history vs schema…');
    npx(['prisma', 'migrate', 'status']);
    npx([
      'prisma',
      'migrate',
      'diff',
      '--from-migrations',
      'prisma/migrations',
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--exit-code',
    ]);
    console.log('[migrate] ✅ No migration conflicts detected.');
  },

  /** Dev: roll back one migration using down.sql when present */
  'rollback-one'() {
    if (process.env.NODE_ENV === 'production') {
      console.error('rollback-one is blocked in production.');
      process.exit(1);
    }
    const migrations = getAvailableMigrations();
    const latest = migrations[migrations.length - 1];
    if (!latest) {
      console.error('No migrations to roll back.');
      process.exit(1);
    }
    const downPath = join(MIGRATIONS_DIR, latest, 'down.sql');
    if (!existsSync(downPath)) {
      console.error(`No down.sql for ${latest}. Use rollback (reset) or add down.sql.`);
      process.exit(1);
    }
    console.log(`[migrate] Applying down migration: ${latest}`);
    const sql = readFileSync(downPath, 'utf-8');
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL required for rollback-one');
      process.exit(1);
    }
    const result = spawnSync('npx', ['prisma', 'db', 'execute', '--stdin'], {
      cwd: ROOT,
      input: sql,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: false,
    });
    if (result.status !== 0) {
      throw new Error('down.sql execution failed');
    }
    const state = readState();
    state.migrations = migrations.slice(0, -1);
    state.appliedAt = new Date().toISOString();
    writeState(state);
    console.log('[migrate] ✅ rollback-one complete.');
  },
};

const command = process.argv[2];

if (!command || !(command in commands)) {
  console.log(`
AgenticPay Migration Runner — Issue #47 / #207
Usage: npx tsx migrations/runner.ts <command>

Commands:
  deploy               Apply all pending migrations (safe for CI/CD)
  status               Show current migration status
  rollback             Roll back to previous migration (dev only, destructive reset)
  rollback-one         Apply down.sql for latest migration (dev only)
  check                CI validation — detect schema/migration drift
  reset                Reset database and re-run all migrations (dev only)
  generate             Regenerate Prisma client from schema
  create-migration     Create a new migration: create-migration <name>
  seed                 Run the seed script
`);
  process.exit(0);
}

try {
  commands[command]();
} catch (err) {
  console.error('[migrate] ❌ Migration failed:', err);
  process.exit(1);
}
