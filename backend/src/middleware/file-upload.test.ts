import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]);

function jpegBytes(): Buffer {
  return Buffer.concat([JPEG_MAGIC, Buffer.alloc(60, 0)]);
}
function pngBytes(): Buffer {
  return Buffer.concat([PNG_MAGIC, Buffer.alloc(60, 0)]);
}
function polyglotBytes(): Buffer {
  // JPEG at offset 0, embedded %PDF at offset 16 → polyglot (detected types differ).
  return Buffer.concat([JPEG_MAGIC, Buffer.alloc(16 - JPEG_MAGIC.length, 0), PDF_MAGIC, Buffer.alloc(20, 0)]);
}

function streamFromBuffer(buf: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    },
  });
}

function streamFromChunks(chunks: Buffer[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new Uint8Array(c));
      controller.close();
    },
  });
}

interface FakeResponse {
  status: number;
  ok: boolean;
  headers: { get: (name: string) => string | null };
  body: ReadableStream<Uint8Array> | null;
}

function fakeResponse(opts: {
  status?: number;
  headers?: Record<string, string>;
  body?: ReadableStream<Uint8Array> | null;
}): FakeResponse {
  const status = opts.status ?? 200;
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(opts.headers ?? {})) map.set(k.toLowerCase(), String(v));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
    body: opts.body ?? null,
  };
}

function makeTmpUploadRoots(): { root: string; uploadDir: string; quarantineDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'upload-hardening-'));
  const uploadDir = join(root, 'general');
  const quarantineDir = join(root, '.quarantine', 'general');
  mkdirSync(uploadDir, { recursive: true });
  mkdirSync(quarantineDir, { recursive: true });
  return { root, uploadDir, quarantineDir };
}

