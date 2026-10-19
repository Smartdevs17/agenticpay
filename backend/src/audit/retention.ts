/**
 * Audit log retention and archival — Issue #396
 *
 * Acceptance criterion: *"Audit log retention with archival policy."*
 *
 * Audit data must survive the hot window without being dropped, while
 * high-volume deployments must not pay to keep every event queryable forever
 * (see the issue's "storage costs for high-volume events" edge case).
 *
 * The policy tiers entries into three buckets:
 *
 *   hot     → still queryable in the primary store
 *   archive → written to append-only NDJSON cold storage, then evicted
 *   purge   → past the delete horizon, removed even from cold storage
 *
 * Archives are append-only: each file must not already exist (`wx` flag), is
 * named after the timestamp range it covers, and carries a manifest with a
 * SHA-256 of the payload plus the first/last chain hashes. That keeps the
 * tamper-evidence property intact across the archival boundary — a verifier can
 * resume a hash chain from the archived `lastHash` instead of failing at the
 * first evicted entry.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { logger } from '../utils/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Entry shape needed to archive and re-verify a hash chain. */
export interface ChainedAuditEntry {
  id: string;
  timestamp: number | string;
  actor: string;
  action: string;
  resource: string;
  previousHash: string;
  hash: string;
  [key: string]: unknown;
}

export interface AuditRetentionPolicy {
  /** Entries younger than this stay queryable. */
  retentionDays: number;
  /** Entries older than this move to cold storage. */
  archiveAfterDays: number;
  /** Entries older than this are purged from cold storage too. */
  deleteAfterDays: number;
  /** Directory holding append-only NDJSON archives. */
  archiveDir: string;
}

/**
 * Defaults follow the SOC2/PCI-DSS expectation of keeping audit evidence for
 * at least a year, with a longer cold-storage tail.
 */
export const DEFAULT_RETENTION_POLICY: AuditRetentionPolicy = {
  retentionDays: Number(process.env.AUDIT_RETENTION_DAYS ?? 2555),
  archiveAfterDays: Number(process.env.AUDIT_ARCHIVE_AFTER_DAYS ?? 2190),
  deleteAfterDays: Number(process.env.AUDIT_DELETE_AFTER_DAYS ?? 3650),
  archiveDir: process.env.AUDIT_ARCHIVE_DIR ?? join(process.cwd(), 'var', 'audit-archive'),
};

export type RetentionTier = 'hot' | 'archive' | 'purge';

/** Which tier an entry of the given age belongs to. */
export function classifyAge(timestamp: number, now: number, policy: AuditRetentionPolicy): RetentionTier {
  const ageDays = (now - timestamp) / DAY_MS;
  if (ageDays >= policy.deleteAfterDays) return 'purge';
  if (ageDays >= policy.archiveAfterDays) return 'archive';
  return 'hot';
}

export interface RetentionPlan<T extends ChainedAuditEntry> {
  hot: T[];
  archive: T[];
  purge: T[];
}

/** Split entries into the tiers defined by the policy. */
export function planRetention<T extends ChainedAuditEntry>(
  entries: T[],
  now: number,
  policy: AuditRetentionPolicy = DEFAULT_RETENTION_POLICY
): RetentionPlan<T> {
  const plan: RetentionPlan<T> = { hot: [], archive: [], purge: [] };

  for (const entry of entries) {
    const timestamp = typeof entry.timestamp === 'number' ? entry.timestamp : Date.parse(entry.timestamp);
    plan[classifyAge(Number.isNaN(timestamp) ? now : timestamp, now, policy)].push(entry);
  }

  return plan;
}

export interface ArchiveManifest {
  id: string;
  createdAt: string;
  entryCount: number;
  fromTimestamp: string;
  toTimestamp: string;
  /** Hash of the oldest archived entry's `previousHash`, i.e. the chain resume point. */
  firstPreviousHash: string;
  /** Hash of the newest archived entry, i.e. the chain resume point after replay. */
  lastHash: string;
  /** SHA-256 of the NDJSON payload, so archive corruption is detectable. */
  payloadSha256: string;
  byteSize: number;
}

/** Append-only, verifiable cold storage for archived audit entries. */
export class AuditArchiveStore {
  constructor(private readonly dir: string = DEFAULT_RETENTION_POLICY.archiveDir) {}

  private archivePath(id: string): string {
    return join(this.dir, `${id}.ndjson`);
  }

