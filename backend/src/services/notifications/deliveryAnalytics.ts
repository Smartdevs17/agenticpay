import { DeliveryTracker } from './deliveryTracker.js';

export interface DeliveryAnalytics {
    totalSent: number;
    totalDelivered: number;
    totalFailed: number;
    openRate: number;
    clickRate: number;
    channelBreakdown: Record<string, {
        sent: number;
        delivered: number;
        failed: number;
        openRate: number;
        clickRate: number;
    }>;
    dailyTrend: Array<{
        date: string;
        sent: number;
        opened: number;
        clicked: number;
    }>;
}

export class DeliveryAnalyticsService {
    private deliveryTracker: DeliveryTracker;

    constructor() {
        this.deliveryTracker = new DeliveryTracker();
    }

    async getAnalytics(
        userId?: string,
        startDate?: Date,
        endDate?: Date,
    ): Promise<DeliveryAnalytics> {
        const deliveries = await this.deliveryTracker.getDeliveriesInRange(userId, startDate, endDate);

        const totalSent = deliveries.length;
        const totalDelivered = deliveries.filter(d => d.status === 'delivered' || d.status === 'opened' || d.status === 'clicked').length;
        const totalFailed = deliveries.filter(d => d.status === 'failed').length;
        const totalOpened = deliveries.filter(d => d.status === 'opened' || d.status === 'clicked').length;
        const totalClicked = deliveries.filter(d => d.status === 'clicked').length;

        const channelBreakdown: Record<string, { sent: number; delivered: number; failed: number; openRate: number; clickRate: number }> = {};
        const dailyMap: Record<string, { sent: number; opened: number; clicked: number }> = {};

        for (const d of deliveries) {
            // Channel breakdown
            if (!channelBreakdown[d.channel]) {
                channelBreakdown[d.channel] = { sent: 0, delivered: 0, failed: 0, openRate: 0, clickRate: 0 };
            }
            channelBreakdown[d.channel].sent++;
            if (d.status === 'delivered' || d.status === 'opened' || d.status === 'clicked') {
                channelBreakdown[d.channel].delivered++;
            }
            if (d.status === 'failed') {
                channelBreakdown[d.channel].failed++;
            }

            // Daily trend
            const dateKey = d.createdAt.toISOString().split('T')[0];
            if (!dailyMap[dateKey]) {
                dailyMap[dateKey] = { sent: 0, opened: 0, clicked: 0 };
            }
            dailyMap[dateKey].sent++;
            if (d.status === 'opened' || d.status === 'clicked') dailyMap[dateKey].opened++;
            if (d.status === 'clicked') dailyMap[dateKey].clicked++;
        }

        // Calculate rates per channel
        for (const ch of Object.keys(channelBreakdown)) {
            const c = channelBreakdown[ch];
            c.openRate = c.delivered > 0 ? (c.delivered / c.sent) * 100 : 0;
            c.clickRate = c.delivered > 0 ? (c.delivered / c.sent) * 100 : 0;
        }

        return {
            totalSent,
            totalDelivered,
            totalFailed,
            openRate: totalSent > 0 ? (totalOpened / totalSent) * 100 : 0,
            clickRate: totalSent > 0 ? (totalClicked / totalSent) * 100 : 0,
            channelBreakdown,
            dailyTrend: Object.entries(dailyMap)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, data]) => ({ date, ...data })),
        };
    }
}