function mockRes() {
  const res = {
    statusCode: 200,
    _status: 0 as number,
    _json: null as unknown,
    status(c: number) {
      this._status = c;
      return this;
    },
    json(o: unknown) {
      this._json = o;
      return this;
    },
  };
  return res;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('sanitizeUploadFilename', () => {
  const cases: Array<[string, string | undefined | null]> = [
    ['plain', 'photo.jpg'],
    ['traversal', '../../etc/passwd'],
    ['absolute posix', '/etc/passwd'],
    ['absolute windows', 'C:\\Windows\\system32\\drivers\\etc\\hosts'],
    ['dotdot only', '..'],
    ['dotdot slash', '../../../'],
    ['empty string', ''],
    ['undefined', undefined],
    ['null', null],
    ['control chars', 'a\x00b\x1fc'],
    ['leading dots', '.env'],
    ['double dots in middle', 'file..name.txt'],
    ['windows reserved', 'con'],
    ['spaces and unicode', 'café résumé.pdf'],
  ];

  for (const [label, input] of cases) {
    it(`strips traversal/separators and yields a safe segment (${label})`, async () => {
      const { sanitizeUploadFilename } = await import('./file-upload.js');
      const result = sanitizeUploadFilename(input);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(180);
      // No path separators, no control chars, no `..`, only the safe charset.
      expect(result).not.toMatch(/[\\/]/);
      expect(result).not.toContain('..');
      expect(result).toMatch(/^[a-zA-Z0-9._-]+$/);
    });
  }

  it('reduces ../../etc/passwd to passwd', async () => {
    const { sanitizeUploadFilename } = await import('./file-upload.js');
    expect(sanitizeUploadFilename('../../etc/passwd')).toBe('passwd');
  });

  it('falls back to a random name for reserved/empty names', async () => {
    const { sanitizeUploadFilename } = await import('./file-upload.js');
    expect(sanitizeUploadFilename('con')).toMatch(/^upload-[0-9a-f]+$/);
    expect(sanitizeUploadFilename('..')).toMatch(/^upload-[0-9a-f]+$/);
    expect(sanitizeUploadFilename('')).toMatch(/^upload-[0-9a-f]+$/);
  });

  it('caps excessively long names to 180 chars', async () => {
    const { sanitizeUploadFilename } = await import('./file-upload.js');
    const result = sanitizeUploadFilename(`${'a'.repeat(400)}.txt`);
    expect(result.length).toBeLessThanOrEqual(180);
    expect(result).toMatch(/^[a-zA-Z0-9._-]+$/);
  });
});

describe('assertPathWithin', () => {
  it('accepts a path inside the root', async () => {
    const { assertPathWithin, UploadRejectionError } = await import('./file-upload.js');
    expect(() => assertPathWithin('/tmp/root', '/tmp/root/sub/file')).not.toThrow();
    expect(() => assertPathWithin('/tmp/root', '/tmp/root')).not.toThrow();
  });

  it('rejects a path that escapes via ..', async () => {
    const { assertPathWithin, UploadRejectionError } = await import('./file-upload.js');
    let err: unknown;
    try {
      assertPathWithin('/tmp/root', '/tmp/root/../other/file');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UploadRejectionError);
    expect((err as InstanceType<typeof UploadRejectionError>).reason).toBe('PATH_TRAVERSAL');
    expect((err as InstanceType<typeof UploadRejectionError>).status).toBe(400);
  });

  it('rejects an absolute path outside the root', async () => {
    const { assertPathWithin } = await import('./file-upload.js');
    expect(() => assertPathWithin('/tmp/root', '/etc/passwd')).toThrow();
  });

  it('rejects a sibling directory that shares a prefix', async () => {
    const { assertPathWithin } = await import('./file-upload.js');
    expect(() => assertPathWithin('/tmp/root', '/tmp/roothisk/file')).toThrow();
  });
});

describe('assertUploadUrlSafe — SSRF static guard', () => {
  const deny = async (url: string) => {
    const mod = await import('./file-upload.js');
    let err: unknown;
    try {
      mod.assertUploadUrlSafe(url);
    } catch (e) {
      err = e;
    }
    return err as { reason: string };
  };

  it('rejects non-http(s) schemes', async () => {
    expect((await deny('file:///etc/passwd'))?.reason).toBe('scheme_not_allowed');
    expect((await deny('gopher://x/y'))?.reason).toBe('scheme_not_allowed');
    expect((await deny('ftp://example.com/x'))?.reason).toBe('scheme_not_allowed');
  });

  it('rejects loopback / private / link-local / metadata IPs', async () => {
    expect((await deny('http://localhost/x'))?.reason).toBe('private_address');
    expect((await deny('http://127.0.0.1/x'))?.reason).toBe('private_address');
    expect((await deny('http://10.0.0.1/x'))?.reason).toBe('private_address');
    expect((await deny('http://192.168.1.1/x'))?.reason).toBe('private_address');
    expect((await deny('http://172.16.0.1/x'))?.reason).toBe('private_address');
    expect((await deny('http://169.254.169.254/latest/meta-data'))?.reason).toBe('private_address');
    expect((await deny('http://[::1]/x'))?.reason).toBe('private_address');
    expect((await deny('http://[::ffff:127.0.0.1]/x'))?.reason).toBe('private_address');
  });

  it('rejects userinfo and disallowed ports', async () => {
    expect((await deny('https://user:pass@example.com/x'))?.reason).toBe('credentials_in_url');
    expect((await deny('http://example.com:8080/x'))?.reason).toBe('port_not_allowed');
  });

  it('rejects malformed urls', async () => {
    expect((await deny('not a url at all'))?.reason).toBe('malformed_url');
  });

  it('accepts http and https on default ports', async () => {
    const mod = await import('./file-upload.js');
    expect(mod.assertUploadUrlSafe('https://example.com/x').hostname).toBe('example.com');
    expect(mod.assertUploadUrlSafe('http://example.com/x').protocol).toBe('http:');
  });
});

describe('assertHostPublic — SSRF DNS guard', () => {
  it('accepts a public IP literal without DNS', async () => {
    const { assertHostPublic } = await import('./file-upload.js');
    const resolver = vi.fn();
    await expect(assertHostPublic('93.184.216.34', resolver)).resolves.toEqual(['93.184.216.34']);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('rejects a private IP literal', async () => {
    const { assertHostPublic, UploadUrlDeniedError } = await import('./file-upload.js');
    await expect(assertHostPublic('10.1.2.3', vi.fn())).rejects.toMatchObject({ reason: 'private_address' });
  });

  it('accepts a hostname that resolves to public addresses', async () => {
    const { assertHostPublic } = await import('./file-upload.js');
    const resolver = vi.fn(async () => ['93.184.216.34']);
    await expect(assertHostPublic('example.com', resolver)).resolves.toEqual(['93.184.216.34']);
    expect(resolver).toHaveBeenCalledWith('example.com');
  });

  it('rejects a hostname that resolves to any private address', async () => {
    const { assertHostPublic } = await import('./file-upload.js');
    const resolver = vi.fn(async () => ['93.184.216.34', '10.2.3.4']);
    await expect(assertHostPublic('internal.example.com', resolver)).rejects.toMatchObject({
      reason: 'private_address',
    });
  });

  it('treats a DNS resolution failure as a transient 502', async () => {
    const { assertHostPublic, UploadRejectionError } = await import('./file-upload.js');
    const resolver = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    await expect(assertHostPublic('missing.example.com', resolver)).rejects.toMatchObject({
      reason: 'HOST_RESOLUTION_FAILED',
      status: 502,
    });
    expect(UploadRejectionError).toBeDefined();
  });
});

describe('fetchUploadFromUrl', () => {
  it('fetches a public URL and returns its bytes', async () => {
    const { fetchUploadFromUrl } = await import('./file-upload.js');
    const jpeg = jpegBytes();
    const fetchImpl = vi.fn(async () => fakeResponse({ headers: { 'content-type': 'image/jpeg' }, body: streamFromBuffer(jpeg) }));
    const resolveHost = vi.fn(async () => ['93.184.216.34']);
    const result = await fetchUploadFromUrl('https://example.com/a.jpg', { maxBytes: 1024, fetchImpl, resolveHost });
    expect(result.buffer.equals(jpeg)).toBe(true);
    expect(result.contentType).toBe('image/jpeg');
    expect(result.finalUrl).toBe('https://example.com/a.jpg');
  });

  it('rejects a non-http scheme before any network call', async () => {
    const { fetchUploadFromUrl } = await import('./file-upload.js');
    const fetchImpl = vi.fn();
    const resolveHost = vi.fn();
    await expect(
      fetchUploadFromUrl('file:///etc/passwd', { maxBytes: 1024, fetchImpl, resolveHost }),
    ).rejects.toMatchObject({ reason: 'scheme_not_allowed' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it('rejects a private IP literal', async () => {
    const { fetchUploadFromUrl } = await import('./file-upload.js');
    await expect(
      fetchUploadFromUrl('http://127.0.0.1/x', { maxBytes: 1024, fetchImpl: vi.fn(), resolveHost: vi.fn() }),
    ).rejects.toMatchObject({ reason: 'private_address' });
  });

  it('rejects a hostname that resolves to a private address', async () => {
    const { fetchUploadFromUrl } = await import('./file-upload.js');
    const resolveHost = vi.fn(async () => ['10.0.0.1']);
    await expect(
      fetchUploadFromUrl('https://internal.example.com/x', { maxBytes: 1024, fetchImpl: vi.fn(), resolveHost }),
    ).rejects.toMatchObject({ reason: 'private_address' });
  });

  it('rejects an oversized content-length without reading the body', async () => {
    const { fetchUploadFromUrl } = await import('./file-upload.js');
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ headers: { 'content-type': 'image/jpeg', 'content-length': '5000' }, body: streamFromBuffer(jpegBytes()) }),
    );
    await expect(
      fetchUploadFromUrl('https://example.com/big.jpg', { maxBytes: 100, fetchImpl, resolveHost: vi.fn(async () => ['93.184.216.34']) }),
    ).rejects.toMatchObject({ reason: 'FILE_TOO_LARGE' });
  });

  it('rejects a body that exceeds the cap even without content-length', async () => {
    const { fetchUploadFromUrl } = await import('./file-upload.js');
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ headers: { 'content-type': 'image/jpeg' }, body: streamFromChunks([Buffer.alloc(4), Buffer.alloc(4), Buffer.alloc(8)]) }),
    );
    await expect(
      fetchUploadFromUrl('https://example.com/x.jpg', { maxBytes: 10, fetchImpl, resolveHost: vi.fn(async () => ['93.184.216.34']) }),
    ).rejects.toMatchObject({ reason: 'FILE_TOO_LARGE' });
  });

  it('rejects a non-2xx response', async () => {
    const { fetchUploadFromUrl } = await import('./file-upload.js');
    const fetchImpl = vi.fn(async () => fakeResponse({ status: 404, headers: {}, body: null }));
    await expect(
      fetchUploadFromUrl('https://example.com/missing.jpg', { maxBytes: 100, fetchImpl, resolveHost: vi.fn(async () => ['93.184.216.34']) }),
    ).rejects.toMatchObject({ reason: 'FETCH_FAILED' });
  });

  it('follows a redirect to a public host', async () => {
    const { fetchUploadFromUrl } = await import('./file-upload.js');
    const jpeg = jpegBytes();
    let calls = 0;
    const fetchImpl = vi.fn(async (input: URL) => {
      calls += 1;
      if (calls === 1) return fakeResponse({ status: 302, headers: { location: 'https://cdn.example.com/a.jpg' } });
      expect(String(input)).toBe('https://cdn.example.com/a.jpg');
      return fakeResponse({ headers: { 'content-type': 'image/jpeg' }, body: streamFromBuffer(jpeg) });
    });
    const resolveHost = vi.fn(async () => ['93.184.216.34']);
    const result = await fetchUploadFromUrl('https://example.com/a.jpg', { maxBytes: 1024, fetchImpl, resolveHost });
    expect(result.buffer.equals(jpeg)).toBe(true);
    expect(result.finalUrl).toBe('https://cdn.example.com/a.jpg');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects a redirect to a private/metadata address', async () => {
    const { fetchUploadFromUrl } = await import('./file-upload.js');
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }),
    );
    await expect(
      fetchUploadFromUrl('https://example.com/a.jpg', { maxBytes: 1024, fetchImpl, resolveHost: vi.fn(async () => ['93.184.216.34']) }),
    ).rejects.toMatchObject({ reason: 'redirect_not_allowed' });
  });

  it('rejects too many redirects', async () => {
    const { fetchUploadFromUrl } = await import('./file-upload.js');
    const fetchImpl = vi.fn(async () => fakeResponse({ status: 302, headers: { location: 'https://example.com/loop' } }));
    await expect(
      fetchUploadFromUrl('https://example.com/a.jpg', { maxBytes: 1024, fetchImpl, resolveHost: vi.fn(async () => ['93.184.216.34']), maxRedirects: 1 }),
    ).rejects.toMatchObject({ reason: 'TOO_MANY_REDIRECTS' });
  });
});

