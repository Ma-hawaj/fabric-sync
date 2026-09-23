import * as React from 'react'
import { Loader2Icon } from 'lucide-react'

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { PICKER_PER_PAGE, optionsFromPages } from '@/lib/async-combobox'
import type {
  AsyncComboboxOption,
  PickerFilter,
  SearchField,
} from '@/lib/async-combobox'
import { useInfiniteListQuery } from '@/hooks/use-infinite-list-query'

/** How long a keystroke is left alone before it becomes a server search. */
const SEARCH_DEBOUNCE_MS = 250

interface AsyncComboboxProps<T> {
  /** Endpoint path, e.g. `/customers`. */
  endpoint: string
  /** Query key prefix — distinct from the matching table's list key. */
  queryKey: string
  /** The `ListSpec` column(s) the search text filters on, e.g. `name`. */
  searchField: SearchField
  /** Static filters attached to every request, e.g. only stock-holding rows. */
  filters?: readonly PickerFilter[]
  /** Maps one loaded row to the option list entry. */
  toOption: (row: T) => AsyncComboboxOption
  /** The selected id, or `null` when nothing is chosen. */
  value: string | null
  onValueChange: (value: string | null) => void
  /** Called with the underlying row whenever the selection changes (or is cleared). */
  onSelectRow?: (row: T | null) => void
  /** Resolves the label for a stored value whose row isn't loaded yet (edit forms). */
  getValueLabel?: (value: string) => string | null
  perPage?: number
  id?: string
  placeholder?: string
  emptyMessage?: string
  disabled?: boolean
}

/**
 * A combobox whose options are paginated and searched on the server instead of
 * downloaded whole: typing debounces into an `iLike` filter and scrolling to
 * the bottom of the list pages through with `useInfiniteListQuery`.
 *
 * The current selection is re-injected on top of the loaded rows so a stored
 * value stays label-able even when its row is not on any loaded page. While the
 * user is typing, that injection is dropped so the list reflects only matches.
 */
export function AsyncCombobox<T>({
  endpoint,
  queryKey,
  searchField,
  filters,
  toOption,
  value,
  onValueChange,
  onSelectRow,
  getValueLabel,
  perPage = PICKER_PER_PAGE,
  id,
  placeholder,
  emptyMessage = 'No matches found.',
  disabled = false,
}: AsyncComboboxProps<T>) {
  const [search, setSearch] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')

  React.useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(search),
      SEARCH_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [search])

  // A fresh infinite query (page 1) per search text; pages accumulate after.
  const infinite = useInfiniteListQuery<T>({
    queryKey,
    endpoint,
    searchField,
    filters,
    search: debouncedSearch,
    perPage,
  })

  const rows = optionsFromPages(infinite.data?.pages, toOption)

  // Raw rows by option value, so a `onSelectRow` consumer can read fields off
  // the chosen row (measurements, stock, unit price) that the flattened option
  // list doesn't carry.
  const rowByValue = React.useMemo(() => {
    const map = new Map<string, T>()
    for (const page of infinite.data?.pages ?? []) {
      for (const row of page.data) {
        const option = toOption(row)
        if (!map.has(option.value)) {
          map.set(option.value, row)
        }
      }
    }
    return map
  }, [infinite.data?.pages, toOption])

  const selectedOption = React.useMemo(() => {
    const loaded = rows.find((option) => option.value === value)
    if (loaded) {
      return loaded
    }
    if (value == null) {
      return null
    }
    const label = getValueLabel?.(value)
    return label ? { value, label } : null
  }, [rows, value, getValueLabel])

  // Trim for `options` so the rendered `filteredItems` drives `data-empty`.
  const options = React.useMemo(() => {
    if (search.trim() !== '') {
      return rows
    }
    if (!selectedOption) {
      return rows
    }
    if (rows.some((option) => option.value === selectedOption.value)) {
      return rows
    }
    return [selectedOption, ...rows]
  }, [rows, selectedOption, search])

  const listRef = React.useRef<HTMLElement | null>(null)

  // Flipping the search after a selection or a dismissed popup drops the
  // now-stale filter (selection clears it; closing without one keeps the list
  // fresh for the next open). Only the input's own text survives either way,
  // because with an uncontrolled `inputValue` Base UI renders the label.
  const resetSearch = React.useCallback(() => setSearch(''), [])

  const handleInputValueChange = React.useCallback((input: string) => {
    setSearch(input)
  }, [])

  const handleValueChange = React.useCallback(
    (option: AsyncComboboxOption | null) => {
      const next = option ? option.value : null
      onValueChange(next)
      if (onSelectRow) {
        onSelectRow(next ? (rowByValue.get(next) ?? null) : null)
      }
      setSearch('')
    },
    [onValueChange, onSelectRow, rowByValue],
  )

  // Load the next page when the sentinel at the bottom of the list scrolls into
  // view. The list is a clipping scroll container, so a "visible" sentinel is
  // one the user has actually scrolled to.
  React.useEffect(() => {
    const node = listRef.current
    if (!node) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          infinite.hasNextPage &&
          !infinite.isFetchingNextPage
        ) {
          infinite.fetchNextPage()
        }
      },
      { rootMargin: '120px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [
    infinite.hasNextPage,
    infinite.isFetchingNextPage,
    infinite.fetchNextPage,
  ])

  // New search text restarts the list, so a scrolled-down popup must jump back
  // to the top rather than show a window into the stale results.
  React.useEffect(() => {
    const node = listRef.current
    if (node) {
      node.scrollTop = 0
    }
  }, [debouncedSearch])

  const loading =
    (infinite.isPending || infinite.isFetching) && !infinite.isFetchingNextPage

  return (
    <Combobox
      items={options}
      filteredItems={options}
      value={selectedOption}
      defaultInputValue=""
      onValueChange={handleValueChange}
      isItemEqualToValue={(a, b) => a.value === b.value}
      onInputValueChange={handleInputValueChange}
      onOpenChange={(open) => {
        if (!open) {
          resetSearch()
        }
      }}
    >
      <ComboboxInput
        id={id}
        placeholder={placeholder}
        showClear={value != null && !disabled}
        disabled={disabled}
      />
      <ComboboxContent alignOffset={0}>
        <ComboboxList>
          {loading && (
            <div className="flex min-h-14 items-center justify-center text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
            </div>
          )}
          {!loading &&
            options.map((option) => (
              <ComboboxItem key={option.value} value={option}>
                <span className="truncate">{option.label}</span>
              </ComboboxItem>
            ))}
          <div
            className="min-h-px"
            ref={(node) => {
              listRef.current = node
            }}
          />
          {infinite.isFetchingNextPage && (
            <div className="flex justify-center py-2 text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
            </div>
          )}
        </ComboboxList>
        {!loading && <ComboboxEmpty>{emptyMessage}</ComboboxEmpty>}
      </ComboboxContent>
    </Combobox>
  )
}
