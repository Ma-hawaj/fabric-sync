import type { ListResponse } from '@/hooks/use-list-query'

/** How many rows the picker combos request per page of the infinite list. */
export const PICKER_PER_PAGE = 20

/** An option a picker combobox renders from one list row. */
export interface AsyncComboboxOption {
  value: string
  label: string
}

/**
 * One or more `ListSpec` columns the search text matches against. A single
 * field combines `AND` with any static `filters`; several search fields are
 * `OR`-joined and therefore cannot be combined with static filters.
 */
export type SearchField = string | readonly string[]

/** A static filter attached to every request, e.g. only stock-holding rows. */
export interface PickerFilter {
  id: string
  value: string | boolean | number
  variant: string
  operator: string
}

interface PickerRequestParams {
  page: number
  perPage: number
  search?: string
  searchField: SearchField
  filters?: readonly PickerFilter[]
}

/**
 * The query string for one infinite-scroll page of a searchable picker: the
 * page slice plus static filters and, once the user has typed something, an
 * `iLike` filter per search field. Matches the backend `ListSpec` filter DSL
 * exactly. The clear path for "either column" searches (e.g. name OR mobile)
 * is several fields OR-joined; the clear path for "only these rows" pickers
 * (e.g. just stock-holding branches) is a single field AND-joined with static
 * filters — the backend applies one connector across all filters, so the two
 * cannot be mixed.
 */
export function buildPickerRequestParams({
  page,
  perPage,
  search,
  searchField,
  filters = [],
}: PickerRequestParams): URLSearchParams {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('perPage', String(perPage))

  const fields = Array.isArray(searchField) ? searchField : [searchField]
  const filterItems = [
    ...filters.map(({ id, value, variant, operator }) => ({
      id,
      value,
      variant,
      operator,
    })),
    ...(search
      ? fields.map((id) => ({
          id,
          value: search,
          variant: 'text',
          operator: 'iLike',
        }))
      : []),
  ]
  if (filterItems.length > 0) {
    params.set('filters', JSON.stringify(filterItems))
    if (fields.length > 1) {
      if (filters.length > 0) {
        throw new Error(
          'multi-field search cannot be OR-joined with static filters',
        )
      }
      params.set('joinOperator', 'or')
    }
  }

  return params
}

/**
 * Flattens the pages an infinite query has accumulated into a de-duplicated
 * option list, in load order. De-duping matters because a value re-picked on
 * a later page or injected from an edit form's initial value must not appear
 * twice.
 */
export function optionsFromPages<T>(
  pages: ListResponse<T>[] | undefined,
  toOption: (row: T) => AsyncComboboxOption,
): AsyncComboboxOption[] {
  const seen = new Set<string>()
  const options: AsyncComboboxOption[] = []
  for (const page of pages ?? []) {
    for (const row of page.data) {
      const option = toOption(row)
      if (seen.has(option.value)) {
        continue
      }
      seen.add(option.value)
      options.push(option)
    }
  }
  return options
}
