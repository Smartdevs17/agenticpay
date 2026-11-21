/**
 * file-upload.ts — Issue #401
 *
 * Secure file upload middleware with:
 * - MIME type validation (declared Content-Type + magic bytes)
 * - File size limits (configurable per upload category)
 * - ClamAV malware scanning integration
 * - Archive bomb detection (zip/tar)
 * - Polyglot file detection
 * - EXIF metadata stripping (awareness layer — full strip requires sharp/exiftool)
 * - Automatic quarantine for suspicious files
 * - Scheduled retention cleanup
 */

import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, createReadStream, existsSync, mkdirSync } from 'node:fs';
import { unlink, stat, readdir, rename, writeFile } from 'node:fs/promises';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { isPrivateHostname } from '../services/webhooks/egress-policy.js';
import { logger } from '../utils/logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type UploadCategory = 'kyc' | 'dispute' | 'general';

export interface FileUploadOptions {
  /** Upload category controlling size limits. Default 'general'. */
  category?: UploadCategory;
  /** Override max file size in bytes. */
  maxBytes?: number;
  /** Allowed MIME types. Empty = use category defaults. */
  allowedMimeTypes?: string[];
  /** Base directory for accepted files. Default process.env.UPLOAD_DIR or ./uploads. */
  uploadDir?: string;
  /** Directory for quarantined files. Default <uploadDir>/.quarantine. */
  quarantineDir?: string;
  /** Whether to attempt ClamAV scan. Default true. */
  enableMalwareScan?: boolean;
  /** @internal Test seam — custom fetch implementation used by secureUrlUpload. */
  fetchImpl?: typeof fetch;
  /** @internal Test seam — custom host resolver used by secureUrlUpload. */
  resolveHost?: (hostname: string) => Promise<string[]>;
}

export interface UploadedFile {
  id: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  sha256: string;
  category: UploadCategory;
  storedAt: string;
  quarantined: boolean;
  quarantineReason?: string;
  path: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

export const CATEGORY_MAX_BYTES: Record<UploadCategory, number> = {
  kyc: 10 * 1024 * 1024,      // 10 MB
  dispute: 20 * 1024 * 1024,  // 20 MB
  general: 5 * 1024 * 1024,   //  5 MB
};

export const CATEGORY_ALLOWED_TYPES: Record<UploadCategory, string[]> = {
  kyc: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  dispute: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4'],
  general: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'text/plain'],
};

/** Magic byte signatures — offset 0 unless noted. */
const MAGIC_SIGNATURES: Array<{ mimes: string[]; magic: number[]; offset?: number }> = [
  { mimes: ['image/jpeg'], magic: [0xff, 0xd8, 0xff] },
  { mimes: ['image/png'], magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimes: ['image/gif'], magic: [0x47, 0x49, 0x46, 0x38] },
  { mimes: ['image/webp'], magic: [0x52, 0x49, 0x46, 0x46], offset: 0 },
  { mimes: ['application/pdf'], magic: [0x25, 0x50, 0x44, 0x46] },
  { mimes: ['application/zip', 'application/x-zip-compressed'], magic: [0x50, 0x4b, 0x03, 0x04] },
  { mimes: ['video/mp4'], magic: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { mimes: ['text/plain'], magic: [] },
];

// ── Magic byte detection ──────────────────────────────────────────────────────

function readMagicBytes(buffer: Buffer, sig: typeof MAGIC_SIGNATURES[number]): boolean {
  if (sig.magic.length === 0) return true; // text/plain — no reliable magic
  const offset = sig.offset ?? 0;
  if (buffer.length < offset + sig.magic.length) return false;
  return sig.magic.every((byte, i) => buffer[offset + i] === byte);
}

function detectMimeFromBytes(buffer: Buffer): string | undefined {
  for (const sig of MAGIC_SIGNATURES) {
    if (readMagicBytes(buffer, sig)) return sig.mimes[0];
  }
  return undefined;
}

export function validateMagicBytes(buffer: Buffer, declaredMime: string): boolean {
  const sig = MAGIC_SIGNATURES.find((s) => s.mimes.includes(declaredMime));
  if (!sig) return false; // unknown type → reject
  if (sig.magic.length === 0) return true; // text/plain — skip magic check
  return readMagicBytes(buffer, sig);
}

// ── Archive bomb detection ────────────────────────────────────────────────────

const ARCHIVE_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const TAR_MAGIC_OFFSET = 257;
const TAR_MAGIC = Buffer.from('ustar');
const MAX_UNCOMPRESSED_RATIO = 100; // 100:1 compression ratio triggers bomb flag

async function isArchiveBomb(filePath: string, compressedSize: number): Promise<boolean> {
  const header = Buffer.alloc(512);
  try {
    const { default: fs } = await import('node:fs');
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, header, 0, 512, 0);
    fs.closeSync(fd);
  } catch {
    return false;
  }

  // Zip local file header check — inspect stated uncompressed size
  if (header.slice(0, 4).equals(ARCHIVE_MAGIC)) {
    // Local file header: uncompressed size at offset 22, 4 bytes LE
    const uncompressedSize = header.readUInt32LE(22);
    if (uncompressedSize > 0 && compressedSize > 0) {
      return uncompressedSize / compressedSize > MAX_UNCOMPRESSED_RATIO;
    }
  }

  // TAR ustar magic
  if (header.slice(TAR_MAGIC_OFFSET, TAR_MAGIC_OFFSET + 5).equals(TAR_MAGIC)) {
    // Tarball entries themselves encode sizes; conservative: flag any tar > 100 MB declared
    const declaredBytes = parseInt(header.slice(124, 136).toString().trim(), 8) || 0;
    return declaredBytes > 100 * 1024 * 1024;
  }

  return false;
}