describe('finalizeStoredFile', () => {
  let roots: ReturnType<typeof makeTmpUploadRoots>;

  beforeEach(() => {
    roots = makeTmpUploadRoots();
  });
  afterEach(() => {
    rmSync(roots.root, { recursive: true, force: true });
  });

  it('accepts a valid file and keeps it in the upload dir', async () => {
    const { finalizeStoredFile } = await import('./file-upload.js');
    const jpeg = jpegBytes();
    const tempPath = join(roots.uploadDir, 'test.jpeg');
    writeFileSync(tempPath, jpeg);
    const result = await finalizeStoredFile({
      tempPath,
      storedName: 'test.jpeg',
      originalName: 'test.jpeg',
      declaredMime: 'image/jpeg',
      size: jpeg.length,
      sha256: 'x',
      category: 'general',
      uploadDir: roots.uploadDir,
      quarantineDir: roots.quarantineDir,
      enableScan: false,
      headerBuf: jpeg.subarray(0, 1024),
    });
    expect(result.quarantined).toBe(false);
    expect(result.path).toBe(tempPath);
    expect(existsSync(tempPath)).toBe(true);
  });

  it('reads the header from disk when headerBuf is omitted', async () => {
    const { finalizeStoredFile } = await import('./file-upload.js');
    const jpeg = jpegBytes();
    const tempPath = join(roots.uploadDir, 'nohead.jpeg');
    writeFileSync(tempPath, jpeg);
    const result = await finalizeStoredFile({
      tempPath,
      storedName: 'nohead.jpeg',
      originalName: 'nohead.jpeg',
      declaredMime: 'image/jpeg',
      size: jpeg.length,
      sha256: 'x',
      category: 'general',
      uploadDir: roots.uploadDir,
      quarantineDir: roots.quarantineDir,
      enableScan: false,
    });
    expect(result.quarantined).toBe(false);
    expect(existsSync(tempPath)).toBe(true);
  });

  it('rejects a magic-byte mismatch and deletes the temp file', async () => {
    const { finalizeStoredFile, UploadRejectionError } = await import('./file-upload.js');
    const png = pngBytes();
    const tempPath = join(roots.uploadDir, 'liar.jpeg');
    writeFileSync(tempPath, png);
    await expect(
      finalizeStoredFile({
        tempPath,
        storedName: 'liar.jpeg',
        originalName: 'liar.jpeg',
        declaredMime: 'image/jpeg',
        size: png.length,
        sha256: 'x',
        category: 'general',
        uploadDir: roots.uploadDir,
        quarantineDir: roots.quarantineDir,
        enableScan: false,
        headerBuf: png.subarray(0, 1024),
      }),
    ).rejects.toMatchObject({ reason: 'MIME_MISMATCH' });
    expect(existsSync(tempPath)).toBe(false);
  });

  it('rejects an empty file and deletes the temp file', async () => {
    const { finalizeStoredFile } = await import('./file-upload.js');
    const tempPath = join(roots.uploadDir, 'empty.jpeg');
    writeFileSync(tempPath, Buffer.alloc(0));
    await expect(
      finalizeStoredFile({
        tempPath,
        storedName: 'empty.jpeg',
        originalName: 'empty.jpeg',
        declaredMime: 'image/jpeg',
        size: 0,
        sha256: 'x',
        category: 'general',
        uploadDir: roots.uploadDir,
        quarantineDir: roots.quarantineDir,
        enableScan: false,
        headerBuf: Buffer.alloc(0),
      }),
    ).rejects.toMatchObject({ reason: 'EMPTY_FILE' });
    expect(existsSync(tempPath)).toBe(false);
  });

  it('quarantines a polyglot file inside the quarantine dir', async () => {
    const { finalizeStoredFile } = await import('./file-upload.js');
    const poly = polyglotBytes();
    const tempPath = join(roots.uploadDir, 'poly.jpeg');
    writeFileSync(tempPath, poly);
    const result = await finalizeStoredFile({
      tempPath,
      storedName: 'poly.jpeg',
      originalName: 'poly.jpeg',
      declaredMime: 'image/jpeg',
      size: poly.length,
      sha256: 'x',
      category: 'general',
      uploadDir: roots.uploadDir,
      quarantineDir: roots.quarantineDir,
      enableScan: false,
      headerBuf: poly.subarray(0, 1024),
    });
    expect(result.quarantined).toBe(true);
    expect(result.quarantineReason).toBe('Polyglot file detected');
    expect(result.path).toContain(roots.quarantineDir);
    expect(existsSync(result.path)).toBe(true);
    expect(existsSync(tempPath)).toBe(false);
    // Containment: the quarantine path must be inside the quarantine dir.
    expect(statSync(result.path).size).toBeGreaterThan(0);
  });
});

