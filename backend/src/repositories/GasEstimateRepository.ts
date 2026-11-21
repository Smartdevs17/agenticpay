/**
 * backend/src/repositories/GasEstimateRepository.ts
 *
 * Repository encapsulation for GasEstimate entity queries.
 * Queries moved verbatim under Issue #1404 with transaction support.
 */

import { prisma, PrismaClient } from '../lib/prisma.js';

type DbClient = PrismaClient | any;

export interface GasEstimateCreateInput {
  id?: string;
  network: string;
  baseFee: number;
  priorityFee?: number;
  source?: string;
  createdAt?: Date;
}

export class GasEstimateRepository {
  constructor(private readonly db: DbClient = prisma) {}

  withTransaction(tx: DbClient): GasEstimateRepository {
    return new GasEstimateRepository(tx);
  }

  async findLatest(network = 'testnet') {
    return this.db.gasEstimate.findFirst({
      where: { network },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listRecent(network = 'testnet', limit = 50) {
    return this.db.gasEstimate.findMany({
      where: { network },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: GasEstimateCreateInput) {
    return this.db.gasEstimate.create({
      data,
    });
  }
}

export const defaultGasEstimateRepository = new GasEstimateRepository();
