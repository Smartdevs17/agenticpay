import { describe, it, expect, vi, beforeEach } from 'vitest';

const paymentMethodMock = {
  findUnique: vi.fn(),
  update: vi.fn(),
};

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    paymentMethod: paymentMethodMock,
  },
}));

const { microDepositVerificationService } = await import('../micro-deposit-verification.js');

describe('MicroDepositVerificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('issueMicroDeposits', () => {
    it('throws 404 when payment method does not exist', async () => {
      paymentMethodMock.findUnique.mockResolvedValue(null);
      await expect(microDepositVerificationService.issueMicroDeposits('pm-1')).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('throws when already verified', async () => {
      paymentMethodMock.findUnique.mockResolvedValue({ id: 'pm-1', status: 'verified' });
      await expect(microDepositVerificationService.issueMicroDeposits('pm-1')).rejects.toMatchObject({
        code: 'ALREADY_VERIFIED',
      });
    });

    it('generates two amounts between 1 and 99 cents and persists them', async () => {
      paymentMethodMock.findUnique.mockResolvedValue({ id: 'pm-1', status: 'pending' });
      paymentMethodMock.update.mockResolvedValue({});

      const amounts = await microDepositVerificationService.issueMicroDeposits('pm-1');

      expect(amounts.amount1Cents).toBeGreaterThanOrEqual(1);
      expect(amounts.amount1Cents).toBeLessThanOrEqual(99);
      expect(amounts.amount2Cents).toBeGreaterThanOrEqual(1);
      expect(amounts.amount2Cents).toBeLessThanOrEqual(99);
      expect(paymentMethodMock.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pm-1' },
          data: expect.objectContaining({
            depositAmount1Cents: amounts.amount1Cents,
            depositAmount2Cents: amounts.amount2Cents,
            verificationAttempts: 0,
            status: 'pending',
          }),
        })
      );
    });
  });

  describe('verifyMicroDeposits', () => {
    it('marks verified on a correct order-independent guess', async () => {
      paymentMethodMock.findUnique.mockResolvedValue({
        id: 'pm-1',
        status: 'pending',
        depositAmount1Cents: 42,
        depositAmount2Cents: 7,
        verificationAttempts: 0,
        maxVerificationAttempts: 5,
      });
      paymentMethodMock.update.mockResolvedValue({});

      // Guess in reversed order should still match.
      const result = await microDepositVerificationService.verifyMicroDeposits('pm-1', 7, 42);

      expect(result.verified).toBe(true);
      expect(paymentMethodMock.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'verified' }) })
      );
    });

    it('increments attempts and stays pending on a wrong guess under the limit', async () => {
      paymentMethodMock.findUnique.mockResolvedValue({
        id: 'pm-1',
        status: 'pending',
        depositAmount1Cents: 42,
        depositAmount2Cents: 7,
        verificationAttempts: 0,
        maxVerificationAttempts: 5,
      });
      paymentMethodMock.update.mockResolvedValue({});

      const result = await microDepositVerificationService.verifyMicroDeposits('pm-1', 1, 2);

      expect(result.verified).toBe(false);
      expect(result.attemptsRemaining).toBe(4);
      expect(paymentMethodMock.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ verificationAttempts: 1, status: 'pending' }) })
      );
    });

    it('locks the payment method out once the attempt limit is exceeded', async () => {
      paymentMethodMock.findUnique.mockResolvedValue({
        id: 'pm-1',
        status: 'pending',
        depositAmount1Cents: 42,
        depositAmount2Cents: 7,
        verificationAttempts: 4,
        maxVerificationAttempts: 5,
      });
      paymentMethodMock.update.mockResolvedValue({});

      await expect(microDepositVerificationService.verifyMicroDeposits('pm-1', 1, 2)).rejects.toMatchObject({
        code: 'VERIFICATION_LOCKED',
      });
      expect(paymentMethodMock.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ verificationAttempts: 5, status: 'locked' }) })
      );
    });

    it('rejects further attempts once already locked', async () => {
      paymentMethodMock.findUnique.mockResolvedValue({ id: 'pm-1', status: 'locked' });
      await expect(microDepositVerificationService.verifyMicroDeposits('pm-1', 1, 2)).rejects.toMatchObject({
        code: 'VERIFICATION_LOCKED',
      });
    });
  });
});