describe('secureUrlUpload middleware', () => {
  let roots: ReturnType<typeof makeTmpUploadRoots>;

  beforeEach(() => {
    roots = makeTmpUploadRoots();
  });
  afterEach(() => {
    rmSync(roots.root, { recursive: true, force: true });
  });

  function makeOpts(extra: Record<string, unknown> = {}) {
    return {
      category: 'general' as const,
      // secureUrlUpload appends the category, so pass the base roots, not the
      // already-category-suffixed dirs the fixture exposes for finalizeStoredFile.
      uploadDir: roots.root,
      quarantineDir: join(roots.root, '.quarantine'),
      enableMalwareScan: false,
      resolveHost: async () => ['93.184.216.34'],
      ...extra,
    };
  }

  it('fetches, validates, stores, and attaches uploadedFile', async () => {
    const { secureUrlUpload } = await import('./file-upload.js');
    const jpeg = jpegBytes();
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ headers: { 'content-type': 'image/jpeg' }, body: streamFromBuffer(jpeg) }),
    );
    const req = { body: { url: 'https://example.com/a.jpg' }, params: {}, headers: {} } as never;
    const res = mockRes();
    const next = vi.fn();
    await secureUrlUpload(makeOpts({ fetchImpl }))(req as never, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBe(0);
    const uploaded = (req as { uploadedFile: { mimeType: string; size: number; path: string } }).uploadedFile;
    expect(uploaded.mimeType).toBe('image/jpeg');
    expect(uploaded.size).toBe(jpeg.length);
    expect(existsSync(uploaded.path)).toBe(true);
  });

  it('rejects a missing url', async () => {
    const { secureUrlUpload } = await import('./file-upload.js');
    const req = { body: {}, params: {}, headers: {} } as never;
    const res = mockRes();
    const next = vi.fn();
    await secureUrlUpload(makeOpts({ fetchImpl: vi.fn() }))(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ reason: 'MISSING_URL' });
  });

  it('rejects a private IP (SSRF)', async () => {
    const { secureUrlUpload } = await import('./file-upload.js');
    const req = { body: { url: 'http://127.0.0.1/x' }, params: {}, headers: {} } as never;
    const res = mockRes();
    const next = vi.fn();
    await secureUrlUpload(makeOpts({ fetchImpl: vi.fn() }))(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ reason: 'private_address' });
  });

  it('rejects a host that resolves to a private address (SSRF via DNS)', async () => {
    const { secureUrlUpload } = await import('./file-upload.js');
    const req = { body: { url: 'https://internal.example.com/x' }, params: {}, headers: {} } as never;
    const res = mockRes();
    const next = vi.fn();
    await secureUrlUpload(
      makeOpts({ fetchImpl: vi.fn(), resolveHost: async () => ['10.0.0.1'] }),
    )(req as never, res as never, next);
    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({ reason: 'private_address' });
  });

  it('rejects an unsupported media type', async () => {
    const { secureUrlUpload } = await import('./file-upload.js');
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ headers: { 'content-type': 'application/xml' }, body: streamFromBuffer(Buffer.from('<x/>')) }),
    );
    const req = { body: { url: 'https://example.com/x.xml' }, params: {}, headers: {} } as never;
    const res = mockRes();
    const next = vi.fn();
    await secureUrlUpload(makeOpts({ fetchImpl }))(req as never, res as never, next);
    expect(res._status).toBe(415);
    expect(res._json).toMatchObject({ reason: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('rejects a magic-byte mismatch with 422 and removes the stored file', async () => {
    const { secureUrlUpload } = await import('./file-upload.js');
    const png = pngBytes();
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ headers: { 'content-type': 'image/jpeg' }, body: streamFromBuffer(png) }),
    );
    const req = { body: { url: 'https://example.com/liar.jpeg' }, params: {}, headers: {} } as never;
    const res = mockRes();
    const next = vi.fn();
    await secureUrlUpload(makeOpts({ fetchImpl }))(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(422);
    expect(res._json).toMatchObject({ reason: 'MIME_MISMATCH' });
    // No accepted file should remain in the upload dir.
    expect(readdirSync(roots.uploadDir).length).toBe(0);
  });

  it('quarantines a polyglot file', async () => {
    const { secureUrlUpload } = await import('./file-upload.js');
    const poly = polyglotBytes();
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ headers: { 'content-type': 'image/jpeg' }, body: streamFromBuffer(poly) }),
    );
    const req = { body: { url: 'https://example.com/poly.jpeg' }, params: {}, headers: {} } as never;
    const res = mockRes();
    const next = vi.fn();
    await secureUrlUpload(makeOpts({ fetchImpl }))(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(422);
    expect(res._json).toMatchObject({ reason: 'Polyglot file detected' });
    const { existsSync: ex } = await import('node:fs');
    expect(ex(roots.quarantineDir)).toBe(true);
  });

  it('honours an explicit mimeType override', async () => {
    const { secureUrlUpload } = await import('./file-upload.js');
    const png = pngBytes();
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ headers: { 'content-type': 'image/jpeg' }, body: streamFromBuffer(png) }),
    );
    const req = { body: { url: 'https://example.com/a.png', mimeType: 'image/png' }, params: {}, headers: {} } as never;
    const res = mockRes();
    const next = vi.fn();
    await secureUrlUpload(makeOpts({ fetchImpl }))(req as never, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect((req as { uploadedFile: { mimeType: string } }).uploadedFile.mimeType).toBe('image/png');
  });
});
