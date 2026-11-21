// fx/index.ts — Issue #626
// Re-exports + shared FxService singleton used by routes/invoice service.

export {
  FxService,
  defaultFetchRate,
  type FxAlertDirection,
  type FxConversion,
  type FxRateAlertRecord,
  type FxRateRecord,
  type FxServiceOptions,
  type RateFetcher,
} from './fx-service.js';

import { FxService } from './fx-service.js';

let instance: FxService | null = null;

export function getFxService(): FxService {
  if (!instance) instance = new FxService();
  return instance;
}

/** Shared singleton for convenience imports (`import { fxService } from '../fx/index.js'`). */
export const fxService = getFxService();
