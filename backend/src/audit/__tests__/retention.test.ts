/**
 * Audit log retention and archival policy — Issue #396
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AuditArchiveStore,
  classifyAge,
  enforceRetention,
  planRetention,
  type AuditRetentionPolicy,
  type ChainedAuditEntry,
} from '../retention.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 1);

const POLICY: AuditRetentionPolicy = {
  retentionDays: 30,
  archiveAfterDays: 90,
  deleteAfterDays: 365,
  archiveDir: '',
};

function entry(id: string, ageDays: number, extra: Partial<ChainedAuditEntry> = {}): ChainedAuditEntry {
  return {
    id,
    timestamp: NOW - ageDays * DAY,
    actor: 'u1',
    action: 'auth.post',
    resource: 'auth',
    previousHash: `prev-${id}`,
    hash: `hash-${id}`,
    ...extra,
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'audit-archive-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('classifyAge', () => {
  it('keeps recent entries hot', () => {
    expect(classifyAge(NOW - 5 * DAY, NOW, POLICY)).toBe('hot');
  });

  it('moves entries past the archive horizon into cold storage', () => {
    expect(classifyAge(NOW - 120 * DAY, NOW, POLICY)).toBe('archive');
  });

  it('marks entries past the delete horizon for purge', () => {
    expect(classifyAge(NOW - 400 * DAY, NOW, POLICY)).toBe('purge');
  });
});

describe('planRetention', () => {
  it('splits entries into the three tiers', () => {
    const plan = planRetention([entry('hot', 1), entry('arch', 100), entry('purge', 400)], NOW, POLICY);

    expect(plan.hot.map((e) => e.id)).toEqual(['hot']);
    expect(plan.archive.map((e) => e.id)).toEqual(['arch']);
    expect(plan.purge.map((e) => e.id)).toEqual(['purge']);
  });

  it('treats unparseable timestamps as hot rather than silently deleting them', () => {
    const plan = planRetention([entry('weird', 0, { timestamp: 'not-a-date' })], NOW, POLICY);
    expect(plan.hot).toHaveLength(1);
  });
});

describe('AuditArchiveStore', () => {
  it('writes an append-only NDJSON archive plus a manifest', async () => {
    const store = new AuditArchiveStore(dir);
    // `a` is 100 days old, `b` is 101 days old, so `b` sorts first (oldest).
    const manifest = await store.writeArchive([entry('a', 100), entry('b', 101)]);

    expect(manifest.entryCount).toBe(2);
    expect(manifest.lastHash).toBe('hash-a');
    expect(manifest.firstPreviousHash).toBe('prev-b');
    expect(manifest.payloadSha256).toHaveLength(64);

    const files = await readdir(dir);
    expect(files).toEqual(expect.arrayContaining([`${manifest.id}.ndjson`, `${manifest.id}.manifest.json`]));
  });

  it('round-trips archived entries in ascending chain order', async () => {
    const store = new AuditArchiveStore(dir);
    const manifest = await store.writeArchive([entry('a', 100), entry('b', 101)]);

    const restored = await store.readArchive(manifest.id);
    expect(restored.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('refuses to overwrite an existing archive', async () => {
    const store = new AuditArchiveStore(dir);
    await store.writeArchive([entry('a', 100)], 'fixed-id');
    await expect(store.writeArchive([entry('b', 101)], 'fixed-id')).rejects.toThrow();
  });

  it('detects tampering with an archived payload', async () => {
    const store = new AuditArchiveStore(dir);
    const manifest = await store.writeArchive([entry('a', 100)], 'tamper-me');

    const file = join(dir, `${manifest.id}.ndjson`);
    await writeFile(file, (await readFile(file, 'utf8')).replace('hash-a', 'hash-evil'));

    await expect(store.readArchive(manifest.id)).rejects.toThrow(/integrity check/);
  });

  it('rejects an empty archive request', async () => {
    await expect(new AuditArchiveStore(dir).writeArchive([])).rejects.toThrow('empty entry set');
  });

  it('lists archives newest first and tolerates a missing directory', async () => {
    await expect(new AuditArchiveStore(join(dir, 'nope')).listArchives()).resolves.toEqual([]);

    const store = new AuditArchiveStore(dir);
    await store.writeArchive([entry('a', 100)], 'one');
    await store.writeArchive([entry('b', 101)], 'two');

    expect((await store.listArchives()).map((m) => m.id).sort()).toEqual(['one', 'two']);
  });
});

describe('enforceRetention', () => {
  it('archives the archive tier, purges the purge tier and keeps the rest hot', async () => {
    const store = new AuditArchiveStore(dir);
    const { result, remaining } = await enforceRetention({
      entries: [entry('hot', 1), entry('arch', 100), entry('purge', 400)],
      now: NOW,
      policy: POLICY,
      store,
    });

    expect(result.archived).toBe(1);
    expect(result.purged).toBe(1);
    expect(result.hot).toBe(1);
    expect(result.archiveIds).toHaveLength(1);
    expect(remaining.map((e) => e.id)).toEqual(['hot']);
  });

  it('does not touch cold storage when nothing is old enough', async () => {
    const store = new AuditArchiveStore(dir);
    const { result } = await enforceRetention({
      entries: [entry('hot', 1)],
      now: NOW,
      policy: POLICY,
      store,
    });

    expect(result.archived).toBe(0);
    expect(result.archiveIds).toEqual([]);
    await expect(store.listArchives()).resolves.toEqual([]);
  });
});
