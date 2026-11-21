// cross-border/index.ts — Issue #920
// Re-exports + shared CrossBorderPaymentService singleton.

export {
  CrossBorderPaymentService,
  crossBorderPaymentService,
  type Corridor,
  type CrossBorderFees,
  type CrossBorderPayment,
  type CrossBorderPaymentStatus,
  type CrossBorderQuote,
  type CrossBorderServiceOptions,
  type QuoteAmountMode,
  type RateProvider,
  type SettlementRail,
} from './cross-border-service.js';