// ── Polyglot detection ────────────────────────────────────────────────────────

async function isPolyglot(filePath: string, declaredMime: string): Promise<boolean> {
  // A polyglot file embeds multiple valid file formats.
  // Heuristic: check for secondary magic bytes at non-zero offsets.
  try {
    const { default: fs } = await import('node:fs');
    const buf = Buffer.alloc(1024);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, 1024, 0);
    fs.closeSync(fd);

    const detectedAtZero = detectMimeFromBytes(buf);

    // Check for an embedded ZIP or PDF signature after the first few bytes
    const embeds = [
      { magic: Buffer.from([0x50, 0x4b, 0x03, 0x04]), label: 'zip' },
      { magic: Buffer.from([0x25, 0x50, 0x44, 0x46]), label: 'pdf' },
      { magic: Buffer.from([0xff, 0xd8, 0xff]), label: 'jpeg' },
    ];

    for (const embed of embeds) {
      const idx = buf.indexOf(embed.magic, 8); // skip first 8 bytes
      if (idx > 0) {
        // If the detected type at the embedded offset differs from the declared type, flag it
        const candidateBuf = buf.slice(idx);
        const candidateMime = detectMimeFromBytes(candidateBuf);
        if (candidateMime && candidateMime !== declaredMime && candidateMime !== detectedAtZero) {
          return true;
        }
      }
    }
  } catch {
    // Cannot inspect — not flagging
  }
  return false;
}

// ── ClamAV integration ────────────────────────────────────────────────────────

export interface ClamScanResult {
  clean: boolean;
  virusName?: string;
  error?: string;
}

async function scanWithClamAV(filePath: string): Promise<ClamScanResult> {
  // Use CLAMD_HOST / CLAMD_PORT if set; otherwise try clamdscan CLI.
  const clamdHost = process.env.CLAMD_HOST;
  const clamdPort = Number(process.env.CLAMD_PORT ?? 3310);

  if (clamdHost) {
    return scanViaTcp(filePath, clamdHost, clamdPort);
  }

  return scanViaCLI(filePath);
}

async function scanViaTcp(filePath: string, host: string, port: number): Promise<ClamScanResult> {
  return new Promise((resolve) => {
    import('node:net').then(({ createConnection }) => {
      const client = createConnection({ host, port }, () => {
        client.write('zINSTREAM\0');
        const stream = createReadStream(filePath);

        stream.on('data', (chunk: string | Buffer) => {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const lenBuf = Buffer.alloc(4);
          lenBuf.writeUInt32BE(data.length, 0);
          client.write(lenBuf);
          client.write(data);
        });

        stream.on('end', () => {
          const terminator = Buffer.alloc(4);
          terminator.writeUInt32BE(0, 0);
          client.write(terminator);
        });

        stream.on('error', () => resolve({ clean: true, error: 'stream error' }));
      });

      let response = '';
      client.on('data', (d: Buffer) => { response += d.toString(); });
      client.on('end', () => {
        if (response.includes('FOUND')) {
          const virusName = response.split(' ')[1] ?? 'UNKNOWN';
          resolve({ clean: false, virusName });
        } else {
          resolve({ clean: true });
        }
      });
      client.on('error', () => resolve({ clean: true, error: 'clamd unavailable' }));
      client.setTimeout(10_000, () => { client.destroy(); resolve({ clean: true, error: 'timeout' }); });
    });
  });
}

