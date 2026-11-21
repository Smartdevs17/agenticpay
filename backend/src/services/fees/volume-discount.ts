import { prisma } from '../../lib/prisma.js';

interface VolumeDiscountResult {
  originalFee: number;
  discountedFee: number;
  discountPct: number;
  monthlyVolume: number;
  volumeTier: string;
}

export class VolumeDiscountService {
  async calculateDiscount(
    tenantId: string,
    merchantId: string,
    feeScheduleId: string,
    amount: number,
  ): Promise<VolumeDiscountResult> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const monthlyPayments = await prisma.payment.findMany({
      where: {
        tenantId,
        userId: merchantId,
        createdAt: { gte: startOfMonth },
        status: { in: ['completed', 'processing'] },
        deletedAt: null,
      },
    });

    const monthlyVolume = monthlyPayments.reduce((sum, p) => sum + Number(p.amount), 0) + amount;

    const schedule = await prisma.feeSchedule.findUnique({
      where: { id: feeScheduleId },
      include: { volumeTiers: { orderBy: { minVolume: 'asc' } } },
    });

    if (!schedule || schedule.volumeTiers.length === 0) {
      return {
        originalFee: amount,
        discountedFee: amount,
        discountPct: 0,
        monthlyVolume,
        volumeTier: 'no-tiers',
      };
    }

    const matchedTier = [...schedule.volumeTiers].reverse().find(tier => {
      const minVol = Number(tier.minVolume);
      return monthlyVolume >= minVol;
    });

    if (matchedTier) {
      const discountPct = 100 - Number(matchedTier.percentageFee);
      const originalFee = amount;
      const discountedFee = amount * (Number(matchedTier.percentageFee) / 100);

      return {
        originalFee,
        discountedFee,
        discountPct,
        monthlyVolume,
        volumeTier: `tier-${matchedTier.minVolume}`,
      };
    }

    return {
      originalFee: amount,
      discountedFee: amount,
      discountPct: 0,
      monthlyVolume,
      volumeTier: 'base',
    };
  }
}

export const volumeDiscountService = new VolumeDiscountService();
