import type { ListResponse } from '@/hooks/use-list-query'

/**
 * Wraps rows in the list envelope, for seeding the query cache in tests.
 *
 * List hooks cache `{ data, page, perPage, total, pageCount }` under a key whose
 * second segment is the serialized request — `''` for the unpaginated hooks the
 * forms use. Seeding a bare array under a bare key silently misses, and the
 * component falls through to fetching.
 */
export function listResponse<T>(rows: T[]): ListResponse<T> {
  return {
    data: rows,
    page: 1,
    perPage: rows.length,
    total: rows.length,
    pageCount: 1,
  }
}

/** The cache key an unpaginated list hook reads. */
export function allRowsKey(queryKey: string): [string, string] {
  return [queryKey, '']
}