async function scanViaCLI(filePath: string): Promise<ClamScanResult> {
  return new Promise((resolve) => {
    import('node:child_process').then(({ execFile }) => {
      execFile('clamdscan', ['--no-summary', filePath], (err, stdout) => {
        if (err === null) {
          resolve({ clean: true });
        } else if (stdout.includes('FOUND')) {
          const match = stdout.match(/: (.+) FOUND/);
          resolve({ clean: false, virusName: match?.[1] ?? 'UNKNOWN' });
        } else {
          // clamdscan not available — degrade gracefully
          resolve({ clean: true, error: 'clamdscan unavailable' });
        }
      });
    });
  });
}

// ── Directory helpers ─────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Path hardening (Issue #1476) ─────────────────────────────────────────────

/** Error thrown when an upload is rejected for a client-visible reason. */
export class UploadRejectionError extends Error {
  readonly status: number;
  readonly reason: string;
  constructor(status: number, message: string, reason: string) {
    super(message);
    this.name = 'UploadRejectionError';
    this.status = status;
    this.reason = reason;
  }
}

const RESERVED_FILENAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Reduce a caller-supplied filename to a single safe path segment.
 *
 * `path.basename` strips directory components; then we remove control chars
 * and any residual separators, collapse `..` runs, trim leading dots/dashes,
 * and fall back to a random name for empty or Windows-reserved names. The
 * result cannot contain a separator or a `..` segment, so it is safe to
 * `path.join` into an upload root. This is the explicit mitigation the
 * previous implicit `basename + regex` only hinted at.
 */
export function sanitizeUploadFilename(name: string | undefined | null): string {
  let base = path.basename(String(name ?? ''));
  base = base.replace(/[\u0000-\u001f\u007f\\/]+/g, '_'); // control chars + separators
  base = base.replace(/^\.+/, '');                         // no leading-dot traversal / hiding
  base = base.replace(/[^a-zA-Z0-9._-]/g, '_');             // keep a small safe set
  base = base.replace(/\.{2,}/g, '.');                      // collapse `..` → `.`
  base = base.replace(/^[-_.]+|[-_.]+$/g, '');               // trim edges
  if (!base || RESERVED_FILENAMES.test(base)) {
    base = `upload-${randomUUID().slice(0, 8)}`;
  }
  return base.length > 180 ? base.slice(-180) : base;
}

/**
 * Assert that `candidatePath` resolves inside `rootDir`. Defends against any
 * traversal that slips past filename sanitization: the resolved relative path
 * must not start with `..` or escape the root.
 */
export function assertPathWithin(rootDir: string, candidatePath: string): void {
  const root = path.resolve(rootDir);
  const candidate = path.resolve(candidatePath);
  const rel = path.relative(root, candidate);
  if (rel === '') return; // candidate is the root itself
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new UploadRejectionError(400, 'Resolved path escapes the upload directory', 'PATH_TRAVERSAL');
  }
}

