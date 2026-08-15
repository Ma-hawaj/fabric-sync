import { parseAsArrayOf, parseAsString } from 'nuqs'
import type { SingleParser, UseQueryStateOptions } from 'nuqs'
import type {
  Column,
  ColumnDef,
  ColumnFiltersState,
  SortingState,
} from '@tanstack/react-table'

import { getDefaultFilterOperator, getValidFilters } from '@/lib/data-table'
import type {
  ExtendedColumnFilter,
  FilterOperator,
  FilterVariant,
  JoinOperator,
} from '@/types/data-table'

/**
 * The URL keys the table state lives under. Shared by `useDataTable` (which
 * writes them) and `useListParams` (which reads them back to build the request),
 * so the two can't drift.
 */
export const PAGE_KEY = 'page'
export const PER_PAGE_KEY = 'perPage'
export const SORT_KEY = 'sort'
export const FILTERS_KEY = 'filters'
export const JOIN_OPERATOR_KEY = 'joinOperator'
export const ARRAY_SEPARATOR = ','

export const DEFAULT_PER_PAGE = 10

/** Columns whose filter control writes a value into the URL. */
export function filterableColumns<TData>(columns: ColumnDef<TData>[]) {
  return columns.filter((column) => column.enableColumnFilter)
}

/**
 * One nuqs parser per filterable column. Columns offering a fixed set of
 * options hold a list; everything else holds a single string.
 */
export type FilterParsers = Record<
  string,
  SingleParser<string> | SingleParser<string[]>
>

export function buildFilterParsers<TData>(
  columns: ColumnDef<TData>[],
  options?: Omit<UseQueryStateOptions<string>, 'parse'>,
): FilterParsers {
  return filterableColumns(columns).reduce<FilterParsers>((parsers, column) => {
    const id = column.id ?? ''

    // The two branches are kept apart rather than picking a parser and then
    // calling `withOptions` on it: the union of the two parser types has no
    // single call signature, so TypeScript can't resolve the shared call.
    if (column.meta?.options) {
      const parser = parseAsArrayOf(parseAsString, ARRAY_SEPARATOR)
      parsers[id] = options ? parser.withOptions(options) : parser
    } else {
      parsers[id] = options ? parseAsString.withOptions(options) : parseAsString
    }

    return parsers
  }, {})
}

/**
 * The filter values read back off the URL, as table filter state. Values are
 * left exactly as the URL carried them — an earlier version split any string
 * containing punctuation into tokens, which quietly turned a search for
 * "John Smith" into two separate terms.
 */
export function toColumnFilters(
  filterValues: Record<string, string | string[] | null>,
): ColumnFiltersState {
  return Object.entries(filterValues)
    .filter(([, value]) => value !== null && value !== '')
    .map(([id, value]) => ({ id, value: value as string | string[] }))
}

/**
 * The operator a control implies.
 *
 * `getDefaultFilterOperator` already answers this for every variant whose
 * control produces one value — text searches contain, multi-selects match any
 * of, selects and booleans compare equal. The two range variants are the
 * exception: their controls emit a pair of bounds, which is `isBetween`, but
 * both can also emit a single value when only one side is set.
 */
function operatorFor(variant: FilterVariant, value: unknown): FilterOperator {
  if (variant === 'range' || variant === 'dateRange') {
    return Array.isArray(value) ? 'isBetween' : 'eq'
  }

  return getDefaultFilterOperator(variant)
}

/**
 * A filter value as the DSL carries it. Controls hand over strings, numbers,
 * epoch timestamps and arrays of those; the wire format is strings, with a blank
 * standing for an unset side of a range.
 */
function serializeValue(value: unknown): string | string[] {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      entry === null || entry === undefined ? '' : String(entry),
    )
  }

  return value === null || value === undefined ? '' : String(value)
}

/**
 * Translates the table's own filter state into the filter DSL the API speaks.
 *
 * This is the single point of translation: the browser URL keeps its
 * one-key-per-column shape, and the request carries the DSL. The advanced filter
 * components already emit this exact shape, so switching them on later needs no
 * server change.
 */
export function toFilterDsl<TData>(
  columns: ColumnDef<TData>[],
  columnFilters: ColumnFiltersState,
): ExtendedColumnFilter<TData>[] {
  const byId = new Map(columns.map((column) => [column.id, column]))

  const filters = columnFilters.flatMap((filter) => {
    const variant = byId.get(filter.id)?.meta?.variant
    if (!variant) return []

    return [
      {
        id: filter.id as Extract<keyof TData, string>,
        value: serializeValue(filter.value),
        variant,
        operator: operatorFor(variant, filter.value),
        // The server ignores this; it exists to satisfy the shared filter type,
        // whose `filterId` is the advanced filter list's React key.
        filterId: filter.id,
      },
    ]
  })

  // Drops filters with nothing selected, so an empty text box doesn't become a
  // predicate — and, because the request URL is the query key, doesn't become a
  // redundant refetch either.
  return getValidFilters(filters)
}

export interface ListRequest<TData> {
  page: number
  perPage: number
  sorting: SortingState
  filters: ExtendedColumnFilter<TData>[]
  joinOperator?: JoinOperator
}

/**
 * Serializes a request into the query string the backend's list layer parses.
 * Empty parts are left out so the string stays stable and readable.
 */
export function toApiSearchParams<TData>({
  page,
  perPage,
  sorting,
  filters,
  joinOperator,
}: ListRequest<TData>): URLSearchParams {
  const search = new URLSearchParams()

  search.set(PAGE_KEY, String(page))
  search.set(PER_PAGE_KEY, String(perPage))

  if (sorting.length > 0) {
    search.set(SORT_KEY, JSON.stringify(sorting))
  }

  if (filters.length > 0) {
    search.set(
      FILTERS_KEY,
      JSON.stringify(
        filters.map(({ id, value, variant, operator }) => ({
          id,
          value,
          variant,
          operator,
        })),
      ),
    )

    if (joinOperator && joinOperator !== 'and') {
      search.set(JOIN_OPERATOR_KEY, joinOperator)
    }
  }

  return search
}

/**
 * Faceted counts come from the rows in hand, and under server-side paging those
 * are only the current page. Options therefore have to be declared rather than
 * discovered — this narrows a column to the ones that were.
 */
export function hasOptions<TData, TValue>(column: Column<TData, TValue>) {
  return (column.columnDef.meta?.options?.length ?? 0) > 0
}
