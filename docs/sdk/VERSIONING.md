# SDK Versioning Policy

## Semantic Versioning

All AgenticPay SDKs follow [Semantic Versioning 2.0](https://semver.org/):

```
MAJOR.MINOR.PATCH
```

| Change | Version Bump | Example |
|--------|-------------|---------|
| Breaking API changes | MAJOR | 0.1.0 → 1.0.0 |
| New features (backward compatible) | MINOR | 0.1.0 → 0.2.0 |
| Bug fixes (backward compatible) | PATCH | 0.1.0 → 0.1.1 |

## API Versioning

The AgenticPay API uses URL-based versioning (`/api/v1/`, `/api/v2/`). SDKs target a specific API version and track changes via their own semver.

## Breaking Changes

Breaking changes include:
- Removing or renaming a public method or property
- Changing the type signature of a parameter or return value
- Removing an exported type or interface
- Changing error class hierarchy

Breaking changes are always released as MAJOR versions.

## Deprecation Policy

1. Deprecated features are marked with `@deprecated` JSDoc/docstring annotations
2. A migration guide is published
3. Deprecated features are removed in the next MAJOR release
4. Minimum deprecation period: 6 months

## SDK Compatibility Matrix

| SDK Version | API Version | Min. Node.js | Min. Python | Min. Go |
|-------------|-------------|--------------|-------------|---------|
| 0.1.x | v1 | 18+ | 3.8+ | 1.21+ |

## Changelog

Each SDK maintains a `CHANGELOG.md` following the [Keep a Changelog](https://keepachangelog.com/) format.

## Publishing

- **TypeScript**: Published to npm as `@agenticpay/sdk`
- **Python**: Published to PyPI as `agenticpay`
- **Go**: Available via `go get github.com/Kappa16/agenticpay/sdks/go`

### Automated Publishing

SDK publishing is automated via GitHub Actions:
- On push to `main`, SDKs are built and published
- Breaking changes are detected by comparing OpenAPI specs
- Changelogs are auto-generated from commit history
