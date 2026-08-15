import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { apiClient } from '@/lib/api'

/** The envelope every list endpoint returns. */
export interface ListResponse<T> {
  data: T[]
  page: number
  perPage: number
  total: number
  pageCount: number
}

interface UseListQueryOptions<T, TResult = T> {
  /** Endpoint path, e.g. `/invoices`. */
  endpoint: string
  /** Query key prefix — the serialized request is appended to it. */
  queryKey: string
  /** Serialized page, sort and filter state; see `useListParams`. */
  searchParams: URLSearchParams
  /** Applied to each row, for the few lists that reshape a field. */
  select?: (row: T) => TResult
}

const EMPTY: never[] = []

/**
 * The one place a list endpoint is fetched. Every feature's list hook is a call
 * to this with its endpoint and key, so paging, filtering and sorting are not
 * re-implemented per feature.
 */
export function useListQuery<T, TResult = T>({
  endpoint,
  queryKey,
  searchParams,
  select,
}: UseListQueryOptions<T, TResult>) {
  const search = searchParams.toString()

  const query = useQuery({
    // The serialized request is part of the key, so each page and filter
    // combination is cached separately rather than overwriting the last.
    queryKey: [queryKey, search],
    queryFn: async (): Promise<ListResponse<T>> => {
      // `apiClient`'s interceptors attach the bearer token and normalize any
      // non-2xx response to `ApiError` — nothing per-hook to do for either.
      const { data } = await apiClient.get<ListResponse<T>>(
        `${endpoint}?${search}`,
      )
      return data
    },
    // Without this, every page or filter change drops back to the loading state
    // and the table flashes empty between requests.
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  const rows = query.data?.data
  const data = (rows ? (select ? rows.map(select) : rows) : EMPTY) as TResult[]

  return {
    ...query,
    data,
    total: query.data?.total ?? 0,
    pageCount: query.data?.pageCount ?? 0,
  }
}
