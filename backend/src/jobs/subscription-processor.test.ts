import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SubscriptionProcessor } from './subscription-processor';
import { logger } from '../utils/logger';

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('SubscriptionProcessor', () => {
  let processor: SubscriptionProcessor;
  let mockService: any;
  let mockRepository: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = {
      executePayment: vi.fn(),
      triggerLifecycleWebhook: vi.fn(),
    };
    mockRepository = {
      findDueSubscriptions: vi.fn(),
      markRenewed: vi.fn(),
      recordFailure: vi.fn(),
      downgradeSubscription: vi.fn(),
    };
    processor = new SubscriptionProcessor(mockService, mockRepository, {
      retryDelayMs: () => 1,
      now: () => new Date('2026-05-27T10:00:00.000Z'),
    });
  });

  it('should process renewals and trigger webhooks on success', async () => {
    const sub = { id: 'sub1', customer: '0x123', planId: 1 };
    mockRepository.findDueSubscriptions.mockResolvedValue([sub]);
    mockService.executePayment.mockResolvedValue({ status: 1 });

    await processor.processPendingRenewals();

    expect(mockService.executePayment).toHaveBeenCalledWith('0x123', 1);
    expect(mockService.triggerLifecycleWebhook).toHaveBeenCalledWith('renewed', expect.objectContaining({
      subscriptionId: 'sub1'
    }));
    expect(mockRepository.markRenewed).toHaveBeenCalledWith(sub, new Date('2026-05-27T10:00:00.000Z'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Batch processing completed. Success: 1, Failed: 0'));
  });

  it('should retry on failure and trigger failed webhook after max retries', async () => {
    const sub = { id: 'sub2', customer: '0x456', planId: 2, downgradePlanId: 1 };
    mockRepository.findDueSubscriptions.mockResolvedValue([sub]);
    
    mockService.executePayment.mockRejectedValue(new Error('Network error'));
    
    vi.useFakeTimers();
    
    const processPromise = processor.processPendingRenewals();
    
    // Attempt 1 -> Fail -> Wait 2s
    await vi.runAllTimersAsync();
    // Attempt 2 -> Fail -> Wait 4s
    await vi.runAllTimersAsync();
    // Attempt 3 -> Final Fail
    await vi.runAllTimersAsync();

    await processPromise;

    expect(mockService.executePayment).toHaveBeenCalledTimes(3);
    expect(mockRepository.recordFailure).toHaveBeenCalledTimes(3);
    expect(mockRepository.downgradeSubscription).toHaveBeenCalledWith(sub);
    expect(mockService.triggerLifecycleWebhook).toHaveBeenCalledWith('failed', expect.objectContaining({
      subscriptionId: 'sub2',
      downgradePlanId: 1,
      error: 'Network error'
    }));
    vi.useRealTimers();
  });

  it('should handle empty due subscriptions gracefully', async () => {
    mockRepository.findDueSubscriptions.mockResolvedValue([]);
    
    await processor.processPendingRenewals();
    
    expect(mockService.executePayment).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('No pending renewals found.');
  });

  it('should skip paused subscriptions', async () => {
    mockRepository.findDueSubscriptions.mockResolvedValue([
      { id: 'sub3', customer: '0x789', planId: 3, paused: true },
    ]);

    await processor.processPendingRenewals();

    expect(mockService.executePayment).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('No pending renewals found.');
  });
});
