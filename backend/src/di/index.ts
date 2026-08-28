/**
 * Bootstrap — loads all domain modules into the container and validates.
 * Call once at application startup.
 *
 * Feature flag: DI_VALIDATION=false disables startup validation
 * (useful during incremental migration).
 */
import { container } from './container.js';
import { registerProjectModule } from './modules/project.module.js';
import { registerAuthModule } from './modules/auth.module.js';
import { registerPaymentModule } from './modules/payment.module.js';
import { registerComplianceModule } from './modules/compliance.module.js';
import { registerOnboardingModule } from './modules/onboarding.module.js';
import { registerWalletModule } from './modules/wallet.module.js';
import { registerCategoryModule } from './modules/category.module.js';

export function bootstrapDI(): void {
  registerProjectModule(container);
  registerAuthModule(container);
  registerPaymentModule(container);
  registerComplianceModule(container);
  registerOnboardingModule(container);
  registerWalletModule(container);
  registerCategoryModule(container);

  if (process.env.DI_VALIDATION !== 'false') {
    try {
      container.validate();
    } catch (err) {
      // Log but don't crash — allows partial migration
      console.warn('[DI] Startup validation warning:', (err as Error).message);
    }
  }
}

export { container };
