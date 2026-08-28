/**
 * OnboardingRepository.ts — Issue #597 / #716
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

  protected getSortTimestamp(entity: MerchantOnboarding): number {
    return new Date(entity.createdAt).getTime();
  }

  async create(data: Partial<MerchantOnboarding>): Promise<MerchantOnboarding> {
    if (!data.id) throw new Error('Onboarding id is required');
    return this.put(data as MerchantOnboarding);
  }

  async update(id: string, data: Partial<MerchantOnboarding>): Promise<MerchantOnboarding | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    return this.put({ ...existing, ...data, updatedAt: new Date().toISOString() });
  }

  findByMerchantId(merchantId: string): MerchantOnboarding | null {
    for (const onboarding of this.store.values()) {
      if (onboarding.merchantId === merchantId) return onboarding;
    }
    return null;
  }

  findByStatus(status: string): MerchantOnboarding[] {
    return this.sortedValues().filter((o) => o.status === status);
  }
}

// ─── Analytics session repository ─────────────────────────────────────────────

export class OnboardingAnalyticsRepository extends InMemoryRepository<OnboardingSession> {
  protected getId(entity: OnboardingSession): string {
    return entity.sessionId;
  }

  protected getSortTimestamp(entity: OnboardingSession): number {
    return new Date(entity.startedAt).getTime();
  }

  async create(data: Partial<OnboardingSession>): Promise<OnboardingSession> {
    if (!data.sessionId) throw new Error('sessionId is required');
    return this.put(data as OnboardingSession);
  }

  async update(id: string, data: Partial<OnboardingSession>): Promise<OnboardingSession | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    return this.put({ ...existing, ...data });
  }
}
