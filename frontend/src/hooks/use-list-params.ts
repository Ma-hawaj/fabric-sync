import { parseAsInteger, useQueryState, useQueryStates } from 'nuqs'
import type { ColumnDef } from '@tanstack/react-table'
import * as React from 'react'

import { getSortingStateParser } from '@/lib/parsers'
import {
  DEFAULT_PER_PAGE,
  PAGE_KEY,
  PER_PAGE_KEY,
  SORT_KEY,
  buildFilterParsers,
  toApiSearchParams,
  toColumnFilters,
  toFilterDsl,
} from '@/lib/list-params'
import type { ExtendedColumnSort } from '@/types/data-table'

interface UseListParamsOptions<TData> {
  columns: ColumnDef<TData>[]
  defaultPerPage?: number
}

/**
 * Reads the table's URL state and turns it into the request the API expects.
 *
 * It reads the same nuqs keys `useDataTable` writes. Sharing the URL rather than
 * threading state between them is deliberate: the query has to be issued before
 * there is any data to build a table from, and the URL is the one thing both
 * sides can see at that point. The key definitions live in `lib/list-params` so
 * there is still only one spelling of them.
 */
export function useListParams<TData>({
  columns,
  defaultPerPage = DEFAULT_PER_PAGE,
}: UseListParamsOptions<TData>) {
  const [page] = useQueryState(PAGE_KEY, parseAsInteger.withDefault(1))
  const [perPage] = useQueryState(
    PER_PAGE_KEY,
    parseAsInteger.withDefault(defaultPerPage),
  )

  const columnIds = React.useMemo(
    () =>
      new Set(columns.map((column) => column.id).filter(Boolean) as string[]),
    [columns],
  )

  const [sorting] = useQueryState(
    SORT_KEY,
    getSortingStateParser<TData>(columnIds).withDefault(
      [] as ExtendedColumnSort<TData>[],
    ),
  )

  const filterParsers = React.useMemo(
    () => buildFilterParsers(columns),
    [columns],
  )
  const [filterValues] = useQueryStates(filterParsers)

  return React.useMemo(() => {
    const filters = toFilterDsl(columns, toColumnFilters(filterValues))

    return {
      page,
      perPage,
      searchParams: toApiSearchParams({ page, perPage, sorting, filters }),
    }
  }, [columns, filterValues, page, perPage, sorting])
}
