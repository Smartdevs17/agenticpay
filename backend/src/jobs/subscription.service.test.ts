import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SubscriptionService } from './subscription.service';
import { ethers } from 'ethers';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let mockContract: any;

  beforeEach(() => {
    mockContract = {
      subscriptions: vi.fn(),
      plans: vi.fn(),
      connect: vi.fn().mockReturnThis(),
      createPlan: vi.fn(),
    };
    // Create service with mock provider
    service = new SubscriptionService('0x0000000000000000000000000000000000000001', [], {} as any);
    // Inject mock contract instance
    (service as any).contract = mockContract;
  });

  describe('calculateProration', () => {
    it('should calculate correct credit for 50% remaining time', async () => {
      const now = Math.floor(Date.now() / 1000);
      const nextPayment = now + 15 * 86400; // 15 days from now
      const interval = 30 * 86400;         // 30 days total
      const amount = ethers.parseUnits('100', 18);

      mockContract.subscriptions.mockResolvedValue({
        active: true,
        nextPayment: BigInt(nextPayment),
      });
      mockContract.plans
        .mockResolvedValueOnce({
          amount: amount,
          interval: BigInt(interval),
        })
        .mockResolvedValueOnce({
          amount: ethers.parseUnits('200', 18),
          interval: BigInt(interval),
        });

      const result = await service.calculateProration('0xuser', 1, 2);
      
      // Proration credit should be ~50 ETH
      expect(result.credit).toBeGreaterThan(ethers.parseUnits('49', 18));
      expect(result.credit).toBeLessThan(ethers.parseUnits('51', 18));
      expect(result.immediateCharge).toBeGreaterThan(ethers.parseUnits('49', 18));
    });

    it('should return 0 if subscription is inactive', async () => {
      mockContract.subscriptions.mockResolvedValue({ active: false });
      
      const result = await service.calculateProration('0xuser', 1, 2);
      expect(result).toEqual({ credit: 0n, immediateCharge: 0n });
    });
  });

  describe('billing intervals', () => {
    it('supports weekly, monthly, annual, and custom plan intervals', async () => {
      expect(service.resolveIntervalSeconds({ interval: 'weekly' })).toBe(7 * 86400);
      expect(service.resolveIntervalSeconds({ interval: 'monthly' })).toBe(30 * 86400);
      expect(service.resolveIntervalSeconds({ interval: 'annual' })).toBe(365 * 86400);
      expect(service.resolveIntervalSeconds({ interval: 'custom', customIntervalSeconds: 45 * 86400 })).toBe(45 * 86400);
    });

    it('keeps month-end billing valid across leap years', () => {
      expect(service.addBillingInterval(new Date('2024-01-31T00:00:00.000Z'), 'monthly').toISOString()).toBe('2024-02-29T00:00:00.000Z');
      expect(service.addBillingInterval(new Date('2023-01-31T00:00:00.000Z'), 'monthly').toISOString()).toBe('2023-02-28T00:00:00.000Z');
      expect(service.addBillingInterval(new Date('2024-02-29T00:00:00.000Z'), 'annual').toISOString()).toBe('2025-02-28T00:00:00.000Z');
    });
  });

  describe('analytics', () => {
    it('calculates MRR, churn, and lifetime value', () => {
      const monthly = ethers.parseUnits('100', 18);
      const yearly = ethers.parseUnits('1200', 18);

      const analytics = service.calculateAnalytics(
        [
          { id: 'sub-1', customer: '0x1', planId: 1, status: 'active', active: true, startedAt: new Date(), currentPeriodStart: new Date(), nextPayment: new Date(), retryCount: 0, currency: 'USD', amount: monthly },
          { id: 'sub-2', customer: '0x2', planId: 2, status: 'active', active: true, startedAt: new Date(), currentPeriodStart: new Date(), nextPayment: new Date(), retryCount: 0, currency: 'USD', amount: yearly },
          { id: 'sub-3', customer: '0x3', planId: 1, status: 'cancelled', active: false, startedAt: new Date(), currentPeriodStart: new Date(), nextPayment: new Date(), retryCount: 0, currency: 'USD', amount: monthly },
        ],
        [
          { id: 1, amount: monthly, intervalSeconds: 30n * 86400n, interval: 'monthly', currency: 'USD', active: true },
          { id: 2, amount: yearly, intervalSeconds: 365n * 86400n, interval: 'annual', currency: 'USD', active: true },
        ]
      );

      expect(analytics.activeSubscriptions).toBe(2);
      expect(analytics.cancelledSubscriptions).toBe(1);
      expect(analytics.monthlyRecurringRevenue).toBe(ethers.parseUnits('200', 18));
      expect(analytics.churnRate).toBeCloseTo(1 / 3);
      expect(analytics.lifetimeValue).toBe(ethers.parseUnits('600', 18));
    });
  });
});
