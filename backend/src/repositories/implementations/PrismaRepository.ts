/**
 * Issue #487 — Prisma repository implementation
 *
 * Adapts a Prisma model delegate to the Repository<T> interface.
 * Pass a Prisma delegate (e.g. prisma.project) as `delegate`.
 */

import type { FindManyOptions, Repository } from '../interfaces/Repository.js';

type PrismaDelegate<T> = {
  findUnique(args: { where: { id: string } }): Promise<T | null>;
  findMany(args?: {
    where?: Partial<T>;
    skip?: number;
    take?: number;
    orderBy?: Record<string, 'asc' | 'desc'>;
  }): Promise<T[]>;
  create(args: { data: Omit<T, 'id'> }): Promise<T>;
  update(args: { where: { id: string }; data: Partial<T> }): Promise<T>;
  delete(args: { where: { id: string } }): Promise<T>;
};

export class PrismaRepository<T extends { id: string }> implements Repository<T> {
  constructor(private readonly delegate: PrismaDelegate<T>) {}

  findById(id: string): Promise<T | null> {
    return this.delegate.findUnique({ where: { id } });
  }

  findMany(options: FindManyOptions<T> = {}): Promise<T[]> {
    return this.delegate.findMany({
      where: options.where,
      skip: options.offset,
      take: options.limit,
      orderBy: options.orderBy
        ? { [options.orderBy.field as string]: options.orderBy.direction }
        : undefined,
    });
  }

  async create(data: Omit<T, 'id'>): Promise<T> {
    return this.delegate.create({ data });
  }

  async update(id: string, data: Partial<T>): Promise<T | null> {
    try {
      return await this.delegate.update({ where: { id }, data });
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.delegate.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // Raw query not supported via Prisma delegate — use prisma.$queryRaw directly
  async query(_raw: string, _params?: unknown[]): Promise<T[]> {
    throw new Error('Use prisma.$queryRaw for raw queries');
  }
}
