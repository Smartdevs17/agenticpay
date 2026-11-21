/**
 * Query bus — dispatches read operations to a replica (with primary fallback).
 * Queries are side-effect-free and return projection data.
 */

export interface Query<TResult = unknown> {
  readonly _type: string;
}

export type QueryHandler<TQuery extends Query<TResult>, TResult> = (
  query: TQuery,
  options?: { forcePrimary?: boolean }
) => Promise<TResult>;

const registry = new Map<string, QueryHandler<Query<unknown>, unknown>>();

export function registerQueryHandler<TQuery extends Query<TResult>, TResult>(
  type: string,
  handler: QueryHandler<TQuery, TResult>
): void {
  registry.set(type, handler as QueryHandler<Query<unknown>, unknown>);
}

export async function executeQuery<TResult>(
  query: Query<TResult>,
  options?: { forcePrimary?: boolean }
): Promise<TResult> {
  const handler = registry.get(query._type);
  if (!handler) throw new Error(`No handler registered for query: ${query._type}`);
  return handler(query, options) as Promise<TResult>;
}
