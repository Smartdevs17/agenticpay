export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export function paginateArray<T>(
  array: T[],
  options: PaginationOptions = {}
): PaginatedResponse<T> {
  const limit = Math.min(options.limit || 50, 1000); // Max 1000 items
  const offset = Math.max(options.offset || 0, 0);

  const total = array.length;
  const data = array.slice(offset, offset + limit);

  return {
    data,
    total,
    limit,
    offset,
  };
}