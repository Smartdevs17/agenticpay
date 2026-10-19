/**
 * index.ts — Issue #917: Split payments between multiple recipients
 *
 * Public surface of the split-payments domain.
 */
export * from './types.js';
export {
  DEFAULT_SPLIT_CONFIG,
  allocateMinorUnits,
  allocateSplit,
  fromBasisPoints,
  roundCurrency,
  toBasisPoints,
  validateSplitPlan,
  type AllocateSplitParams,
} from './allocation.js';
export {
  InMemorySplitStore,
  type SplitExecutionRepository,
  type SplitPlanRepository,
} from './store.js';
export {
  SplitPaymentService,
  splitPaymentService,
  type ExecuteSplitInput,
  type SplitPaymentServiceOptions,
} from './splitPaymentService.js';
