import { prisma } from '../../lib/prisma.js';

interface TierResult {
  tierLabel: string;
  flatFee: number;
  percentageFee: number;
  minFee: number | null;
  maxFee: number | null;
}

export class TierResolver {
  async resolveTier(feeScheduleId: string, amount: number): Promise<TierResult | null> {
    const schedule = await prisma.feeSchedule.findUnique({
      where: { id: feeScheduleId },
      include: { volumeTiers: { orderBy: { minVolume: 'asc' } } },
    });

    if (!schedule || schedule.status !== 'active') return null;

    if (schedule.feeType !== 'tiered' || schedule.volumeTiers.length === 0) {
      return {
        tierLabel: 'default',
        flatFee: Number(schedule.flatFee ?? 0),
        percentageFee: Number(schedule.percentageFee ?? 0),
        minFee: schedule.minFee ? Number(schedule.minFee) : null,
        maxFee: schedule.maxFee ? Number(schedule.maxFee) : null,
      };
    }

    const matchedTier = schedule.volumeTiers.find(tier => {
      const minVol = Number(tier.minVolume);
      const maxVol = Number(tier.maxVolume ?? Infinity);
      return amount >= minVol && amount <= maxVol;
    });

    if (matchedTier) {
      return {
        tierLabel: `${matchedTier.minVolume}-${matchedTier.maxVolume ?? '∞'}`,
        flatFee: Number(matchedTier.flatFee ?? 0),
        percentageFee: Number(matchedTier.percentageFee),
        minFee: null,
        maxFee: null,
      };
    }

    const lastTier = schedule.volumeTiers[schedule.volumeTiers.length - 1];
    if (lastTier && amount >= Number(lastTier.maxVolume ?? Infinity)) {
      return {
        tierLabel: `>${lastTier.maxVolume ?? lastTier.minVolume}`,
        flatFee: Number(lastTier.flatFee ?? 0),
        percentageFee: Number(lastTier.percentageFee),
        minFee: null,
        maxFee: null,
      };
    }

    return null;
  }
}

export const tierResolver = new TierResolver();
