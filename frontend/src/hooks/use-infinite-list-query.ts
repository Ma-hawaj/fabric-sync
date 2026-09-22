import { useInfiniteQuery } from '@tanstack/react-query'

import { PICKER_PER_PAGE, buildPickerRequestParams } from '@/lib/async-combobox'
import { apiClient } from '@/lib/api'
import type { ListResponse } from '@/hooks/use-list-query'
import type { PickerFilter, SearchField } from '@/lib/async-combobox'

interface UseInfiniteListQueryOptions {
  /** Query key prefix — the field, search text and page size are appended. */
  queryKey: string
  /** Endpoint path, e.g. `/customers`. */
  endpoint: string
  /** The `ListSpec` column(s) the search text filters on, e.g. `name`. */
  searchField: SearchField
  /** Static filters attached to every request, e.g. only stock-holding rows. */
  filters?: readonly PickerFilter[]
  /** Debounced search text; a fresh query (restarting at page 1) per value. */
  search?: string
  perPage?: number
}

/**
 * `useInfiniteQuery` browses one paginated list endpoint, restarting at page 1
 * whenever the search text changes. Pages accumulate in `data.pages` the way
 * the integer-page backend expects (`page`, `pageCount` are 1-based).
 */
export function useInfiniteListQuery<T>({
  queryKey,
  endpoint,
  searchField,
  filters,
  search = '',
  perPage = PICKER_PER_PAGE,
}: UseInfiniteListQueryOptions) {
  return useInfiniteQuery({
    queryKey: [
      queryKey,
      searchField,
      JSON.stringify(filters ?? []),
      search,
      perPage,
    ],
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<ListResponse<T>> => {
      const params = buildPickerRequestParams({
        page: pageParam,
        perPage,
        search,
        searchField,
        filters,
      })
      const response = await apiClient.get(`${endpoint}?${params.toString()}`)

      return response.data
    },
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.pageCount ? lastPage.page + 1 : undefined,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
