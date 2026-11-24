import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  buildSrcSet,
  createResponsiveImageLoader,
  formatFromUrl,
  ImageLoaderError,
  selectCandidate,
  validateManifest,
  type AssetManifest,
  type ImageCandidate,
  type ImageFetchResponse,
  type ImageLogger,
  type ImageMetrics,
} from './image.ts';

const manifest = JSON.parse(
  readFileSync(new URL('../../assets/manifest.json', import.meta.url), 'utf8'),
) as AssetManifest;

function harness(handler: (url: string, call: number) => ImageFetchResponse | Promise<ImageFetchResponse>, options = {}) {
  const calls: string[] = [];
  const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
  const metrics: Array<{ name: string; labels?: Record<string, string | number> }> = [];
  const logger: ImageLogger = {
    info: (event, fields) => events.push({ event, fields }),
    warn: (event, fields) => events.push({ event, fields }),
    error: (event, fields) => events.push({ event, fields }),
  };
  const meter: ImageMetrics = {
    increment: (name, labels) => metrics.push({ name, labels }),
  };
  const loader = createResponsiveImageLoader({
    manifest,
    baseUrl: '/assets/',
    fetcher: async (url) => {
      calls.push(url);
      return handler(url, calls.length);
    },
    logger,
    metrics: meter,
    ...options,
  });
  return { loader, calls, events, metrics };
}

const ok: ImageFetchResponse = { ok: true, status: 200, bytes: 1000 };
const fail: ImageFetchResponse = { ok: false, status: 503, bytes: 0 };

describe('mobile image assets', () => {
  it('ships AVIF variants that are smaller than the PNG fallbacks', () => {
    validateManifest(manifest);
    for (const asset of Object.values(manifest.images)) {
      for (const avif of asset.candidates.filter((item) => item.format === 'avif')) {
        const png = asset.candidates.find((item) => item.width === avif.width && item.format === 'png');
        assert.ok(png, `missing PNG fallback for ${avif.url}`);
        assert.ok(avif.bytes < png.bytes, `${avif.url} should be smaller than ${png.url}`);
      }
    }
  });

  it('rejects malformed manifests explicitly', () => {
    assert.throws(
      () => validateManifest({ ...manifest, version: 2 }),
      (error: unknown) => error instanceof ImageLoaderError && error.code === 'INVALID_MANIFEST',
    );
    const duplicated: AssetManifest = {
      ...manifest,
      images: {
        broken: {
          candidates: [
            { url: 'a.avif', width: 100, format: 'avif', bytes: 10 },
            { url: 'b.avif', width: 100, format: 'avif', bytes: 10 },
          ],
        },
      },
    };
    assert.throws(
      () => validateManifest(duplicated),
      (error: unknown) => error instanceof ImageLoaderError && error.code === 'INVALID_MANIFEST',
    );
  });

  it('detects formats and builds deterministic width-descriptor srcsets', () => {
    assert.equal(formatFromUrl('/assets/a.avif?v=2'), 'avif');
    assert.equal(formatFromUrl('/assets/a.JPEG'), 'jpeg');
    assert.equal(formatFromUrl('/assets/a.bin'), 'unknown');

    const candidates = manifest.images['mobile-preview'].candidates;
    assert.equal(
      buildSrcSet(candidates, 'avif'),
      'mobile-preview-320.avif 320w, mobile-preview-640.avif 640w',
    );
    assert.equal(
      buildSrcSet(candidates, 'png'),
      'mobile-preview-320.png 320w, mobile-preview-640.png 640w',
    );
  });

  it('selects the smallest covering variant and respects DPR and AVIF support', () => {
    const candidates = manifest.images['mobile-preview'].candidates;
    assert.equal(selectCandidate(candidates, { viewportWidth: 300 }).url, 'mobile-preview-320.avif');
    assert.equal(selectCandidate(candidates, { viewportWidth: 300, devicePixelRatio: 2 }).url, 'mobile-preview-640.avif');
    assert.equal(selectCandidate(candidates, { viewportWidth: 300, supportsAvif: false }).url, 'mobile-preview-320.png');
    assert.equal(selectCandidate(candidates, { viewportWidth: 2000 }).url, 'mobile-preview-640.avif');

    const ties: ImageCandidate[] = [
      { url: 'z.avif', width: 320, format: 'avif', bytes: 1 },
      { url: 'a.avif', width: 320, format: 'avif', bytes: 1 },
    ];
    assert.equal(selectCandidate(ties, { viewportWidth: 320 }).url, 'a.avif');
  });
});

describe('responsive image loader', () => {
  it('loads the AVIF candidate and records bytes, srcset and a log event', async () => {
    const h = harness(() => ok);
    const loaded = await h.loader.load('mobile-preview', { viewportWidth: 300 });

    assert.deepEqual(h.calls, ['/assets/mobile-preview-320.avif']);
    assert.equal(loaded.format, 'avif');
    assert.equal(loaded.width, 320);
    assert.equal(loaded.usedFallback, false);
    assert.match(loaded.srcSet, /avif 320w/);
    assert.ok(h.metrics.some((entry) => entry.name === 'imageLoadTotal'));
    assert.ok(h.metrics.some((entry) => entry.name === 'imageBytesTotal' && entry.labels === 1000));
    assert.ok(h.events.some((entry) => entry.event === 'image.load.completed'));
  });

  it('falls back to same-width PNG when AVIF fails', async () => {
    const h = harness((url) => (url.endsWith('.avif') ? fail : ok));
    const loaded = await h.loader.load('mobile-preview', { viewportWidth: 300 });

    assert.deepEqual(h.calls, ['/assets/mobile-preview-320.avif', '/assets/mobile-preview-320.png']);
    assert.equal(loaded.format, 'png');
    assert.equal(loaded.usedFallback, true);
    assert.ok(h.events.some((entry) => entry.event === 'image.load.fallback'));
    assert.ok(h.metrics.some((entry) => entry.name === 'imageFallbackTotal'));
  });

  it('fails actionably when both variants fail and records no load metric', async () => {
    const h = harness(() => fail);
    await assert.rejects(
      () => h.loader.load('icon', { viewportWidth: 200 }),
      (error: unknown) => error instanceof ImageLoaderError && error.code === 'LOAD_FAILED',
    );
    assert.equal(h.calls.length, 2);
    assert.ok(!h.metrics.some((entry) => entry.name === 'imageLoadTotal'));
    assert.ok(h.metrics.some((entry) => entry.name === 'imageLoadFailedTotal'));
  });

  it('rejects unknown assets and invalid requests without fetching', async () => {
    const h = harness(() => ok);
    await assert.rejects(
      () => h.loader.load('missing', { viewportWidth: 300 }),
      (error: unknown) => error instanceof ImageLoaderError && error.code === 'ASSET_NOT_FOUND',
    );
    await assert.rejects(
      () => h.loader.load('icon', { viewportWidth: 0 }),
      (error: unknown) => error instanceof ImageLoaderError && error.code === 'INVALID_REQUEST',
    );
    assert.equal(h.calls.length, 0);
  });

  it('honours a per-request AVIF capability override', async () => {
    const h = harness(() => ok);
    const loaded = await h.loader.load('icon', { viewportWidth: 150, supportsAvif: false });
    assert.deepEqual(h.calls, ['/assets/icon-192.png']);
    assert.equal(loaded.format, 'png');
  });
});
