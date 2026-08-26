import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { computeChecksum, verifyChecksum, parseChecksumFile, verifyBackupFile } from '../backup-integrity.js';

describe('backup-integrity', () => {
  let dir: string;
  let filePath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'backup-integrity-'));
    filePath = join(dir, 'backup.sql.gz');
    await writeFile(filePath, 'fake-backup-contents');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('computeChecksum returns the sha256 hex digest of the file contents', async () => {
    const expected = createHash('sha256').update('fake-backup-contents').digest('hex');
    const actual = await computeChecksum(filePath);
    expect(actual).toBe(expected);
  });

  it('verifyChecksum returns true for a matching checksum', async () => {
    const digest = createHash('sha256').update('fake-backup-contents').digest('hex');
    await expect(verifyChecksum(filePath, digest)).resolves.toBe(true);
  });

  it('verifyChecksum returns false for a mismatched checksum', async () => {
    await expect(verifyChecksum(filePath, '0'.repeat(64))).resolves.toBe(false);
  });

  it('verifyChecksum is case-insensitive and trims whitespace', async () => {
    const digest = createHash('sha256').update('fake-backup-contents').digest('hex');
    await expect(verifyChecksum(filePath, `  ${digest.toUpperCase()}  \n`)).resolves.toBe(true);
  });

  it('parseChecksumFile extracts the digest from sha256sum-format output', () => {
    const digest = 'a'.repeat(64);
    expect(parseChecksumFile(`${digest}  backup.sql.gz\n`)).toBe(digest);
  });

  it('parseChecksumFile throws on empty content', () => {
    expect(() => parseChecksumFile('')).toThrow();
  });

  it('verifyBackupFile reads the sibling checksum file and verifies against it', async () => {
    const digest = createHash('sha256').update('fake-backup-contents').digest('hex');
    const checksumPath = `${filePath}.sha256`;
    await writeFile(checksumPath, `${digest}  ${filePath}\n`);

    await expect(verifyBackupFile(filePath, checksumPath)).resolves.toBe(true);
  });

  it('verifyBackupFile rejects when the checksum file is missing', async () => {
    await expect(verifyBackupFile(filePath, join(dir, 'does-not-exist.sha256'))).rejects.toThrow();
  });
});