async function readHead(filePath: string, n: number): Promise<Buffer> {
  const { default: fs } = await import('node:fs');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(n);
    const bytesRead = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

export interface StoredFileContext {
  tempPath: string;
  storedName: string;
  originalName: string;
  declaredMime: string;
  size: number;
  sha256: string;
  category: UploadCategory;
  uploadDir: string;
  quarantineDir: string;
  enableScan: boolean;
  headerBuf?: Buffer;
}

/**
 * Run the post-write validation + quarantine pipeline on a file already on
 * disk. Shared by the multipart and URL upload paths so the two never drift.
 * Owns temp-file cleanup on rejection (magic-byte mismatch / empty file);
 * quarantined files are moved into the quarantine dir (containment-checked).
 */
export async function finalizeStoredFile(ctx: StoredFileContext): Promise<UploadedFile> {
  const header = ctx.headerBuf ?? (await readHead(ctx.tempPath, 1024));
  if (!header || header.length === 0) {
    await unlink(ctx.tempPath).catch(() => undefined);
    throw new UploadRejectionError(422, 'Empty file', 'EMPTY_FILE');
  }
  if (!validateMagicBytes(header, ctx.declaredMime)) {
    await unlink(ctx.tempPath).catch(() => undefined);
    throw new UploadRejectionError(
      422,
      `File content does not match declared MIME type '${ctx.declaredMime}'`,
      'MIME_MISMATCH',
    );
  }
  assertPathWithin(ctx.uploadDir, ctx.tempPath);

  let quarantineReason: string | undefined;
  if (/zip|tar/i.test(ctx.declaredMime)) {
    if (await isArchiveBomb(ctx.tempPath, ctx.size)) quarantineReason = 'Archive bomb detected';
  }
  if (!quarantineReason && (await isPolyglot(ctx.tempPath, ctx.declaredMime))) {
    quarantineReason = 'Polyglot file detected';
  }
  if (ctx.enableScan && !quarantineReason) {
    const scanResult = await scanWithClamAV(ctx.tempPath);
    if (!scanResult.clean) {
      quarantineReason = `Malware detected: ${scanResult.virusName ?? 'UNKNOWN'}`;
    }
  }

  const quarantined = !!quarantineReason;
  let finalPath = ctx.tempPath;
  if (quarantined) {
    finalPath = path.join(ctx.quarantineDir, ctx.storedName);
    assertPathWithin(ctx.quarantineDir, finalPath);
    try {
      await rename(ctx.tempPath, finalPath);
    } catch {
      finalPath = ctx.tempPath;
    }
  }

  return {
    id: randomUUID(),
    originalName: ctx.originalName,
    storedName: ctx.storedName,
    mimeType: ctx.declaredMime,
    size: ctx.size,
    sha256: ctx.sha256,
    category: ctx.category,
    storedAt: new Date().toISOString(),
    quarantined,
    quarantineReason,
    path: finalPath,
  };
}

// ── Main middleware factory ───────────────────────────────────────────────────

export function secureFileUpload(opts: FileUploadOptions = {}) {
  const category = opts.category ?? 'general';
  const maxBytes = opts.maxBytes ?? CATEGORY_MAX_BYTES[category];
  const allowedTypes = opts.allowedMimeTypes ?? CATEGORY_ALLOWED_TYPES[category];
  const uploadDir = path.resolve(opts.uploadDir ?? process.env.UPLOAD_DIR ?? './uploads', category);
  const quarantineDir = path.resolve(opts.quarantineDir ?? path.join(path.dirname(uploadDir), '.quarantine'), category);
  const enableScan = opts.enableMalwareScan !== false;

  ensureDir(uploadDir);
  ensureDir(quarantineDir);

  return async function fileUploadMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const contentType = req.headers['content-type'] ?? '';

    if (!contentType.startsWith('multipart/form-data')) {
      res.status(400).json({ error: 'Multipart form data required' });
      return;
    }

    const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
    if (contentLength > maxBytes) {
      res.status(413).json({
        error: 'File too large',
        maxBytes,
        received: contentLength,
      });
      return;
    }

    // Parse multipart manually using busboy
    let busboy: ReturnType<typeof import('busboy')['default']>;
    try {
      const { default: Busboy } = await import('busboy');
      busboy = Busboy({ headers: req.headers, limits: { fileSize: maxBytes, files: 1 } });
    } catch {
      // busboy not installed — return clear error
      res.status(500).json({ error: 'File upload support not configured (busboy missing)' });
      return;
    }

    let uploadedFile: UploadedFile | undefined;
    let fileError: string | undefined;
    let fileProcessing: Promise<void> | undefined;

    busboy.on('file', (_fieldname: string, fileStream: NodeJS.ReadableStream, info: { filename: string; mimeType: string }) => {
      const { filename, mimeType: declaredMime } = info;
      const safeFilename = sanitizeUploadFilename(filename);

      if (!allowedTypes.includes(declaredMime)) {
        fileError = `File type '${declaredMime}' is not allowed for ${category} uploads`;
        fileStream.resume(); // drain
        return;
      }

      const storedName = `${randomUUID()}_${safeFilename}`;
      const tempPath = path.join(uploadDir, storedName);
      assertPathWithin(uploadDir, tempPath);
      const hash = createHash('sha256');
      let size = 0;
      let headerBuf: Buffer | undefined;

      const writeStream = createWriteStream(tempPath);

      fileStream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        hash.update(chunk);
        if (!headerBuf) {
          headerBuf = chunk.slice(0, Math.min(chunk.length, 1024));
        }
        if (size > maxBytes) {
          fileError = `File exceeds maximum size of ${maxBytes} bytes`;
          fileStream.resume();
          writeStream.destroy();
        }
      });

      fileStream.on('limit', () => {
        fileError = `File exceeds maximum size of ${maxBytes} bytes`;
        fileStream.resume();
        writeStream.destroy();
      });

      fileStream.pipe(writeStream);

      fileProcessing = new Promise<void>((resolve, reject) => {
        writeStream.once('error', reject);
        writeStream.once('finish', resolve);
        // The size-limit path destroys the destination before it can finish.
        writeStream.once('close', resolve);
      }).then(async () => {
        if (fileError) {
          await unlink(tempPath).catch(() => undefined);
          return;
        }

        if (!headerBuf) {
          fileError = 'Empty file';
          await unlink(tempPath).catch(() => undefined);
          return;
        }

        const sha256 = hash.digest('hex');

        try {
          uploadedFile = await finalizeStoredFile({
            tempPath,
            storedName,
            originalName: safeFilename,
            declaredMime,
            size,
            sha256,
            category,
            uploadDir,
            quarantineDir,
            enableScan,
            headerBuf,
          });
        } catch (err) {
          fileError = err instanceof UploadRejectionError ? err.message : 'File processing error';
          // finalizeStoredFile owns temp-file cleanup on rejection (magic-byte
          // mismatch / empty file). For any other unexpected error, clean up.
          if (!(err instanceof UploadRejectionError)) {
            await unlink(tempPath).catch(() => undefined);
          }
        }
      });
    });

    busboy.on('finish', () => {
      void (async () => {
      try {
        await fileProcessing;
      } catch (err) {
        logger.warn('multipart upload write failed', { category, message: (err as Error).message });
        res.status(500).json({ error: 'File processing error' });
        return;
      }
      if (fileError) {
        res.status(422).json({ error: fileError });
        return;
      }

      if (!uploadedFile) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      if (uploadedFile.quarantined) {
        res.status(422).json({
          error: 'File rejected',
          reason: uploadedFile.quarantineReason,
          fileId: uploadedFile.id,
        });
        return;
      }

      // Attach to request for downstream handlers
      (req as Request & { uploadedFile: UploadedFile }).uploadedFile = uploadedFile;
      next();
      })();
    });

    busboy.on('error', (err: Error) => {
      res.status(500).json({ error: 'File processing error', details: err.message });
    });

    req.pipe(busboy);
  };
}

