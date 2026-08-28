/**
 * InMemoryRepository.ts — Issue #716
 *
 * Every in-memory `BaseRepository<T>` implementation in this codebase
 * (ProjectRepository, ComplianceAlertRepository, ComplianceReportRepository,
 * AuditTrailRepository, OnboardingRepository, ...) re-implemented the same
 * Map-backed CRUD and cursor pagination by hand. Prisma's schema language has
 * no model-inheritance construct to share field/behavior definitions across
 * `schema.prisma` models, so this class provides the equivalent at the
 * repository layer: a shared base that owns storage, id lookup, cursor
 * pagination, generic update/delete, and filtered counting, leaving
 * subclasses to declare only how to read an entity's id/sort key and any
 * domain-specific query methods.
 */

import { BaseRepository, PaginationOptions, PaginatedResult } from "./BaseRepository.js";

export abstract class InMemoryRepository<T> extends BaseRepository<T> {
  protected store: Map<string, T> = new Map();

  /** Extract the primary key from an entity. */
  protected abstract getId(entity: T): string;

  /** Extract a sortable recency value; `findAll` orders results most-recent-first. */
  protected abstract getSortValue(entity: T): number;

  async findById(id: string): Promise<T | null> {
    return this.store.get(id) ?? null;
  }

  async findAll(options: PaginationOptions): Promise<PaginatedResult<T>> {
    const all = Array.from(this.store.values()).sort(
      (a, b) => this.getSortValue(b) - this.getSortValue(a),
    );
    return this.paginate(all, options);
  }

  /**
   * Slice a pre-filtered/sorted list into a cursor page. Subclasses reuse
   * this for scoped listings (e.g. `findByTenant`) instead of re-deriving
   * the cursor/hasMore/nextCursor bookkeeping themselves.
   */
  protected paginate(items: T[], options: PaginationOptions): PaginatedResult<T> {
    let startIndex = 0;
    if (options.cursor) {
      const idx = items.findIndex((item) => this.getId(item) === options.cursor);
      startIndex = idx >= 0 ? idx + 1 : 0;
    }

    const page = items.slice(startIndex, startIndex + options.limit);
    const hasMore = startIndex + options.limit < items.length;
    const nextCursor = hasMore ? this.getId(page[page.length - 1]) : undefined;

    return { items: page, hasMore, nextCursor };
  }

  async create(data: Partial<T>): Promise<T> {
    const entity = data as T;
    const id = this.getId(entity);
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Entity id is required");
    }
    this.store.set(id, entity);
    return entity;
  }

  async update(id: string, data: Partial<T>): Promise<T | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...data } as T;
    this.store.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async count(filters?: Record<string, unknown>): Promise<number> {
    if (!filters) return this.store.size;
    return Array.from(this.store.values()).filter((entity) =>
      Object.entries(filters).every(
        ([key, value]) => (entity as unknown as Record<string, unknown>)[key] === value,
      ),
    ).length;
  }
}
