import {
  getCoreRowModel,
  getFacetedMinMaxValues,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type {
  ColumnFiltersState,
  PaginationState,
  RowSelectionState,
  SortingState,
  TableOptions,
  TableState,
  Updater,
  VisibilityState,
} from '@tanstack/react-table'
import { parseAsInteger, useQueryState, useQueryStates } from 'nuqs'
import type { UseQueryStateOptions } from 'nuqs'
import * as React from 'react'

import { useDebouncedCallback } from '@/hooks/use-debounced-callback'
import {
  DEFAULT_PER_PAGE,
  FILTERS_KEY,
  JOIN_OPERATOR_KEY,
  PAGE_KEY,
  PER_PAGE_KEY,
  SORT_KEY,
  buildFilterParsers,
  filterableColumns as getFilterableColumns,
  toColumnFilters,
} from '@/lib/list-params'
import { getSortingStateParser } from '@/lib/parsers'
import type { ExtendedColumnSort, QueryKeys } from '@/types/data-table'

const DEBOUNCE_MS = 300
const THROTTLE_MS = 50

interface UseDataTableProps<TData> extends Omit<
  TableOptions<TData>,
  | 'state'
  | 'pageCount'
  | 'getCoreRowModel'
  | 'manualFiltering'
  | 'manualPagination'
  | 'manualSorting'
> {
  pageCount?: number
  manualFiltering?: boolean
  manualPagination?: boolean
  manualSorting?: boolean
  initialState?: Omit<Partial<TableState>, 'sorting'> & {
    sorting?: ExtendedColumnSort<TData>[]
  }
  queryKeys?: Partial<QueryKeys>
  history?: 'push' | 'replace'
  debounceMs?: number
  throttleMs?: number
  clearOnDefault?: boolean
  enableAdvancedFilter?: boolean
  scroll?: boolean
  shallow?: boolean
  startTransition?: React.TransitionStartFunction
}

export function useDataTable<TData>(props: UseDataTableProps<TData>) {
  const {
    columns,
    pageCount,
    manualFiltering = true,
    manualPagination = true,
    manualSorting = true,
    initialState,
    queryKeys,
    history = 'replace',
    debounceMs = DEBOUNCE_MS,
    throttleMs = THROTTLE_MS,
    clearOnDefault = false,
    enableAdvancedFilter = false,
    scroll = false,
    shallow = true,
    startTransition,
    ...tableProps
  } = props
  const pageKey = queryKeys?.page ?? PAGE_KEY
  const perPageKey = queryKeys?.perPage ?? PER_PAGE_KEY
  const sortKey = queryKeys?.sort ?? SORT_KEY
  const filtersKey = queryKeys?.filters ?? FILTERS_KEY
  const joinOperatorKey = queryKeys?.joinOperator ?? JOIN_OPERATOR_KEY

  const queryStateOptions = React.useMemo<
    Omit<UseQueryStateOptions<string>, 'parse'>
  >(
    () => ({
      history,
      scroll,
      shallow,
      throttleMs,
      debounceMs,
      clearOnDefault,
      startTransition,
    }),
    [
      history,
      scroll,
      shallow,
      throttleMs,
      debounceMs,
      clearOnDefault,
      startTransition,
    ],
  )

  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>(
    initialState?.rowSelection ?? {},
  )
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>(initialState?.columnVisibility ?? {})

  const [page, setPage] = useQueryState(
    pageKey,
    parseAsInteger.withOptions(queryStateOptions).withDefault(1),
  )
  const [perPage, setPerPage] = useQueryState(
    perPageKey,
    parseAsInteger
      .withOptions(queryStateOptions)
      .withDefault(initialState?.pagination?.pageSize ?? DEFAULT_PER_PAGE),
  )

  const pagination: PaginationState = React.useMemo(() => {
    return {
      pageIndex: page - 1, // zero-based index -> one-based index
      pageSize: perPage,
    }
  }, [page, perPage])

  const onPaginationChange = React.useCallback(
    (updaterOrValue: Updater<PaginationState>) => {
      const next =
        typeof updaterOrValue === 'function'
          ? updaterOrValue(pagination)
          : updaterOrValue

      // Changing the page size renumbers the pages, so the current page index
      // no longer means anything — go back to the first.
      const resized = next.pageSize !== pagination.pageSize
      void setPage(resized ? 1 : next.pageIndex + 1)
      void setPerPage(next.pageSize)
    },
    [pagination, setPage, setPerPage],
  )

  const columnIds = React.useMemo(() => {
    return new Set(
      columns.map((column) => column.id).filter(Boolean) as string[],
    )
  }, [columns])

  const [sorting, setSorting] = useQueryState(
    sortKey,
    getSortingStateParser<TData>(columnIds)
      .withOptions(queryStateOptions)
      .withDefault(initialState?.sorting ?? []),
  )

  const onSortingChange = React.useCallback(
    (updaterOrValue: Updater<SortingState>) => {
      const next =
        typeof updaterOrValue === 'function'
          ? updaterOrValue(sorting)
          : updaterOrValue

      // Reordering rows changes which of them fall on the first page, so a
      // page number carried over from the old order is meaningless.
      void setPage(1)
      void setSorting(next as ExtendedColumnSort<TData>[])
    },
    [sorting, setPage, setSorting],
  )

  const filterableColumns = React.useMemo(() => {
    if (enableAdvancedFilter) return []

    return getFilterableColumns(columns)
  }, [columns, enableAdvancedFilter])

  const filterParsers = React.useMemo(() => {
    if (enableAdvancedFilter) return {}

    return buildFilterParsers(columns, queryStateOptions)
  }, [columns, queryStateOptions, enableAdvancedFilter])

  const [filterValues, setFilterValues] = useQueryStates(filterParsers)

  const debouncedSetFilterValues = useDebouncedCallback(
    (values: typeof filterValues) => {
      void setPage(1)
      void setFilterValues(values)
    },
    debounceMs,
  )

  // Derived from the URL rather than seeded from it once: the URL is what the
  // server query is built from, so browser navigation and any other write to
  // these keys has to reach the table too.
  const columnFilters: ColumnFiltersState = React.useMemo(() => {
    if (enableAdvancedFilter) return []

    return toColumnFilters(filterValues)
  }, [filterValues, enableAdvancedFilter])

  const onColumnFiltersChange = React.useCallback(
    (updaterOrValue: Updater<ColumnFiltersState>) => {
      if (enableAdvancedFilter) return

      const next =
        typeof updaterOrValue === 'function'
          ? updaterOrValue(columnFilters)
          : updaterOrValue

      const filterUpdates = next.reduce<
        Record<string, string | string[] | null>
      >((acc, filter) => {
        if (filterableColumns.find((column) => column.id === filter.id)) {
          acc[filter.id] = filter.value as string | string[]
        }
        return acc
      }, {})

      for (const previous of columnFilters) {
        if (!next.some((filter) => filter.id === previous.id)) {
          filterUpdates[previous.id] = null
        }
      }

      debouncedSetFilterValues(filterUpdates)
    },
    [
      columnFilters,
      debouncedSetFilterValues,
      filterableColumns,
      enableAdvancedFilter,
    ],
  )

  const table = useReactTable({
    ...tableProps,
    columns,
    initialState,
    pageCount: manualPagination ? (pageCount ?? -1) : undefined,
    state: {
      pagination,
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
    },
    defaultColumn: {
      ...tableProps.defaultColumn,
      enableColumnFilter: false,
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onPaginationChange,
    onSortingChange,
    onColumnFiltersChange,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getFacetedMinMaxValues: getFacetedMinMaxValues(),
    manualPagination,
    manualSorting,
    manualFiltering,
    meta: {
      ...tableProps.meta,
      queryKeys: {
        page: pageKey,
        perPage: perPageKey,
        sort: sortKey,
        filters: filtersKey,
        joinOperator: joinOperatorKey,
      },
    },
  })

  return React.useMemo(
    () => ({ table, shallow, debounceMs, throttleMs }),
    [table, shallow, debounceMs, throttleMs],
  )
}