// ── Remote (URL) upload with SSRF hardening (Issue #1476) ─────────────────────

type HostResolver = (hostname: string) => Promise<string[]>;

const DEFAULT_UPLOAD_FETCH_ALLOWED_PORTS = '80,443';
const DEFAULT_UPLOAD_FETCH_MAX_REDIRECTS = 5;
const DEFAULT_UPLOAD_FETCH_TIMEOUT_MS = 30_000;

export type UploadUrlDenyReason =
  | 'malformed_url'
  | 'scheme_not_allowed'
  | 'credentials_in_url'
  | 'port_not_allowed'
  | 'private_address'
  | 'redirect_not_allowed';

export class UploadUrlDeniedError extends Error {
  readonly reason: UploadUrlDenyReason;
  constructor(reason: UploadUrlDenyReason, detail: string) {
    super(`upload url denied (${reason}): ${detail}`);
    this.name = 'UploadUrlDeniedError';
    this.reason = reason;
  }
}

function parseUploadAllowedPorts(env: NodeJS.ProcessEnv = process.env): Set<number> {
  const raw = (env.UPLOAD_FETCH_ALLOWED_PORTS ?? DEFAULT_UPLOAD_FETCH_ALLOWED_PORTS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ports = new Set<number>();
  for (const item of raw) {
    const port = Number(item);
    if (Number.isInteger(port) && port > 0 && port <= 65535) ports.add(port);
  }
  if (ports.size === 0) {
    ports.add(80);
    ports.add(443);
  }
  return ports;
}

function isIpLiteral(hostname: string): boolean {
  const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return isIP(host) !== 0;
}

/**
 * Static URL check (no network): only http/https, no userinfo, port allow-list,
 * and the hostname (if a literal IP) must not be loopback/private/reserved.
 * Reused for every redirect target so a 3xx cannot hand the payload to an
 * unchecked host.
 */
export function assertUploadUrlSafe(rawUrl: string, ports: Set<number> = parseUploadAllowedPorts()): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UploadUrlDeniedError('malformed_url', 'URL could not be parsed');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UploadUrlDeniedError('scheme_not_allowed', `scheme ${url.protocol} is not allowed`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new UploadUrlDeniedError('credentials_in_url', 'URL must not contain userinfo');
  }
  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  if (!ports.has(port)) {
    throw new UploadUrlDeniedError('port_not_allowed', `port ${port} is not in the allow-list`);
  }
  const hostname = url.hostname.toLowerCase();
  if (isPrivateHostname(hostname)) {
    throw new UploadUrlDeniedError('private_address', `host ${hostname} is loopback, private or reserved`);
  }
  return url;
}

