/**
 * onboarding.module.ts — Issue #597
 *
 * Onboarding domain DI module — registers controller, services, and repositories.
 */
import type { DIContainer } from '../container.js';

export function registerOnboardingModule(c: DIContainer): void {
  c.register(
    'OnboardingRepository',
    () => {
      const { OnboardingRepository } = require('../../repositories/OnboardingRepository.js');
      return new OnboardingRepository();
    },
    'singleton',
  );

  c.register(
    'OnboardingAnalyticsRepository',
    () => {
      const { OnboardingAnalyticsRepository } = require('../../repositories/OnboardingRepository.js');
      return new OnboardingAnalyticsRepository();
    },
    'singleton',
  );

  c.register(
    'OnboardingService',
    () => {
      const { OnboardingService } = require('../../services/onboarding.js');
      return OnboardingService;
    },
    'singleton',
  );

  c.register(
    'OnboardingAnalyticsService',
    () => {
      const { OnboardingAnalyticsService } = require('../../services/onboardingAnalytics.js');
      return OnboardingAnalyticsService;
    },
    'singleton',
  );

  c.register(
    'OnboardingController',
    (c) => {
      const { OnboardingController } = require('../../controllers/OnboardingController.js');
      return new OnboardingController(
        c.get('OnboardingService'),
        c.get('OnboardingAnalyticsService'),
      );
    },
    'singleton',
  );
}
