import { prisma } from '../../lib/prisma.js';
import { tierResolver } from './tier-resolver.js';
import { volumeDiscountService } from './volume-discount.js';
import { AppError } from '../../middleware/errorHandler.js';

interface FeeBreakdown {
  baseFee: number;
  processingFee: number;
  gasSurcharge: number;
  volumeDiscount: number;
  totalFee: number;
  netAmount: number;
}

interface FeeCalculationInput {
  tenantId: string;
  merchantId?: string;
  amount: number;
  currency?: string;
  chain?: string;
  gasPriceGwei?: number;
}

interface FeeScheduleInfo {
  id: string;
  name: string;
  feeType: string;
  flatFee: number | null;
  percentageFee: number | null;
  minFee: number | null;
  maxFee: number | null;
  gasSurchargePct: number | null;
  gasThresholdGwei: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
}

export class FeeEngineService {
  private readonly DEFAULT_GAS_THRESHOLD_GWEI = 50;
  private readonly DEFAULT_GAS_SURCHARGE_PCT = 10;
  private readonly CACHE_TTL_SECONDS = 300; // 5 min

  async calculate(input: FeeCalculationInput): Promise<{
    breakdown: FeeBreakdown;
    schedule: FeeScheduleInfo;
    appliedVolumeDiscount: boolean;
  }> {
    const schedule = await this.resolveFeeSchedule(input.tenantId);
    if (!schedule) throw new AppError(404, 'No active fee schedule found', 'FEE_SCHEDULE_NOT_FOUND');

    const tier = await tierResolver.resolveTier(schedule.id, input.amount);
    if (!tier) throw new AppError(400, 'No applicable fee tier for this amount', 'NO_TIER_FOUND');

    let baseFee = tier.flatFee + (input.amount * tier.percentageFee / 100);
    baseFee = this.applyMinMax(baseFee, tier.minFee, tier.maxFee);

    const processingFee = baseFee;
    let volumeDiscount = 0;
    let appliedVolumeDiscount = false;

    if (input.merchantId) {
      const override = await this.getMerchantOverride(schedule.id, input.merchantId);
      if (override) {
        const overrideFlat = Number(override.flatFee ?? tier.flatFee);
        const overridePct = Number(override.percentageFee ?? tier.percentageFee);
        baseFee = overrideFlat + (input.amount * overridePct / 100);
        baseFee = this.applyMinMax(baseFee, Number(override.minFee ?? tier.minFee), Number(override.maxFee ?? tier.maxFee));
      }

      const discountResult = await volumeDiscountService.calculateDiscount(
        input.tenantId, input.merchantId, schedule.id, input.amount,
      );
      if (discountResult.discountPct > 0) {
        volumeDiscount = baseFee * (discountResult.discountPct / 100);
        baseFee -= volumeDiscount;
        appliedVolumeDiscount = true;
      }
    }

    let gasSurcharge = 0;
    const gasThreshold = Number(schedule.gasThresholdGwei ?? this.DEFAULT_GAS_THRESHOLD_GWEI);
    const inputGasPct = Number(schedule.gasSurchargePct ?? this.DEFAULT_GAS_SURCHARGE_PCT);

    if (input.gasPriceGwei && input.gasPriceGwei > gasThreshold) {
      gasSurcharge = baseFee * (inputGasPct / 100);
      baseFee += gasSurcharge;
    }

    const totalFee = processingFee + gasSurcharge;
    const netAmount = input.amount - totalFee;

    const scheduleInfo: FeeScheduleInfo = {
      id: schedule.id,
      name: schedule.name,
      feeType: schedule.feeType,
      flatFee: schedule.flatFee ? Number(schedule.flatFee) : null,
      percentageFee: schedule.percentageFee ? Number(schedule.percentageFee) : null,
      minFee: schedule.minFee ? Number(schedule.minFee) : null,
      maxFee: schedule.maxFee ? Number(schedule.maxFee) : null,
      gasSurchargePct: schedule.gasSurchargePct ? Number(schedule.gasSurchargePct) : null,
      gasThresholdGwei: schedule.gasThresholdGwei ? Number(schedule.gasThresholdGwei) : null,
      effectiveFrom: schedule.effectiveFrom.toISOString(),
      effectiveTo: schedule.effectiveTo?.toISOString() ?? null,
      status: schedule.status,
    };

    return {
      breakdown: {
        baseFee: parseFloat(baseFee.toFixed(8)),
        processingFee: parseFloat(processingFee.toFixed(8)),
        gasSurcharge: parseFloat(gasSurcharge.toFixed(8)),
        volumeDiscount: parseFloat(volumeDiscount.toFixed(8)),
        totalFee: parseFloat(totalFee.toFixed(8)),
        netAmount: parseFloat(netAmount.toFixed(8)),
      },
      schedule: scheduleInfo,
      appliedVolumeDiscount,
    };
  }

  async preview(tenantId: string, amount: number, merchantId?: string) {
    return this.calculate({ tenantId, amount, merchantId });
  }

