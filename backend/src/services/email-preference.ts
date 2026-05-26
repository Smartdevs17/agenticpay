// Email Preference Center Service
// Manages user email preferences and opt-in/opt-out per category

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface EmailPreferences {
  paymentReceipts: boolean;
  paymentConfirmations: boolean;
  refundNotifications: boolean;
  disputeUpdates: boolean;
  weeklySummaries: boolean;
  marketing: boolean;
  securityAlerts: boolean;
  onboarding: boolean;
}

export interface PreferenceUpdate {
  paymentReceipts?: boolean;
  paymentConfirmations?: boolean;
  refundNotifications?: boolean;
  disputeUpdates?: boolean;
  weeklySummaries?: boolean;
  marketing?: boolean;
  securityAlerts?: boolean;
  onboarding?: boolean;
  locale?: string;
}

export class EmailPreferenceService {
  /**
   * Get user email preferences
   */
  async getPreferences(tenantId: string, email: string): Promise<EmailPreferences & { locale: string }> {
    const preference = await prisma.emailPreference.findUnique({
      where: {
        tenantId_email: {
          tenantId,
          email,
        },
      },
    });

    if (!preference) {
      // Create default preferences
      return await this.createDefaultPreferences(tenantId, email);
    }

    return {
      paymentReceipts: preference.paymentReceipts,
      paymentConfirmations: preference.paymentConfirmations,
      refundNotifications: preference.refundNotifications,
      disputeUpdates: preference.disputeUpdates,
      weeklySummaries: preference.weeklySummaries,
      marketing: preference.marketing,
      securityAlerts: preference.securityAlerts,
      onboarding: preference.onboarding,
      locale: preference.locale,
    };
  }

  /**
   * Get preferences by user ID
   */
  async getPreferencesByUserId(userId: string): Promise<EmailPreferences & { locale: string; email: string }> {
    const preference = await prisma.emailPreference.findUnique({
      where: { userId },
    });

    if (!preference) {
      throw new Error('Preferences not found for user');
    }

    return {
      email: preference.email,
      paymentReceipts: preference.paymentReceipts,
      paymentConfirmations: preference.paymentConfirmations,
      refundNotifications: preference.refundNotifications,
      disputeUpdates: preference.disputeUpdates,
      weeklySummaries: preference.weeklySummaries,
      marketing: preference.marketing,
      securityAlerts: preference.securityAlerts,
      onboarding: preference.onboarding,
      locale: preference.locale,
    };
  }

  /**
   * Update email preferences
   */
  async updatePreferences(
    tenantId: string,
    email: string,
    updates: PreferenceUpdate
  ): Promise<EmailPreferences & { locale: string }> {
    const existing = await prisma.emailPreference.findUnique({
      where: {
        tenantId_email: {
          tenantId,
          email,
        },
      },
    });

    if (!existing) {
      return await this.createDefaultPreferences(tenantId, email, updates);
    }

    const updated = await prisma.emailPreference.update({
      where: {
        tenantId_email: {
          tenantId,
          email,
        },
      },
      data: updates,
    });

    return {
      paymentReceipts: updated.paymentReceipts,
      paymentConfirmations: updated.paymentConfirmations,
      refundNotifications: updated.refundNotifications,
      disputeUpdates: updated.disputeUpdates,
      weeklySummaries: updated.weeklySummaries,
      marketing: updated.marketing,
      securityAlerts: updated.securityAlerts,
      onboarding: updated.onboarding,
      locale: updated.locale,
    };
  }

  /**
   * Update preferences by user ID
   */
  async updatePreferencesByUserId(
    userId: string,
    updates: PreferenceUpdate
  ): Promise<EmailPreferences & { locale: string; email: string }> {
    const existing = await prisma.emailPreference.findUnique({
      where: { userId },
    });

    if (!existing) {
      throw new Error('Preferences not found for user');
    }

    const updated = await prisma.emailPreference.update({
      where: { userId },
      data: updates,
    });

    return {
      email: updated.email,
      paymentReceipts: updated.paymentReceipts,
      paymentConfirmations: updated.paymentConfirmations,
      refundNotifications: updated.refundNotifications,
      disputeUpdates: updated.disputeUpdates,
      weeklySummaries: updated.weeklySummaries,
      marketing: updated.marketing,
      securityAlerts: updated.securityAlerts,
      onboarding: updated.onboarding,
      locale: updated.locale,
    };
  }

  /**
   * Check if user is opted in for a specific category
   */
  async isOptedIn(tenantId: string, email: string, category: keyof EmailPreferences): Promise<boolean> {
    const preferences = await this.getPreferences(tenantId, email);
    return preferences[category];
  }

