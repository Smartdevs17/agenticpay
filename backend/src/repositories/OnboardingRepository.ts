/**
 * OnboardingRepository.ts — Issue #597
 *
 * Data access layer for onboarding records.
 * Currently uses in-memory storage; swap out for Prisma via factory.ts.
 */

import { BaseRepository, PaginationOptions, PaginatedResult } from './BaseRepository.js';
import { MerchantOnboarding } from '../services/onboarding.js';
import { OnboardingSession } from '../services/onboardingAnalytics.js';

// ─── Onboarding record repository ─────────────────────────────────────────────

export class OnboardingRepository extends BaseRepository<MerchantOnboarding> {
  private store: Map<string, MerchantOnboarding> = new Map();

  async findById(id: string): Promise<MerchantOnboarding | null> {
    return this.store.get(id) ?? null;
  }

  async findAll(options: PaginationOptions): Promise<PaginatedResult<MerchantOnboarding>> {
    const all = Array.from(this.store.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    let startIndex = 0;
    if (options.cursor) {
      const idx = all.findIndex((o) => o.id === options.cursor);
      startIndex = idx >= 0 ? idx + 1 : 0;
    }
    const items = all.slice(startIndex, startIndex + options.limit);
    const hasMore = startIndex + options.limit < all.length;
    return { items, hasMore, nextCursor: hasMore ? items.at(-1)?.id : undefined };
  }

  async create(data: Partial<MerchantOnboarding>): Promise<MerchantOnboarding> {
    if (!data.id) throw new Error('Onboarding id is required');
    this.store.set(data.id, data as MerchantOnboarding);
    return data as MerchantOnboarding;
  }

  async update(id: string, data: Partial<MerchantOnboarding>): Promise<MerchantOnboarding | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
    this.store.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async count(filters?: Record<string, unknown>): Promise<number> {
    if (!filters) return this.store.size;
    return Array.from(this.store.values()).filter((o) =>
      Object.entries(filters).every(([k, v]) => (o as unknown as Record<string, unknown>)[k] === v),
    ).length;
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

export class OnboardingAnalyticsRepository extends BaseRepository<OnboardingSession> {
  private store: Map<string, OnboardingSession> = new Map();

  async findById(id: string): Promise<OnboardingSession | null> {
    return this.store.get(id) ?? null;
  }

  async findAll(options: PaginationOptions): Promise<PaginatedResult<OnboardingSession>> {
    const all = Array.from(this.store.values()).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
    let startIndex = 0;
    if (options.cursor) {
      const idx = all.findIndex((s) => s.sessionId === options.cursor);
      startIndex = idx >= 0 ? idx + 1 : 0;
    }
    const items = all.slice(startIndex, startIndex + options.limit);
    const hasMore = startIndex + options.limit < all.length;
    return { items, hasMore, nextCursor: hasMore ? items.at(-1)?.sessionId : undefined };
  }

  async create(data: Partial<OnboardingSession>): Promise<OnboardingSession> {
    if (!data.sessionId) throw new Error('sessionId is required');
    this.store.set(data.sessionId, data as OnboardingSession);
    return data as OnboardingSession;
  }

  async update(id: string, data: Partial<OnboardingSession>): Promise<OnboardingSession | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...data };
    this.store.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async count(): Promise<number> {
    return this.store.size;
  }
}
