import * as React from 'react'
import { parseAsInteger, useQueryState, useQueryStates } from 'nuqs'
import type { ColumnDef } from '@tanstack/react-table'
import { getColumnDefId, getValidFilters } from '@/lib/data-table'
import { getFiltersStateParser } from '@/lib/parsers'
import {
  buildFilterParsers,
  toColumnFilters,
  toFilterDsl,
} from '@/lib/list-params'
import type { ExtendedColumnFilter, QueryKeys } from '@/types/data-table'

/** One filter model for the quick search, rule builder, and list request. */
export function useTableFilters<TData>(
  columns: ColumnDef<TData>[],
  queryKeys?: Partial<QueryKeys>,
) {
  const ids = React.useMemo(
    () => columns.map(getColumnDefId).filter((id) => id != null),
    [columns],
  )
  const parsers = React.useMemo(() => buildFilterParsers(columns), [columns])
  const [legacy, setLegacy] = useQueryStates(parsers)
  const [rules, setRules] = useQueryState(
    queryKeys?.filters ?? 'filters',
    getFiltersStateParser<TData>(ids).withDefault([]).withOptions({
      clearOnDefault: true,
      throttleMs: 50,
    }),
  )
  const [, setPage] = useQueryState(queryKeys?.page ?? 'page', parseAsInteger)
  // Existing bookmarks keep working, and migrate to the rule model on edit.
  const filters = React.useMemo(
    () =>
      rules.length ? rules : toFilterDsl(columns, toColumnFilters(legacy)),
    [rules, columns, legacy],
  )
  const latest = React.useRef(filters)
  latest.current = filters

  const setFilters = React.useCallback(
    (
      update:
        | ExtendedColumnFilter<TData>[]
        | null
        | ((
            previous: ExtendedColumnFilter<TData>[],
          ) => ExtendedColumnFilter<TData>[]),
    ) => {
      const next =
        typeof update === 'function' ? update(latest.current) : (update ?? [])
      latest.current = next
      void setPage(1)
      void setLegacy(
        Object.fromEntries(Object.keys(parsers).map((key) => [key, null])),
      )
      return setRules(next)
    },
    [parsers, setLegacy, setPage, setRules],
  )

  const validFilters = React.useMemo(() => getValidFilters(filters), [filters])
  return { filters, validFilters, setFilters }
}