  /**
   * Check if user is opted in by user ID
   */
  async isOptedInByUserId(userId: string, category: keyof EmailPreferences): Promise<boolean> {
    const preferences = await this.getPreferencesByUserId(userId);
    return preferences[category];
  }

  /**
   * Opt out of all emails
   */
  async optOutAll(tenantId: string, email: string): Promise<EmailPreferences & { locale: string }> {
    return await this.updatePreferences(tenantId, email, {
      paymentReceipts: false,
      paymentConfirmations: false,
      refundNotifications: false,
      disputeUpdates: false,
      weeklySummaries: false,
      marketing: false,
      securityAlerts: false,
      onboarding: false,
    });
  }

  /**
   * Opt in to all emails
   */
  async optInAll(tenantId: string, email: string): Promise<EmailPreferences & { locale: string }> {
    return await this.updatePreferences(tenantId, email, {
      paymentReceipts: true,
      paymentConfirmations: true,
      refundNotifications: true,
      disputeUpdates: true,
      weeklySummaries: true,
      marketing: false, // Marketing requires explicit opt-in
      securityAlerts: true,
      onboarding: true,
    });
  }

  /**
   * Create default preferences for a new user
   */
  async createDefaultPreferences(
    tenantId: string,
    email: string,
    overrides?: PreferenceUpdate,
    userId?: string
  ): Promise<EmailPreferences & { locale: string }> {
    const preference = await prisma.emailPreference.create({
      data: {
        tenantId,
        userId,
        email,
        paymentReceipts: true,
        paymentConfirmations: true,
        refundNotifications: true,
        disputeUpdates: true,
        weeklySummaries: true,
        marketing: false,
        securityAlerts: true,
        onboarding: true,
        locale: 'en',
        ...overrides,
      },
    });

    return {
      paymentReceipts: preference.paymentReceipts,
      paymentConfirmations: preference.paymentConfirmations,
      refundNotifications: preference.refundNotifications,
      disputeUpdates: preference.disputeUpdates,
      weeklySummaries: preference.weeklySummaries,
      marketing: preference.marketing,
      securityAlerts: preference.securityAlerts,
      onboarding: preference.onboarding,
      locale: preference.locale,
    };
  }

  /**
   * Get all users opted in for a specific category
   */
  async getUsersOptedIn(tenantId: string, category: keyof EmailPreferences): Promise<string[]> {
    const preferences = await prisma.emailPreference.findMany({
      where: {
        tenantId,
        [category]: true,
      },
      select: {
        email: true,
      },
    });

    return preferences.map((p) => p.email);
  }

  /**
   * Get preference statistics for a tenant
   */
  async getTenantStatistics(tenantId: string): Promise<{
    totalUsers: number;
    optedInByCategory: Record<keyof EmailPreferences, number>;
    localeDistribution: Record<string, number>;
  }> {
    const allPreferences = await prisma.emailPreference.findMany({
      where: { tenantId },
    });

    const optedInByCategory: Record<keyof EmailPreferences, number> = {
      paymentReceipts: 0,
      paymentConfirmations: 0,
      refundNotifications: 0,
      disputeUpdates: 0,
      weeklySummaries: 0,
      marketing: 0,
      securityAlerts: 0,
      onboarding: 0,
    };

    const localeDistribution: Record<string, number> = {};

    for (const pref of allPreferences) {
      // Count opt-ins per category
      if (pref.paymentReceipts) optedInByCategory.paymentReceipts++;
      if (pref.paymentConfirmations) optedInByCategory.paymentConfirmations++;
      if (pref.refundNotifications) optedInByCategory.refundNotifications++;
      if (pref.disputeUpdates) optedInByCategory.disputeUpdates++;
      if (pref.weeklySummaries) optedInByCategory.weeklySummaries++;
      if (pref.marketing) optedInByCategory.marketing++;
      if (pref.securityAlerts) optedInByCategory.securityAlerts++;
      if (pref.onboarding) optedInByCategory.onboarding++;

      // Count locale distribution
      localeDistribution[pref.locale] = (localeDistribution[pref.locale] || 0) + 1;
    }

    return {
      totalUsers: allPreferences.length,
      optedInByCategory,
      localeDistribution,
    };
  }

  /**
   * Unsubscribe a user (legacy method for backward compatibility)
   */
  async unsubscribe(tenantId: string, email: string): Promise<void> {
    await this.optOutAll(tenantId, email);
  }

  /**
   * Subscribe a user (legacy method for backward compatibility)
   */
  async subscribe(tenantId: string, email: string): Promise<void> {
    await this.optInAll(tenantId, email);
  }
}

export default EmailPreferenceService;