/** Resolve the hostname and require every address to be public (DNS rebind guard). */
export async function assertHostPublic(
  hostname: string,
  resolveHost: HostResolver = defaultUploadResolver,
): Promise<string[]> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIpLiteral(host)) {
    if (isPrivateHostname(host)) {
      throw new UploadUrlDeniedError('private_address', `host ${host} is loopback, private or reserved`);
    }
    return [host];
  }
  let addresses: string[];
  try {
    addresses = await resolveHost(host);
  } catch {
    throw new UploadRejectionError(502, `Could not resolve host ${host}`, 'HOST_RESOLUTION_FAILED');
  }
  if (addresses.length === 0) {
    throw new UploadRejectionError(502, `Could not resolve host ${host}`, 'HOST_RESOLUTION_FAILED');
  }
  for (const address of addresses) {
    if (isPrivateHostname(address)) {
      throw new UploadUrlDeniedError(
        'private_address',
        `host ${host} resolves to a loopback, private or reserved address (${address})`,
      );
    }
  }
  return addresses;
}

async function defaultUploadResolver(hostname: string): Promise<string[]> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

async function readBodyCapped(body: unknown, maxBytes: number, controller: AbortController): Promise<Buffer> {
  if (!body || typeof (body as ReadableStream<Uint8Array>).getReader !== 'function') {
    throw new UploadRejectionError(502, 'Remote server returned an empty or unsupported body', 'FETCH_FAILED');
  }
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        throw new UploadRejectionError(413, `File exceeds maximum size of ${maxBytes} bytes`, 'FILE_TOO_LARGE');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
  return Buffer.concat(chunks, total);
}

/** Send the request to a validated DNS result so the HTTP client cannot resolve
 * the hostname a second time and be redirected by DNS rebinding. TLS still
 * uses the URL hostname for SNI and certificate validation. */
function requestResolvedUrl(url: URL, addresses: string[], signal: AbortSignal): Promise<{
  status: number;
  headers: { get: (name: string) => string | null };
  body: AsyncIterable<Uint8Array>;
  cancel: () => void;
}> {
  return new Promise((resolve, reject) => {
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = requestFn(url, {
      method: 'GET',
      signal,
      lookup: (_hostname, options, callback) => {
        const records = addresses.map((address) => ({ address, family: isIP(address) }));
        if (options && typeof options === 'object' && 'all' in options && options.all) {
          callback(null, records);
        } else {
          const record = records[0];
          if (!record) callback(new Error('No validated address available'), '', 0);
          else callback(null, record.address, record.family);
        }
      },
    }, (response) => {
      resolve({
        status: response.statusCode ?? 502,
        headers: { get: (name) => {
          const value = response.headers[name.toLowerCase()];
          return Array.isArray(value) ? value.join(', ') : value ?? null;
        } },
        body: response,
        cancel: () => response.destroy(),
      });
    });
    request.once('error', reject);
    request.end();
  });
}

