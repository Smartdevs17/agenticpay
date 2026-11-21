/**
 * QueryBuilder.ts — Issue #728
 *
 * Minimal query builder for composing database queries
 * Used by repositories to build queries in a type-safe, fluent way
 */

export interface QueryBuilderOptions<T> {
  where?: Partial<T>;
  limit?: number;
  offset?: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
  include?: Record<string, boolean | object>;
  select?: Record<string, boolean>;
}

export class QueryBuilder<T extends { id: string }> {
  private options: QueryBuilderOptions<T> = {};

  where(conditions: Partial<T>): this {
    this.options.where = conditions;
    return this;
  }

  limit(value: number): this {
    this.options.limit = value;
    return this;
  }

  offset(value: number): this {
    this.options.offset = value;
    return this;
  }

  orderBy(field: keyof T, direction: 'asc' | 'desc' = 'asc'): this {
    this.options.orderBy = { [field as string]: direction };
    return this;
  }

  include(relations: Record<string, boolean | object>): this {
    this.options.include = relations;
    return this;
  }

  select(fields: Record<string, boolean>): this {
    this.options.select = fields;
    return this;
  }

  build(): QueryBuilderOptions<T> {
    return this.options;
  }
}
