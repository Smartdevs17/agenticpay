/**
 * index.ts — Issue #919: BNPL installment plans
 *
 * Public surface of the BNPL installment domain.
 */
export * from './types.js';
export {
  DEFAULT_BNPL_CONFIG,
  addPeriod,
  buildInstallmentSchedule,
  isPlanOverdue,
  nextActionableInstallment,
  roundCurrency,
  summarizePlan,
  validateInstallmentRequest,
} from './planner.js';
export type { BuildScheduleParams } from './planner.js';
export {
  InMemoryInstallmentPlanRepository,
  type InstallmentPlanRepository,
} from './store.js';
export { BNPLInstallmentService, bnplInstallmentService, type BNPLServiceOptions } from './bnplService.js';
