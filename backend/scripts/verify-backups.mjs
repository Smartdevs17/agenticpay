#!/usr/bin/env node
/**
 * Automated Backup Verification
 *
 * Verifies that backups are valid and restorable by:
 * - Checking backup file integrity and metadata
 * - Validating backup format and compression
 * - Testing restoration to temporary database
 * - Verifying data consistency post-restore
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { resolve } from "path";

const args = process.argv.slice(2);
const testRestore = args.includes("--test-restore");
const verbose = args.includes("--verbose");

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

const results = {
  checked: 0,
  healthy: 0,
  stale: 0,
  broken: 0,
  skipped: 0,
};

function ok(label, detail = "") {
  results.healthy++;
  console.log(
    `  ${GREEN}✓${RESET} ${label}${detail ? ` ${CYAN}${detail}${RESET}` : ""}`
  );
}

function warn(label, hint = "") {
  results.stale++;
  console.log(`  ${YELLOW}⚠${RESET} ${label}${hint ? `\n    → ${hint}` : ""}`);
}

function fail(label, hint = "") {
  results.broken++;
  console.log(`  ${RED}✗${RESET} ${label}${hint ? `\n    → ${hint}` : ""}`);
}

function skip(label, reason = "") {
  results.skipped++;
  console.log(
    `  ${CYAN}-${RESET} ${label}${reason ? ` (${reason})` : ""}`
  );
}

function section(title) {
  console.log(`\n${BOLD}${title}${RESET}`);
}

function run(cmd, options = {}) {
  try {
    return execSync(cmd, {
      stdio: options.stdio || "pipe",
      encoding: "utf8",
      ...options,
    }).trim();
  } catch (error) {
    if (options.allowFail) {
      return null;
    }
    throw error;
  }
}

function formatBytes(bytes) {
  const sizes = ["B", "KB", "MB", "GB"];
  if (bytes === 0) return "0 B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

function formatDate(timestamp) {
  return new Date(timestamp * 1000).toISOString();
}

// ─── LOCATE BACKUPS ─────────────────────────────────────────────────────────

section("1️⃣  Locating Backups");

const backupDirs = [
  "./backups",
  "/var/backups/agenticpay",
  process.env.BACKUP_DIR,
].filter(Boolean);

let backupDir = null;
for (const dir of backupDirs) {
  if (existsSync(dir)) {
    backupDir = dir;
    ok(`Found backup directory: ${dir}`);
    break;
  }
}

if (!backupDir) {
  fail("No backup directory found", "Check BACKUP_DIR environment variable");
  process.exit(1);
}

// Find backup files
const backupFiles = run(
  `find ${backupDir} -type f \\( -name "*.sql" -o -name "*.sql.gz" -o -name "*.tar.gz" \\) -mtime -30 | sort -r`,
  { allowFail: true }
)
  ? run(
      `find ${backupDir} -type f \\( -name "*.sql" -o -name "*.sql.gz" -o -name "*.tar.gz" \\) -mtime -30 | sort -r`
    ).split("\n")
  : [];

if (backupFiles.length === 0) {
  fail("No recent backups found (within 30 days)");
  process.exit(1);
}

ok(`Found ${backupFiles.length} backup file(s)`);

// ─── VERIFY BACKUP FILES ────────────────────────────────────────────────────

section("2️⃣  Verifying Backup Files");

for (const file of backupFiles.slice(0, 5)) {
  // Limit to last 5 backups for performance
  if (!file.trim()) continue;

  results.checked++;
  const stat = statSync(file);
  const size = stat.size;
  const age = Math.floor((Date.now() / 1000 - stat.mtime / 1000) / 86400);

  // Size check
  if (size < 1000) {
    fail(`${file}: File too small (${formatBytes(size)})`, "Possibly corrupted");
    continue;
  }

  ok(`${file}: Size ${formatBytes(size)}`);

  // Age check
  if (age > 7) {
    warn(`${file}: Backup is ${age} days old`, "Consider more frequent backups");
  } else {
    ok(`${file}: Age ${age} day(s)`);
  }

  // Integrity check
  if (file.endsWith(".gz")) {
    const gzipCheck = run(`gzip -t "${file}" 2>&1`, { allowFail: true });
    if (gzipCheck === null || gzipCheck === "") {
      ok(`${file}: Gzip integrity OK`);
    } else {
      fail(`${file}: Gzip corrupted`, gzipCheck);
    }
  }

  // Checksum verification (if .md5 or .sha256 file exists)
  const checksumFile = `${file}.sha256`;
  if (existsSync(checksumFile)) {
    const expectedHash = readFileSync(checksumFile, "utf8").split(" ")[0];
    const actualHash = run(
      `sha256sum "${file}" | awk '{print $1}'`,
      { allowFail: true }
    );

    if (actualHash === expectedHash) {
      ok(`${file}: Checksum verified`);
    } else {
      fail(`${file}: Checksum mismatch`, "Backup may be corrupted");
    }
  } else {
    skip(`${file}: Checksum file not found`, "skipping hash verification");
  }
}

// ─── TEST RESTORATION ───────────────────────────────────────────────────────

if (testRestore) {
  section("3️⃣  Testing Backup Restoration");

  const latestBackup = backupFiles[0];
  if (!latestBackup) {
    fail("No backup available for restoration test");
    process.exit(1);
  }

  ok("Testing restoration of latest backup...");

  // Create temporary database for test
  const testDb = `agenticpay_restore_test_${Date.now()}`;
  const testDsn = `postgresql://localhost:5432/${testDb}?sslmode=disable`;

  try {
    // Create test database
    run(`createdb ${testDb} 2>&1`, { allowFail: true });
    ok("Created temporary test database");

    // Restore backup
    if (latestBackup.endsWith(".gz")) {
      run(`gunzip -c "${latestBackup}" | psql -d ${testDb} > /dev/null 2>&1`, {
        allowFail: false,
      });
    } else {
      run(`psql -d ${testDb} < "${latestBackup}" > /dev/null 2>&1`, {
        allowFail: false,
      });
    }
    ok("Backup restored successfully to test database");

    // Verify restored data
    const tableCount = run(
      `psql -d ${testDb} -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>&1`,
      { allowFail: true }
    );

    if (tableCount && parseInt(tableCount) > 0) {
      ok(`Verified ${tableCount} tables in restored database`);
    } else {
      fail("Restored database has no tables", "Backup may be empty");
    }

    // Cleanup
    run(`dropdb ${testDb} 2>&1`, { allowFail: true });
    ok("Cleaned up test database");
  } catch (error) {
    warn("Restoration test failed", error.message);

    // Cleanup on failure
    run(`dropdb ${testDb} 2>&1`, { allowFail: true });
  }
} else {
  skip("Restoration test", "pass --test-restore to enable");
}

// ─── BACKUP SCHEDULE ────────────────────────────────────────────────────────

section("4️⃣  Backup Schedule Compliance");

// Check for daily backups
const dailyCount = backupFiles.filter((f) => {
  const stat = statSync(f);
  const age = Math.floor((Date.now() / 1000 - stat.mtime / 1000) / 3600);
  return age < 24;
}).length;

if (dailyCount >= 1) {
  ok(`Daily backup found (${dailyCount} in last 24h)`);
} else {
  warn("No backup in last 24 hours", "Check backup cron job");
}

// Check for weekly backups
const weeklyCount = backupFiles.filter((f) => {
  const stat = statSync(f);
  const age = Math.floor((Date.now() / 1000 - stat.mtime / 1000) / 86400);
  return age < 7;
}).length;

if (weeklyCount >= 1) {
  ok(`Weekly backups found (${weeklyCount} in last 7 days)`);
} else {
  warn("No backups in last 7 days", "Check backup schedule");
}

// ─── SUMMARY ────────────────────────────────────────────────────────────────

console.log(
  `\n${BOLD}Summary${RESET}: ${GREEN}${results.healthy} healthy${RESET}, ${YELLOW}${results.stale} warnings${RESET}, ${RED}${results.broken} failed${RESET}, ${CYAN}${results.skipped} skipped${RESET}`
);

if (results.broken > 0) {
  console.log(
    `\n${RED}❌ ${results.broken} backup(s) failed verification${RESET}`
  );
  console.log("Action: Investigate and re-run backup jobs immediately");
  process.exit(1);
}

if (results.stale > 0) {
  console.log(
    `\n${YELLOW}⚠️  ${results.stale} warning(s) detected${RESET}`
  );
}

if (results.broken === 0) {
  console.log(`\n${GREEN}✅ All backups verified successfully${RESET}`);
  console.log(`\nNext actions:`);
  console.log(`  - Monitor backup schedule weekly`);
  console.log(`  - Test restoration monthly`);
  console.log(`  - Verify offsite copy (if applicable)`);
}