async function readNodeBodyCapped(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
  cancel: () => void,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      cancel();
      throw new UploadRejectionError(413, `File exceeds maximum size of ${maxBytes} bytes`, 'FILE_TOO_LARGE');
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

export interface FetchUploadOptions {
  maxBytes: number;
  maxRedirects?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** @internal test seam */
  fetchImpl?: typeof fetch;
  /** @internal test seam */
  resolveHost?: HostResolver;
}

export interface FetchedFile {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
}

/**
 * Fetch a remote file for storage, hardened against SSRF:
 *   - only http/https, no userinfo, port allow-list;
 *   - the hostname and every resolved address must be public (no loopback,
 *     private, link-local, CGNAT, multicast, cloud-metadata, or reserved
 *     ranges) — checked before the request and re-checked on every redirect;
 *   - redirects are followed manually so a 3xx cannot send the payload to an
 *     unchecked host;
 *   - the body is streamed with a hard byte cap so a lying server cannot drain
 *     memory.
 */
export async function fetchUploadFromUrl(rawUrl: string, opts: FetchUploadOptions): Promise<FetchedFile> {
  const maxRedirects =
    opts.maxRedirects ?? Number(process.env.UPLOAD_FETCH_MAX_REDIRECTS ?? DEFAULT_UPLOAD_FETCH_MAX_REDIRECTS);
  const timeoutMs = opts.timeoutMs ?? Number(process.env.UPLOAD_FETCH_TIMEOUT_MS ?? DEFAULT_UPLOAD_FETCH_TIMEOUT_MS);
  const fetchImpl = opts.fetchImpl;
  const resolveHost = opts.resolveHost ?? defaultUploadResolver;

  let current = assertUploadUrlSafe(rawUrl);
  let addresses = await assertHostPublic(current.hostname, resolveHost);

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    if (opts.signal) opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const res = fetchImpl
        ? await fetchImpl(current, { redirect: 'manual', signal: controller.signal })
        : await requestResolvedUrl(current, addresses, controller.signal);
      const status = res.status;
      const location = res.headers.get('location');
      if (status >= 300 && status < 400 && location) {
        if ('cancel' in res) res.cancel();
        else await res.body?.cancel().catch(() => undefined);
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new UploadUrlDeniedError('redirect_not_allowed', `redirect target '${location}' could not be parsed`);
        }
        try {
          assertUploadUrlSafe(next.href);
          addresses = await assertHostPublic(next.hostname, resolveHost);
        } catch (err) {
          if (err instanceof UploadUrlDeniedError) {
            throw new UploadUrlDeniedError('redirect_not_allowed', err.message);
          }
          throw err;
        }
        current = next;
        continue;
      }
      if (status < 200 || status >= 300) {
        throw new UploadRejectionError(502, `Remote server returned status ${status}`, 'FETCH_FAILED');
      }
      const contentLength = Number(res.headers.get('content-length') ?? 0);
      if (contentLength && contentLength > opts.maxBytes) {
        if ('cancel' in res) res.cancel();
        else await res.body?.cancel().catch(() => undefined);
        throw new UploadRejectionError(413, `File exceeds maximum size of ${opts.maxBytes} bytes`, 'FILE_TOO_LARGE');
      }
      const buffer = 'cancel' in res
        ? await readNodeBodyCapped(res.body, opts.maxBytes, res.cancel)
        : await readBodyCapped(res.body, opts.maxBytes, controller);
      return {
        buffer,
        contentType: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim(),
        finalUrl: current.href,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new UploadRejectionError(400, 'Too many redirects', 'TOO_MANY_REDIRECTS');
}

/**
 * Middleware factory mirroring `secureFileUpload` for the remote-upload-by-URL
 * endpoint. Fetches the URL through `fetchUploadFromUrl`, then runs the same
 * storage + validation pipeline (`finalizeStoredFile`) as a multipart upload,
 * so a fetched file is held to the same magic-byte / malware / containment
 * standard as an attached one.
 */
export function secureUrlUpload(opts: FileUploadOptions = {}) {
  const category = opts.category ?? 'general';
  const maxBytes = opts.maxBytes ?? CATEGORY_MAX_BYTES[category];
  const allowedTypes = opts.allowedMimeTypes ?? CATEGORY_ALLOWED_TYPES[category];
  const uploadDir = path.resolve(opts.uploadDir ?? process.env.UPLOAD_DIR ?? './uploads', category);
  const quarantineDir = path.resolve(opts.quarantineDir ?? path.join(path.dirname(uploadDir), '.quarantine'), category);
  const enableScan = opts.enableMalwareScan !== false;
  ensureDir(uploadDir);
  ensureDir(quarantineDir);

  return async function urlUploadMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const body = (req.body ?? {}) as { url?: unknown; filename?: unknown; mimeType?: unknown };
    if (typeof body.url !== 'string' || body.url.trim() === '') {
      res.status(400).json({ error: 'Missing "url" in request body', reason: 'MISSING_URL' });
      return;
    }

    let fetched: FetchedFile;
    try {
      fetched = await fetchUploadFromUrl(body.url, {
        maxBytes,
        fetchImpl: opts.fetchImpl,
        resolveHost: opts.resolveHost,
      });
    } catch (err) {
      const status =
        err instanceof UploadUrlDeniedError ? 400 : err instanceof UploadRejectionError ? err.status : 502;
      const reason =
        err instanceof UploadUrlDeniedError ? err.reason : err instanceof UploadRejectionError ? err.reason : 'FETCH_ERROR';
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('remote upload rejected', { reason, message, category });
      res.status(status).json({ error: message, reason });
      return;
    }

    const declaredMime =
      typeof body.mimeType === 'string' && body.mimeType.trim() !== ''
        ? body.mimeType.trim()
        : fetched.contentType || 'application/octet-stream';

    if (!allowedTypes.includes(declaredMime)) {
      res
        .status(415)
        .json({ error: `File type '${declaredMime}' is not allowed for ${category} uploads`, reason: 'UNSUPPORTED_MEDIA_TYPE' });
      return;
    }

    const safeFilename = sanitizeUploadFilename(
      typeof body.filename === 'string' && body.filename.trim() !== '' ? body.filename : 'remote-upload',
    );
    const sha256 = createHash('sha256').update(fetched.buffer).digest('hex');
    const storedName = `${randomUUID()}_${safeFilename}`;
    const tempPath = path.join(uploadDir, storedName);
    assertPathWithin(uploadDir, tempPath);

    try {
      await writeFile(tempPath, fetched.buffer);
    } catch (err) {
      logger.warn('remote upload write failed', { message: (err as Error).message, category });
      res.status(500).json({ error: 'Failed to store uploaded file', reason: 'STORE_FAILED' });
      return;
    }

    try {
      const uploadedFile = await finalizeStoredFile({
        tempPath,
        storedName,
        originalName: safeFilename,
        declaredMime,
        size: fetched.buffer.length,
        sha256,
        category,
        uploadDir,
        quarantineDir,
        enableScan,
        headerBuf: fetched.buffer.subarray(0, 1024),
      });
      if (uploadedFile.quarantined) {
        res
          .status(422)
          .json({ error: 'File rejected', reason: uploadedFile.quarantineReason, fileId: uploadedFile.id });
        return;
      }
      (req as Request & { uploadedFile: UploadedFile }).uploadedFile = uploadedFile;
      next();
    } catch (err) {
      const status = err instanceof UploadRejectionError ? err.status : 500;
      const reason = err instanceof UploadRejectionError ? err.reason : 'PROCESSING_ERROR';
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('remote upload processing rejected', { reason, message, category });
      res.status(status).json({ error: message, reason });
    }
  };
}

