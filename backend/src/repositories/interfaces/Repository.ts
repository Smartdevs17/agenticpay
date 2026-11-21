/**
 * Issue #487 — Repository<T> interface
 *
 * Common contract for all storage backends (Prisma, Redis, TimescaleDB).
 */

export interface FindManyOptions<T> {
  where?: Partial<T>;
  limit?: number;
  offset?: number;
  orderBy?: { field: keyof T; direction: 'asc' | 'desc' };
}

export interface Repository<T> {
  findById(id: string): Promise<T | null>;
  findMany(options?: FindManyOptions<T>): Promise<T[]>;
  create(data: Omit<T, 'id'>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
  query(raw: string, params?: unknown[]): Promise<T[]>;
}
