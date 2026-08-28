/**
 * OnboardingRepository.ts — Issue #597
 *
 * Data access layer for onboarding records.
 * Currently uses in-memory storage; swap out for Prisma via factory.ts.
 */

import { InMemoryRepository } from './InMemoryRepository.js';
import { MerchantOnboarding } from '../services/onboarding.js';
import { OnboardingSession } from '../services/onboardingAnalytics.js';

// ─── Onboarding record repository ─────────────────────────────────────────────

export class OnboardingRepository extends InMemoryRepository<MerchantOnboarding> {
  protected getId(entity: MerchantOnboarding): string {
    return entity.id;
  }

  protected getSortValue(entity: MerchantOnboarding): number {
    return new Date(entity.createdAt).getTime();
  }

  async update(id: string, data: Partial<MerchantOnboarding>): Promise<MerchantOnboarding | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
    this.store.set(id, updated);
    return updated;
  }

  findByMerchantId(merchantId: string): MerchantOnboarding | null {
    for (const onboarding of this.store.values()) {
      if (onboarding.merchantId === merchantId) return onboarding;
    }
    return null;
  }

  findByStatus(status: string): MerchantOnboarding[] {
    return Array.from(this.store.values()).filter((o) => o.status === status);
  }
}

// ─── Analytics session repository ─────────────────────────────────────────────

export class OnboardingAnalyticsRepository extends InMemoryRepository<OnboardingSession> {
  protected getId(entity: OnboardingSession): string {
    return entity.sessionId;
  }

  protected getSortValue(entity: OnboardingSession): number {
    return new Date(entity.startedAt).getTime();
  }
}
