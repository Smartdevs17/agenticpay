// tax/index.ts — Issues #627, #690, #691, #692, #693
// Public surface for the jurisdiction-aware tax rule engine,
// automated tax reporting, multi-format export, and tax calendar.

export * from './tax-engine.js';
export * from './automated-tax-report.js';
export * from './tax-export.js';
export * from './tax-calendar.js';

import { getTaxRuleEngine } from './tax-engine.js';

/** Shared singleton, mirroring the `taxReportService` export convention in tax-reports.ts. */
export const taxRuleEngine = getTaxRuleEngine();
