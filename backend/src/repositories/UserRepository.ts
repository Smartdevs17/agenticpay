/**
 * backend/src/repositories/UserRepository.ts
 *
 * Repository encapsulation for User entity queries.
 * Queries moved verbatim under Issue #1404 with transaction support.
 */

import { prisma, PrismaClient } from '../lib/prisma.js';

type DbClient = PrismaClient | any;

export interface UserCreateInput {
  id?: string;
  email: string;
  walletAddress?: string;
  name?: string;
  role?: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserUpdateInput {
  name?: string;
  walletAddress?: string;
  role?: string;
  metadata?: Record<string, unknown>;
  updatedAt?: Date;
}

export class UserRepository {
  constructor(private readonly db: DbClient = prisma) {}

  withTransaction(tx: DbClient): UserRepository {
    return new UserRepository(tx);
  }

  async findById(id: string) {
    return this.db.user.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string) {
    return this.db.user.findUnique({
      where: { email },
    });
  }

  async findByWallet(walletAddress: string) {
    return this.db.user.findFirst({
      where: { walletAddress },
    });
  }

  async listAll(limit = 100, skip = 0) {
    return this.db.user.findMany({
      take: limit,
      skip,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: UserCreateInput) {
    return this.db.user.create({
      data,
    });
  }

  async update(id: string, data: UserUpdateInput) {
    return this.db.user.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return this.db.user.delete({
      where: { id },
    });
  }

  async count(): Promise<number> {
    return this.db.user.count();
  }
}

export const defaultUserRepository = new UserRepository();
