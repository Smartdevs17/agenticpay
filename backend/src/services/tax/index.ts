// tax/index.ts — Issue #627
// Public surface for the jurisdiction-aware tax rule engine.

export * from './tax-engine.js';

import { getTaxRuleEngine } from './tax-engine.js';

/** Shared singleton, mirroring the `taxReportService` export convention in tax-reports.ts. */
export const taxRuleEngine = getTaxRuleEngine();
