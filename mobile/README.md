# Mobile image assets and responsive loader

Issue #1640: the mobile image path was serving large PNGs at every viewport,
which dominated tail latency on slow connections. Assets now ship AVIF variants
with PNG fallbacks, and the loader chooses one deterministic candidate per
device width.

## What ships

`mobile/assets/` contains:

| Asset | AVIF | PNG fallback | Saving |
| --- | --- | --- | --- |
| Icon 192px | 3.3 KB | 58.3 KB | ~94% |
| Icon 512px | 16.2 KB | 364.5 KB | ~95% |
| Preview 320px | 13.6 KB | 467 KB | ~97% |
| Preview 640px | 34.2 KB | 1.55 MB | ~98% |

`mobile/assets/manifest.json` is the single source of truth: it lists each
candidate's URL, width, format and byte size. Valid widths and formats are
checked at loader construction; malformed entries are rejected rather than
skipped.

## Loader interface

`mobile/src/lib/image.ts` exports:

- `createResponsiveImageLoader(options)` / `ResponsiveImageLoader` — `load(id, request)` returns the chosen URL, width, format, actual bytes, a width-descriptor `srcset`, and whether a fallback was used.
- `selectCandidate(candidates, request, preferredFormats?)` — smallest variant covering `viewportWidth × devicePixelRatio`, with deterministic ties (width, then URL).
- `buildSrcSet(candidates, format)` — `url 320w, url 640w` strings for the chosen format.
- `formatFromUrl`, `validateManifest`, and typed `ImageLoaderError` codes (`INVALID_MANIFEST`, `INVALID_REQUEST`, `ASSET_NOT_FOUND`, `NO_CANDIDATE`, `LOAD_FAILED`).

Options: manifest, optional `baseUrl`, injected `fetcher`, `logger`, `metrics`,
`supportsAvif`, and `fallbackFormat` (PNG by default). A per-request
`supportsAvif` override is supported.

## Failure behavior and observability

If the preferred AVIF fetch fails, the loader retries the same-width PNG once,
logs `image.load.fallback` with both URLs and the reason, and increments
`imageFallbackTotal`. If both fail, it throws `LOAD_FAILED`, logs
`image.load.failed` and increments `imageLoadFailedTotal` without recording a
successful load. Successful loads emit `image.load.completed` plus
`imageLoadTotal` (labelled by format) and `imageBytesTotal` (actual response
bytes). Fetch exceptions are logged as `image.fetch.error`.

## Compatibility and configuration

The loader has no framework dependency: callers pass a fetcher and wire the
resulting URL/srcset into their image component. Adding a new asset means
adding its variants plus a manifest entry; no loader changes are needed. PNG
fallbacks keep non-AVIF clients working, and AVIF can be disabled globally or
per request.

## Validation

- `node --experimental-strip-types --test mobile/src/lib/image.test.ts` — 9 tests covering manifest validation, format detection, srcset generation, DPR selection, deterministic ties, AVIF happy path, PNG fallback, total failure and capability overrides.