  async listFeeSchedules(tenantId: string, status?: string) {
    const where: any = { tenantId, deletedAt: null };
    if (status) where.status = status;
    return prisma.feeSchedule.findMany({
      where,
      include: {
        volumeTiers: { orderBy: { minVolume: 'asc' } },
        merchantOverrides: { where: { status: 'active' } },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async createFeeSchedule(tenantId: string, data: any) {
    const { volumeTiers, ...scheduleData } = data;

    const schedule = await prisma.feeSchedule.create({
      data: {
        ...scheduleData,
        tenantId,
        volumeTiers: volumeTiers ? {
          create: volumeTiers.map((t: any) => ({
            minVolume: t.minVolume,
            maxVolume: t.maxVolume ?? null,
            flatFee: t.flatFee ?? null,
            percentageFee: t.percentageFee,
          })),
        } : undefined,
      },
      include: { volumeTiers: true },
    });

    await prisma.feeChangeLog.create({
      data: {
        feeScheduleId: schedule.id,
        field: 'create',
        newValue: { name: schedule.name, feeType: schedule.feeType },
      },
    });

    return schedule;
  }

  async updateFeeSchedule(scheduleId: string, tenantId: string, data: any) {
    const existing = await prisma.feeSchedule.findFirst({
      where: { id: scheduleId, tenantId, deletedAt: null },
    });
    if (!existing) throw new AppError(404, 'Fee schedule not found', 'NOT_FOUND');

    const { volumeTiers, ...scheduleData } = data;

    const changes: { field: string; oldValue: any; newValue: any }[] = [];
    for (const [key, value] of Object.entries(scheduleData)) {
      if (JSON.stringify((existing as any)[key]) !== JSON.stringify(value)) {
        changes.push({ field: key, oldValue: (existing as any)[key], newValue: value });
      }
    }

    const schedule = await prisma.feeSchedule.update({
      where: { id: scheduleId },
      data: {
        ...scheduleData,
        volumeTiers: volumeTiers ? {
          deleteMany: {},
          create: volumeTiers.map((t: any) => ({
            minVolume: t.minVolume,
            maxVolume: t.maxVolume ?? null,
            flatFee: t.flatFee ?? null,
            percentageFee: t.percentageFee,
          })),
        } : undefined,
      },
      include: { volumeTiers: true },
    });

    for (const change of changes) {
      await prisma.feeChangeLog.create({
        data: {
          feeScheduleId: scheduleId,
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
        },
      });
    }

    return schedule;
  }

  async getFeeSchedule(scheduleId: string, tenantId: string) {
    const schedule = await prisma.feeSchedule.findFirst({
      where: { id: scheduleId, tenantId, deletedAt: null },
      include: {
        volumeTiers: { orderBy: { minVolume: 'asc' } },
        merchantOverrides: { where: { status: 'active' } },
        changeLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!schedule) throw new AppError(404, 'Fee schedule not found', 'NOT_FOUND');
    return schedule;
  }

  async deleteFeeSchedule(scheduleId: string, tenantId: string) {
    const existing = await prisma.feeSchedule.findFirst({
      where: { id: scheduleId, tenantId, deletedAt: null },
    });
    if (!existing) throw new AppError(404, 'Fee schedule not found', 'NOT_FOUND');
    return prisma.feeSchedule.update({
      where: { id: scheduleId },
      data: { deletedAt: new Date(), status: 'inactive' },
    });
  }

  async setMerchantOverride(
    feeScheduleId: string,
    merchantId: string,
    data: {
      flatFee?: number;
      percentageFee?: number;
      minFee?: number;
      maxFee?: number;
      effectiveFrom?: string;
      effectiveTo?: string;
    },
  ) {
    const existing = await prisma.merchantFeeOverride.findUnique({
      where: { feeScheduleId_merchantId: { feeScheduleId, merchantId } },
    });

    if (existing) {
      return prisma.merchantFeeOverride.update({
        where: { id: existing.id },
        data: {
          ...data,
          effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : undefined,
          effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : undefined,
        },
      });
    }

    return prisma.merchantFeeOverride.create({
      data: {
        feeScheduleId,
        merchantId,
        flatFee: data.flatFee,
        percentageFee: data.percentageFee,
        minFee: data.minFee,
        maxFee: data.maxFee,
        effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : new Date(),
        effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
      },
    });
  }

  async getMerchantOverride(feeScheduleId: string, merchantId: string) {
    return prisma.merchantFeeOverride.findFirst({
      where: {
        feeScheduleId,
        merchantId,
        status: 'active',
        effectiveFrom: { lte: new Date() },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: new Date() } },
        ],
      },
    });
  }

  async logFeeChange(feeScheduleId: string, field: string, oldValue: any, newValue: any, changedBy?: string, reason?: string) {
    return prisma.feeChangeLog.create({
      data: { feeScheduleId, field, oldValue, newValue, changedBy, reason },
    });
  }

  private async resolveFeeSchedule(tenantId: string) {
    const now = new Date();
    return prisma.feeSchedule.findFirst({
      where: {
        tenantId,
        status: 'active',
        effectiveFrom: { lte: now },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: now } },
        ],
        deletedAt: null,
      },
      include: { volumeTiers: { orderBy: { minVolume: 'asc' } } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  private applyMinMax(fee: number, min: number | null, max: number | null): number {
    let result = fee;
    if (min != null && result < min) result = min;
    if (max != null && result > max) result = max;
    return result;
  }
}

export const feeEngineService = new FeeEngineService();
