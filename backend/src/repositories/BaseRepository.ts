/**
 * BaseRepository.ts — Issue #366
 *
 * Base repository class that handles data access
 * Repositories should only interact with the database
 */

export interface PaginationOptions {
  cursor?: string;
  limit: number;
}

export interface PaginatedResult<T> {
  items: T[];
  hasMore: boolean;
  nextCursor?: string;
}

export abstract class BaseRepository<T> {
  /**
   * Find entity by ID
   */
  abstract findById(id: string): Promise<T | null>;

  /**
   * Find all entities with pagination
   */
  abstract findAll(options: PaginationOptions): Promise<PaginatedResult<T>>;

  /**
   * Create new entity
   */
  abstract create(data: Partial<T>): Promise<T>;

  /**
   * Update existing entity
   */
  abstract update(id: string, data: Partial<T>): Promise<T | null>;

  /**
   * Delete entity
   */
  abstract delete(id: string): Promise<boolean>;

  /**
   * Check if entity exists
   */
  async exists(id: string): Promise<boolean> {
    const entity = await this.findById(id);
    return entity !== null;
  }

  /**
   * Count total entities
   */
  abstract count(filters?: Record<string, unknown>): Promise<number>;
}
