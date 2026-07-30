// Issue #633: Payment method verification via micro-deposits (minimal real slice).
//
// Flow:
//  1. issueMicroDeposits() generates two small pseudo-random cent amounts (1-99c)
//     and persists them as "pending" against a PaymentMethod row.
//  2. verifyMicroDeposits() lets the owner submit two guessed amounts. If both
//     match, the payment method is marked verified. Otherwise the attempt
//     counter is incremented and, once the configured limit is exceeded, the
//     payment method is locked out from further verification attempts.
//
// Deferred (see PR body): notifications on deposit issuance/lockout,
// verification analytics/reporting, admin override tooling.

import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';

export interface MicroDepositAmounts {
  amount1Cents: number;
  amount2Cents: number;
}

function randomCentAmount(): number {
  // 1-99 cents, matches how real micro-deposit verification (e.g. Plaid/Stripe) works.
  return Math.floor(Math.random() * 99) + 1;
}

export class MicroDepositVerificationService {
  /**
   * Generates two pending micro-deposit amounts for a payment method and
   * persists them. Resets any prior verification attempts.
   */
  async issueMicroDeposits(paymentMethodId: string): Promise<MicroDepositAmounts> {
    const method = await prisma.paymentMethod.findUnique({ where: { id: paymentMethodId } });
    if (!method) {
      throw new AppError(404, 'Payment method not found', 'PAYMENT_METHOD_NOT_FOUND');
    }
    if (method.status === 'verified') {
      throw new AppError(400, 'Payment method is already verified', 'ALREADY_VERIFIED');
    }

    const amount1Cents = randomCentAmount();
    const amount2Cents = randomCentAmount();

    await prisma.paymentMethod.update({
      where: { id: paymentMethodId },
      data: {
        depositAmount1Cents: amount1Cents,
        depositAmount2Cents: amount2Cents,
        verificationAttempts: 0,
        status: 'pending',
        depositsIssuedAt: new Date(),
        verifiedAt: null,
      },
    });

    // The amounts are only returned here for the caller to relay to the
    // outbound deposit rail (e.g. ACH). They are never exposed via a read API.
    return { amount1Cents, amount2Cents };
  }

  /**
   * Verifies two guessed deposit amounts against the pending values. Increments
   * the attempt counter on mismatch and locks the payment method out once the
   * attempt limit is exceeded.
   */
  async verifyMicroDeposits(
    paymentMethodId: string,
    guess1Cents: number,
    guess2Cents: number
  ): Promise<{ verified: boolean; attemptsRemaining: number; status: string }> {
    const method = await prisma.paymentMethod.findUnique({ where: { id: paymentMethodId } });
    if (!method) {
      throw new AppError(404, 'Payment method not found', 'PAYMENT_METHOD_NOT_FOUND');
    }
    if (method.status === 'verified') {
      throw new AppError(400, 'Payment method is already verified', 'ALREADY_VERIFIED');
    }
    if (method.status === 'locked') {
      throw new AppError(423, 'Verification attempts exceeded; payment method is locked', 'VERIFICATION_LOCKED');
    }
    if (method.depositAmount1Cents == null || method.depositAmount2Cents == null) {
      throw new AppError(400, 'No pending micro-deposits to verify', 'NO_PENDING_DEPOSITS');
    }

    // Order-independent match, since depositors can't rely on statement ordering.
    const guesses = [guess1Cents, guess2Cents].sort((a, b) => a - b);
    const actual = [method.depositAmount1Cents, method.depositAmount2Cents].sort((a, b) => a - b);
    const isMatch = guesses[0] === actual[0] && guesses[1] === actual[1];

    if (isMatch) {
      await prisma.paymentMethod.update({
        where: { id: paymentMethodId },
        data: { status: 'verified', verifiedAt: new Date() },
      });
      return { verified: true, attemptsRemaining: 0, status: 'verified' };
    }

    const attempts = method.verificationAttempts + 1;
    const exceeded = attempts >= method.maxVerificationAttempts;

    await prisma.paymentMethod.update({
      where: { id: paymentMethodId },
      data: {
        verificationAttempts: attempts,
        status: exceeded ? 'locked' : 'pending',
      },
    });

    if (exceeded) {
      throw new AppError(423, 'Verification attempts exceeded; payment method is locked', 'VERIFICATION_LOCKED');
    }

    return {
      verified: false,
      attemptsRemaining: method.maxVerificationAttempts - attempts,
      status: 'pending',
    };
  }
}

export const microDepositVerificationService = new MicroDepositVerificationService();