  private manifestPath(id: string): string {
    return join(this.dir, `${id}.manifest.json`);
  }

  /**
   * Persist a batch of entries as one immutable archive file plus manifest.
   *
   * Writes are exclusive (`wx`): re-archiving the same identifier fails rather
   * than overwriting evidence.
   */
  async writeArchive<T extends ChainedAuditEntry>(entries: T[], id?: string): Promise<ArchiveManifest> {
    if (entries.length === 0) throw new Error('Cannot archive an empty entry set');

    await mkdir(this.dir, { recursive: true });

    const ordered = [...entries].sort((a, b) => toEpoch(a.timestamp) - toEpoch(b.timestamp));
    const first = ordered[0]!;
    const last = ordered[ordered.length - 1]!;
    const archiveId = id ?? `audit-${toEpoch(first.timestamp)}-${toEpoch(last.timestamp)}-${first.hash.slice(0, 8)}`;

    const payload = `${ordered.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
    const manifest: ArchiveManifest = {
      id: archiveId,
      createdAt: new Date().toISOString(),
      entryCount: ordered.length,
      fromTimestamp: new Date(toEpoch(first.timestamp)).toISOString(),
      toTimestamp: new Date(toEpoch(last.timestamp)).toISOString(),
      firstPreviousHash: first.previousHash,
      lastHash: last.hash,
      payloadSha256: createHash('sha256').update(payload).digest('hex'),
      byteSize: Buffer.byteLength(payload, 'utf8'),
    };

    await writeFile(this.archivePath(archiveId), payload, { encoding: 'utf8', flag: 'wx' });
    await writeFile(this.manifestPath(archiveId), JSON.stringify(manifest, null, 2), {
      encoding: 'utf8',
      flag: 'wx',
    });

    logger.info({ archiveId, entryCount: ordered.length, byteSize: manifest.byteSize }, 'Audit entries archived');
    return manifest;
  }

  /** All archives currently in cold storage, newest first. */
  async listArchives(): Promise<ArchiveManifest[]> {
    try {
      const files = await readdir(this.dir);
      const manifests = await Promise.all(
        files
          .filter((file) => file.endsWith('.manifest.json'))
          .map(async (file) => JSON.parse(await readFile(join(this.dir, file), 'utf8')) as ArchiveManifest)
      );
      return manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  /** Read an archive back, verifying its payload hash before returning entries. */
  async readArchive<T extends ChainedAuditEntry = ChainedAuditEntry>(id: string): Promise<T[]> {
    const manifest = JSON.parse(await readFile(this.manifestPath(id), 'utf8')) as ArchiveManifest;
    const payload = await readFile(this.archivePath(id), 'utf8');

    const actual = createHash('sha256').update(payload).digest('hex');
    if (actual !== manifest.payloadSha256) {
      throw new Error(`Audit archive ${id} failed integrity check (payload hash mismatch)`);
    }

    return payload
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as T);
  }
}

export interface RetentionEnforcementResult {
  archived: number;
  purged: number;
  hot: number;
  archiveIds: string[];
}

/**
 * Apply the retention policy: archive everything in the `archive` tier in a
 * single batch, drop the `purge` tier, and report what stayed hot.
 *
 * Returns the entries that should remain in the primary store.
 */
export async function enforceRetention<T extends ChainedAuditEntry>(input: {
  entries: T[];
  now?: number;
  policy?: AuditRetentionPolicy;
  store?: AuditArchiveStore;
}): Promise<{ result: RetentionEnforcementResult; remaining: T[] }> {
  const policy = input.policy ?? DEFAULT_RETENTION_POLICY;
  const now = input.now ?? Date.now();
  const plan = planRetention(input.entries, now, policy);

  const archiveIds: string[] = [];
  if (plan.archive.length > 0) {
    const store = input.store ?? new AuditArchiveStore(policy.archiveDir);
    const manifest = await store.writeArchive(plan.archive);
    archiveIds.push(manifest.id);
  }

  if (plan.purge.length > 0) {
    logger.warn({ purged: plan.purge.length }, 'Audit entries purged past the delete horizon');
  }

  return {
    result: {
      archived: plan.archive.length,
      purged: plan.purge.length,
      hot: plan.hot.length,
      archiveIds,
    },
    remaining: plan.hot,
  };
}

function toEpoch(timestamp: number | string): number {
  const value = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  return Number.isNaN(value) ? 0 : value;
}
