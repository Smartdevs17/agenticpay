/**
 * Issue #487 — TimescaleDB repository (time-series / event logs)
 *
 * Wraps a pg Pool. Uses the Repository<T> interface so services stay backend-agnostic.
 * The table must have an `id` column (text PK) and a `time` timestamptz column.
 */

import type { FindManyOptions, Repository } from '../interfaces/Repository.js';

/** Minimal pg Pool surface we depend on */
interface PgPool {
  query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export class TimescaleRepository<T extends { id: string }> implements Repository<T> {
  constructor(
    private readonly pool: PgPool,
    private readonly table: string,
  ) {}

  async findById(id: string): Promise<T | null> {
    const { rows } = await this.pool.query<T>(`SELECT * FROM ${this.table} WHERE id = $1 LIMIT 1`, [id]);
    return rows[0] ?? null;
  }

  async findMany(options: FindManyOptions<T> = {}): Promise<T[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (options.where) {
      for (const [key, value] of Object.entries(options.where)) {
        conditions.push(`${key} = $${idx++}`);
        params.push(value);
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = options.orderBy
      ? `ORDER BY ${String(options.orderBy.field)} ${options.orderBy.direction}`
      : 'ORDER BY time DESC';
    const limit = options.limit ? `LIMIT $${idx++}` : '';
    const offset = options.offset ? `OFFSET $${idx++}` : '';

    if (options.limit) params.push(options.limit);
    if (options.offset) params.push(options.offset);

    const sql = `SELECT * FROM ${this.table} ${where} ${orderBy} ${limit} ${offset}`.trim();
    const { rows } = await this.pool.query<T>(sql, params);
    return rows;
  }

  async create(data: Omit<T, 'id'>): Promise<T> {
    const id = `ts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record = { ...data, id } as T;
    const keys = Object.keys(record);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const values = Object.values(record);
    const { rows } = await this.pool.query<T>(
      `INSERT INTO ${this.table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values,
    );
    return rows[0];
  }

  async update(id: string, data: Partial<T>): Promise<T | null> {
    const entries = Object.entries(data);
    if (entries.length === 0) return this.findById(id);
    const sets = entries.map(([k], i) => `${k} = $${i + 1}`).join(', ');
    const values = [...entries.map(([, v]) => v), id];
    const { rows } = await this.pool.query<T>(
      `UPDATE ${this.table} SET ${sets} WHERE id = $${entries.length + 1} RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const { rows } = await this.pool.query<T>(`DELETE FROM ${this.table} WHERE id = $1 RETURNING id`, [id]);
    return rows.length > 0;
  }

  async query(raw: string, params?: unknown[]): Promise<T[]> {
    const { rows } = await this.pool.query<T>(raw, params);
    return rows;
  }
}
