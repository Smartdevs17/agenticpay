/**
 * InMemoryRepository.ts — Issue #716
 *
 * ProjectRepository, OnboardingRepository, and ComplianceRepository each
 * reimplemented the same Map-backed CRUD + cursor pagination + generic
 * filter-count logic. This base class holds that shared behavior so
 * concrete repositories only need to supply entity-specific bits: how to
 * get an entity's id/cursor key, how to sort it, and how to validate/merge
 * on create/update.
 */

import { BaseRepository, PaginationOptions, PaginatedResult } from './BaseRepository.js';

export abstract class InMemoryRepository<T> extends BaseRepository<T> {
  protected readonly store: Map<string, T> = new Map();

  /** Field used as both the Map key and the pagination cursor. */
  protected abstract getId(entity: T): string;

  /** Value used to sort findAll()/findBy*() results, most-recent first. */
  protected abstract getSortTimestamp(entity: T): number;

  protected sortedValues(): T[] {
    return Array.from(this.store.values()).sort(
      (a, b) => this.getSortTimestamp(b) - this.getSortTimestamp(a),
    );
  }

  protected paginate(sorted: T[], options: PaginationOptions): PaginatedResult<T> {
    let startIndex = 0;
    if (options.cursor) {
      const idx = sorted.findIndex((item) => this.getId(item) === options.cursor);
      startIndex = idx >= 0 ? idx + 1 : 0;
    }
    const items = sorted.slice(startIndex, startIndex + options.limit);
    const hasMore = startIndex + options.limit < sorted.length;
    return {
      items,
      hasMore,
      nextCursor: hasMore ? this.getId(items[items.length - 1]) : undefined,
    };
  }

  /** Insert/overwrite a fully-formed entity, keyed by getId(entity). */
  protected put(entity: T): T {
    this.store.set(this.getId(entity), entity);
    return entity;
  }

  async findById(id: string): Promise<T | null> {
    return this.store.get(id) ?? null;
  }

  async findAll(options: PaginationOptions): Promise<PaginatedResult<T>> {
    return this.paginate(this.sortedValues(), options);
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async count(filters?: Record<string, unknown>): Promise<number> {
    if (!filters) return this.store.size;
    return Array.from(this.store.values()).filter((entity) =>
      Object.entries(filters).every(([k, v]) => (entity as unknown as Record<string, unknown>)[k] === v),
    ).length;
  }
}
