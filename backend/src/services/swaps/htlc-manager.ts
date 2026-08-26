import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';

export interface CreateSwapInput {
  tenantId: string;
  sender: string;
  receiver: string;
  tokenA: string;
  tokenB: string;
  amountA: string;
  amountB: string;
  hashlock: string;
  timelock: number;
  disputeDeadline?: number;
  feeBps?: number;
  feeCollector?: string;
  contractAddress?: string;
}

export interface ClaimSwapInput {
  swapId: string;
  preimage: string;
}

export class HtlcManagerService {
  async createSwap(data: CreateSwapInput) {
    const swap = await prisma.atomicSwap.create({
      data: {
        tenantId: data.tenantId,
        swapId: BigInt(Date.now()),
        sender: data.sender,
        receiver: data.receiver,
        tokenA: data.tokenA,
        tokenB: data.tokenB,
        amountA: data.amountA,
        amountB: data.amountB,
        hashlock: data.hashlock,
        timelock: BigInt(data.timelock),
        disputeDeadline: data.disputeDeadline ? BigInt(data.disputeDeadline) : null,
        feeBps: data.feeBps ?? 30,
        feeCollector: data.feeCollector,
        contractAddress: data.contractAddress,
        network: 'soroban',
        expiresAt: new Date(data.timelock * 1000),
      },
    });
    return swap;
  }

  async getSwap(id: string) {
    const swap = await prisma.atomicSwap.findUnique({
      where: { id },
      include: { secret: true },
    });
    if (!swap) throw new AppError(404, 'Swap not found', 'SWAP_NOT_FOUND');
    return swap;
  }

  async getSwapByOnChainId(swapId: bigint) {
    const swap = await prisma.atomicSwap.findUnique({
      where: { swapId },
      include: { secret: true },
    });
    if (!swap) throw new AppError(404, 'Swap not found', 'SWAP_NOT_FOUND');
    return swap;
  }

  async listSwaps(tenantId: string, options?: { status?: string; limit?: number }) {
    const where: any = { tenantId };
    if (options?.status) where.status = options.status;
    return prisma.atomicSwap.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
    });
  }

  async claimSwap(data: ClaimSwapInput) {
    const swap = await prisma.atomicSwap.findUnique({ where: { id: data.swapId } });
    if (!swap) throw new AppError(404, 'Swap not found', 'SWAP_NOT_FOUND');
    if (swap.status !== 'pending') throw new AppError(400, 'Swap is not in pending state', 'SWAP_NOT_PENDING');

    await prisma.$transaction([
      prisma.atomicSwap.update({
        where: { id: data.swapId },
        data: { status: 'claimed' },
      }),
      prisma.atomicSwapSecret.upsert({
        where: { swapId: data.swapId },
        create: { swapId: data.swapId, preimage: data.preimage },
        update: { preimage: data.preimage },
      }),
    ]);

    return prisma.atomicSwap.findUnique({
      where: { id: data.swapId },
      include: { secret: true },
    });
  }

  async refundSwap(id: string) {
    const swap = await prisma.atomicSwap.findUnique({ where: { id } });
    if (!swap) throw new AppError(404, 'Swap not found', 'SWAP_NOT_FOUND');
    if (swap.status !== 'pending') throw new AppError(400, 'Swap is not in pending state', 'SWAP_NOT_PENDING');

    return prisma.atomicSwap.update({
      where: { id },
      data: { status: 'refunded' },
    });
  }

  async updateSwapStatus(id: string, status: string) {
    return prisma.atomicSwap.update({
      where: { id },
      data: { status: status as any },
    });
  }
}

export const htlcManagerService = new HtlcManagerService();
