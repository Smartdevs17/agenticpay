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
    };
    // Create service with mock provider
    service = new SubscriptionService('0xaddr', [], {} as any);
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
      mockContract.plans.mockResolvedValue({
        amount: amount,
        interval: BigInt(interval),
      });

      const credit = await service.calculateProration('0xuser', 1, 2);
      
      // Proration credit should be ~50 ETH
      expect(credit).toBeGreaterThan(ethers.parseUnits('49', 18));
      expect(credit).toBeLessThan(ethers.parseUnits('51', 18));
    });

    it('should return 0 if subscription is inactive', async () => {
      mockContract.subscriptions.mockResolvedValue({ active: false });
      
      const credit = await service.calculateProration('0xuser', 1, 2);
      expect(credit).toBe(0n);
    });
  });
});