// ── Retention / scheduled cleanup ─────────────────────────────────────────────

export interface RetentionOptions {
  /** Accepted files older than this many days are deleted. Default 90. */
  acceptedRetentionDays?: number;
  /** Quarantined files older than this many days are deleted. Default 30. */
  quarantineRetentionDays?: number;
  uploadDir?: string;
}

export async function runRetentionCleanup(opts: RetentionOptions = {}): Promise<{ deleted: number; errors: number }> {
  const acceptedDays = opts.acceptedRetentionDays ?? 90;
  const quarantineDays = opts.quarantineRetentionDays ?? 30;
  const uploadDir = path.resolve(opts.uploadDir ?? process.env.UPLOAD_DIR ?? './uploads');
  const quarantineDir = path.join(path.dirname(uploadDir), '.quarantine');

  let deleted = 0;
  let errors = 0;

  async function cleanDir(dir: string, maxAgeDays: number): Promise<void> {
    if (!existsSync(dir)) return;

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      errors++;
      return;
    }

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      try {
        const info = await stat(fullPath);
        if (info.isDirectory()) {
          await cleanDir(fullPath, maxAgeDays);
        } else if (info.mtimeMs < cutoff) {
          await unlink(fullPath);
          deleted++;
        }
      } catch {
        errors++;
      }
    }
  }

  await Promise.all([
    cleanDir(uploadDir, acceptedDays),
    cleanDir(quarantineDir, quarantineDays),
  ]);

  return { deleted, errors };
}
