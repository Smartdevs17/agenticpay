// Email Analytics Service
// Tracks email open rates, click rates, and bounce rates

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface EmailMetrics {
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  bouncedCount: number;
  failedCount: number;
  openRate: number;
  clickRate: number;
  bounceRate: number;
  deliveryRate: number;
}

export interface AnalyticsReport {
  date: Date;
  category: string;
  metrics: EmailMetrics;
}

export class EmailAnalyticsService {
  /**
   * Track email delivery
   */
  async trackDelivery(deliveryId: string): Promise<void> {
    await prisma.emailDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'delivered',
        deliveredAt: new Date(),
      },
    });

    // Update analytics
    const delivery = await prisma.emailDelivery.findUnique({
      where: { id: deliveryId },
    });

    if (delivery) {
      await this.incrementAnalytics(delivery.tenantId, delivery.templateId, 'deliveredCount');
    }
  }

  /**
   * Track email open
   */
  async trackOpen(deliveryId: string): Promise<void> {
    const delivery = await prisma.emailDelivery.findUnique({
      where: { id: deliveryId },
    });

    if (!delivery) {
      throw new Error('Delivery not found');
    }

    if (delivery.openedAt) {
      return; // Already tracked
    }

    await prisma.emailDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'opened',
        openedAt: new Date(),
      },
    });

    // Update analytics
    await this.incrementAnalytics(delivery.tenantId, delivery.templateId, 'openedCount');
  }

  /**
   * Track email click
   */
  async trackClick(deliveryId: string): Promise<void> {
    const delivery = await prisma.emailDelivery.findUnique({
      where: { id: deliveryId },
    });

    if (!delivery) {
      throw new Error('Delivery not found');
    }

    await prisma.emailDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'clicked',
        clickedAt: new Date(),
      },
    });

    // Update analytics
    await this.incrementAnalytics(delivery.tenantId, delivery.templateId, 'clickedCount');
  }

  /**
   * Track email bounce
   */
  async trackBounce(deliveryId: string, reason: string): Promise<void> {
    const delivery = await prisma.emailDelivery.findUnique({
      where: { id: deliveryId },
    });

    if (!delivery) {
      throw new Error('Delivery not found');
    }

    await prisma.emailDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'bounced',
        bouncedAt: new Date(),
        bounceReason: reason,
      },
    });

    // Update analytics
    await this.incrementAnalytics(delivery.tenantId, delivery.templateId, 'bouncedCount');
  }

  /**
   * Track email failure
   */
  async trackFailure(deliveryId: string, error: string): Promise<void> {
    const delivery = await prisma.emailDelivery.findUnique({
      where: { id: deliveryId },
    });

    if (!delivery) {
      throw new Error('Delivery not found');
    }

    await prisma.emailDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'failed',
        error,
        retryCount: { increment: 1 },
      },
    });

    // Update analytics
    await this.incrementAnalytics(delivery.tenantId, delivery.templateId, 'failedCount');
  }

  /**
   * Increment analytics counter
   */
  private async incrementAnalytics(
    tenantId: string,
    templateId: string | null,
    field: 'sentCount' | 'deliveredCount' | 'openedCount' | 'clickedCount' | 'bouncedCount' | 'failedCount'
  ): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get category from template if available
    let category = 'other';
    if (templateId) {
      const template = await prisma.emailTemplate.findUnique({
        where: { id: templateId },
        select: { category: true },
      });
      if (template) {
        category = template.category;
      }
    }

    // Upsert analytics record
    await prisma.emailAnalytics.upsert({
      where: {
        tenantId_category_date: {
          tenantId,
          category,
          date: today,
        },
      },
      create: {
        tenantId,
        templateId,
        category: category as any,
        [field]: 1,
        date: today,
      },
      update: {
        [field]: { increment: 1 },
      },
    });
  }

  /**
   * Get analytics for a tenant
   */
  async getTenantAnalytics(
    tenantId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<AnalyticsReport[]> {
    const where: any = { tenantId };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = startDate;
      if (endDate) where.date.lte = endDate;
    }

    const analytics = await prisma.emailAnalytics.findMany({
      where,
      orderBy: { date: 'desc' },
    });

    return analytics.map((a) => ({
      date: a.date,
      category: a.category,
      metrics: this.calculateMetrics(a),
    }));
  }

  /**
   * Get analytics for a specific template
   */
  async getTemplateAnalytics(
    templateId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<AnalyticsReport[]> {
    const where: any = { templateId };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = startDate;
      if (endDate) where.date.lte = endDate;
    }

    const analytics = await prisma.emailAnalytics.findMany({
      where,
      orderBy: { date: 'desc' },
    });

    return analytics.map((a) => ({
      date: a.date,
      category: a.category,
      metrics: this.calculateMetrics(a),
    }));
  }

  /**
   * Get analytics for a specific category
   */
  async getCategoryAnalytics(
    tenantId: string,
    category: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<AnalyticsReport[]> {
    const where: any = { tenantId, category };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = startDate;
      if (endDate) where.date.lte = endDate;
    }

    const analytics = await prisma.emailAnalytics.findMany({
      where,
      orderBy: { date: 'desc' },
    });

    return analytics.map((a) => ({
      date: a.date,
      category: a.category,
      metrics: this.calculateMetrics(a),
    }));
  }

  /**
   * Calculate metrics from analytics record
   */
  private calculateMetrics(analytics: any): EmailMetrics {
    const sentCount = analytics.sentCount || 0;
    const deliveredCount = analytics.deliveredCount || 0;
    const openedCount = analytics.openedCount || 0;
    const clickedCount = analytics.clickedCount || 0;
    const bouncedCount = analytics.bouncedCount || 0;
    const failedCount = analytics.failedCount || 0;

    return {
      sentCount,
      deliveredCount,
      openedCount,
      clickedCount,
      bouncedCount,
      failedCount,
      openRate: sentCount > 0 ? (openedCount / sentCount) * 100 : 0,
      clickRate: openedCount > 0 ? (clickedCount / openedCount) * 100 : 0,
      bounceRate: sentCount > 0 ? (bouncedCount / sentCount) * 100 : 0,
      deliveryRate: sentCount > 0 ? (deliveredCount / sentCount) * 100 : 0,
    };
  }

  /**
   * Get summary statistics for a tenant
   */
  async getSummaryStatistics(tenantId: string, days: number = 30): Promise<{
    totalSent: number;
    totalDelivered: number;
    totalOpened: number;
    totalClicked: number;
    totalBounced: number;
    totalFailed: number;
    averageOpenRate: number;
    averageClickRate: number;
    averageBounceRate: number;
    averageDeliveryRate: number;
    byCategory: Record<string, EmailMetrics>;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const analytics = await prisma.emailAnalytics.findMany({
      where: {
        tenantId,
        date: { gte: startDate },
      },
    });

    let totalSent = 0;
    let totalDelivered = 0;
    let totalOpened = 0;
    let totalClicked = 0;
    let totalBounced = 0;
    let totalFailed = 0;

    const byCategory: Record<string, EmailMetrics> = {};

    for (const a of analytics) {
      totalSent += a.sentCount || 0;
      totalDelivered += a.deliveredCount || 0;
      totalOpened += a.openedCount || 0;
      totalClicked += a.clickedCount || 0;
      totalBounced += a.bouncedCount || 0;
      totalFailed += a.failedCount || 0;

      if (!byCategory[a.category]) {
        byCategory[a.category] = this.calculateMetrics(a);
      } else {
        const existing = byCategory[a.category];
        existing.sentCount += a.sentCount || 0;
        existing.deliveredCount += a.deliveredCount || 0;
        existing.openedCount += a.openedCount || 0;
        existing.clickedCount += a.clickedCount || 0;
        existing.bouncedCount += a.bouncedCount || 0;
        existing.failedCount += a.failedCount || 0;
        existing.openRate = existing.sentCount > 0 ? (existing.openedCount / existing.sentCount) * 100 : 0;
        existing.clickRate = existing.openedCount > 0 ? (existing.clickedCount / existing.openedCount) * 100 : 0;
        existing.bounceRate = existing.sentCount > 0 ? (existing.bouncedCount / existing.sentCount) * 100 : 0;
        existing.deliveryRate = existing.sentCount > 0 ? (existing.deliveredCount / existing.sentCount) * 100 : 0;
      }
    }

    return {
      totalSent,
      totalDelivered,
      totalOpened,
      totalClicked,
      totalBounced,
      totalFailed,
      averageOpenRate: totalSent > 0 ? (totalOpened / totalSent) * 100 : 0,
      averageClickRate: totalOpened > 0 ? (totalClicked / totalOpened) * 100 : 0,
      averageBounceRate: totalSent > 0 ? (totalBounced / totalSent) * 100 : 0,
      averageDeliveryRate: totalSent > 0 ? (totalDelivered / totalSent) * 100 : 0,
      byCategory,
    };
  }

  /**
   * Get delivery status for a specific email
   */
  async getDeliveryStatus(deliveryId: string): Promise<{
    id: string;
    status: string;
    sentAt?: Date;
    deliveredAt?: Date;
    openedAt?: Date;
    clickedAt?: Date;
    bouncedAt?: Date;
    bounceReason?: string;
    error?: string;
  }> {
    const delivery = await prisma.emailDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        status: true,
        sentAt: true,
        deliveredAt: true,
        openedAt: true,
        clickedAt: true,
        bouncedAt: true,
        bounceReason: true,
        error: true,
      },
    });

    if (!delivery) {
      throw new Error('Delivery not found');
    }

    return delivery;
  }
}

export default EmailAnalyticsService;
