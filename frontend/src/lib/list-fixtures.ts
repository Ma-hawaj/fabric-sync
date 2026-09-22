import type { ListResponse } from '@/hooks/use-list-query'

/** A search/filter item as the picker serializes it into `filters`. */
type RequestFilter = {
  id: string
  value: string | boolean | number
  variant: string
  operator: string
}

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

/**
 * Envelope for one `apiClient.get`/`post` call, e.g. the result of a picker's
 * server-side search. `rows` are filtered by whichever `filters` items the
 * request carried (a bare search string becomes an `iLike` filter per search
 * field), paginated to the requested slice, and wrapped in the list envelope.
 */
export function pickerResponse(
  requestUrl: string,
  rows: Array<Record<string, unknown>>,
): ListResponse<Record<string, unknown>> {
  const { searchParams } = new URL(requestUrl, 'http://localhost')
  const perPage = Number(searchParams.get('perPage') ?? (rows.length || 1))
  const page = Number(searchParams.get('page') ?? 1)

  const parsed = JSON.parse(
    searchParams.get('filters') ?? '[]',
  ) as RequestFilter[]
  // `filters` carry the search text as an `iLike` item whose `id` is the column
  // to match; a multi-column search OR-joins them (`joinOperator=or`). Filters
  // only shrink the list, so a bare `[]` returns every row.
  const operator = searchParams.get('joinOperator') ?? 'and'
  const matches = (row: Record<string, unknown>) => {
    const pass = (filter: RequestFilter) => {
      const value = row[filter.id]
      if (filter.operator === 'iLike') {
        return String(value ?? '')
          .toLowerCase()
          .includes(String(filter.value).toLowerCase())
      }
      return String(value) === String(filter.value)
    }
    return operator === 'or' ? parsed.some(pass) : parsed.every(pass)
  }
  const filtered = parsed.length === 0 ? rows : rows.filter(matches)

  const start = (page - 1) * perPage
  return {
    data: filtered.slice(start, start + perPage),
    page,
    perPage,
    total: filtered.length,
    pageCount: Math.ceil(filtered.length / perPage) || 1,
  }
}

/**
 * An `apiClient.get` that answers every picker request against in-memory rows
 * and inspects the pathname — so one mock can serve several endpoints (e.g.
 * `/materials` and `/locations`) from a single keyed fixture map.
 */
export function apiGetMock(rowsByPath: Record<string, unknown[]>) {
  return async (url: string) => {
    const { pathname } = new URL(url, 'http://localhost')
    const rows = (rowsByPath[pathname] ?? []) as Array<Record<string, unknown>>
    return { data: pickerResponse(url, rows) }
  }
}
