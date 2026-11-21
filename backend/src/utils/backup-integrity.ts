// Issue #630: Standalone backup integrity helpers.
//
// scripts/backup.sh already computes and stores a `.sha256` checksum file
// alongside every backup at creation time, but its verify path never
// actually recomputed and compared it (only ran `gunzip -t`). This module
// provides the same "recompute sha256, compare against stored checksum"
// primitive as a small, tested TypeScript utility so that programmatic
// backup handling (e.g. a future scheduled job or admin API) can reuse it
// instead of shelling out.
//
// Deferred (see PR body): scheduling, S3 restore-time verification, alerting.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';

/**
 * Streams the file at `filePath` through SHA-256 and returns the hex digest.
 * Uses a stream so large backup files don't need to be buffered in memory.
 */
export function computeChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Recomputes the checksum of `filePath` and compares it against
 * `expectedChecksum`. Comparison is case-insensitive since `sha256sum`
 * output and manual hex digests may differ in case.
 */
export async function verifyChecksum(filePath: string, expectedChecksum: string): Promise<boolean> {
  const actual = await computeChecksum(filePath);
  return actual.toLowerCase() === expectedChecksum.trim().toLowerCase();
}

/**
 * Parses a `sha256sum`-style checksum file (`<hex digest>  <filename>`) and
 * returns just the hex digest. Matches the format produced by
 * `sha256sum "$filepath" > "${filepath}.sha256"` in scripts/backup.sh.
 */
export function parseChecksumFile(contents: string): string {
  const digest = contents.trim().split(/\s+/)[0];
  if (!digest) {
    throw new Error('Empty or malformed checksum file');
  }
  return digest;
}

/**
 * Verifies a backup file against its sibling `<file>.sha256` checksum file.
 * Throws if the checksum file is missing; returns false on mismatch.
 */
export async function verifyBackupFile(backupFilePath: string, checksumFilePath: string): Promise<boolean> {
  const checksumFileContents = await readFile(checksumFilePath, 'utf-8');
  const expected = parseChecksumFile(checksumFileContents);
  return verifyChecksum(backupFilePath, expected);
}
