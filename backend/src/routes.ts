/**
 * backend/src/routes.ts
 *
 * Thin re-export module pointing to backend/src/routes/index.ts.
 * Maintained under Issue #1400 for backward compatibility with existing imports.
 */

export * from './routes/index.js';
export { apiV1Router as default } from './routes/index.js';
