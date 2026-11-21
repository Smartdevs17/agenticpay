# Frontend route chunking and bundle analysis

Issue #369 moved heavy dashboard visualization code behind a Next.js dynamic import so the dashboard route can render its stat cards before the Recharts chunk arrives. The sidebar now prefetches likely-next dashboard routes on hover/focus to keep navigation responsive without eagerly loading every route during the initial render.

## How to compare bundle size

Run these commands from the repository root:

```bash
cd frontend
ANALYZE=true npm run build
```

The bundle analyzer opens the client/server reports and can be used to compare the dashboard route before and after this change. The expected win is that `recharts` is no longer part of the initial dashboard page chunk and is instead loaded as an async chunk with a chart skeleton fallback.

## Slow-network behavior

Dashboard chart chunks render skeleton cards while loading. If a chunk load fails, the dashboard segment error boundary displays a retry action, allowing users on slow or stale deployments to recover after the service worker activates the latest app cache.
