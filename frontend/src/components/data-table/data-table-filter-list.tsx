'use client'

import type { Column, ColumnMeta, Table } from '@tanstack/react-table'
import {
  CalendarIcon,
  Check,
  ChevronsUpDown,
  ListFilter,
  Trash2,
} from 'lucide-react'
import { parseAsStringEnum, useQueryState } from 'nuqs'
import * as React from 'react'

import { DataTableRangeFilter } from '@/components/data-table/data-table-range-filter'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Faceted,
  FacetedBadgeList,
  FacetedContent,
  FacetedEmpty,
  FacetedGroup,
  FacetedInput,
  FacetedItem,
  FacetedList,
  FacetedTrigger,
} from '@/components/ui/faceted'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { dataTableConfig } from '@/config/data-table'
import { useDebouncedInput } from '@/hooks/use-debounced-input'
import {
  getDefaultFilterOperator,
  getFilterOperators,
  getFilterValueForOperator,
} from '@/lib/data-table'
import { formatDate } from '@/lib/format'
import { generateId } from '@/lib/id'
import { useTableFilters } from '@/hooks/use-table-filters'
import { cn } from '@/lib/utils'
import type { ExtendedColumnFilter, JoinOperator } from '@/types/data-table'

const FILTER_SHORTCUT_KEY = 'f'
const REMOVE_FILTER_SHORTCUTS = ['backspace', 'delete']

type FilterUpdate<TData> = (
  filterId: string,
  updates: Partial<Omit<ExtendedColumnFilter<TData>, 'filterId'>>,
  expected?: Pick<ExtendedColumnFilter<TData>, 'id' | 'variant' | 'operator'>,
) => void

interface DataTableFilterListProps<TData> extends React.ComponentProps<
  typeof PopoverContent
> {
  table: Table<TData>
  shallow?: boolean
  disabled?: boolean
}

export function DataTableFilterList<TData>({
  table,
  shallow = true,
  disabled,
  ...props
}: DataTableFilterListProps<TData>) {
  const id = React.useId()
  const labelId = React.useId()
  const descriptionId = React.useId()
  const [open, setOpen] = React.useState(false)
  const addButtonRef = React.useRef<HTMLButtonElement>(null)
  const mounted = React.useRef(false)
  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const tableColumns = table.getAllColumns()
  const columns = React.useMemo(() => {
    return tableColumns.filter((column) => column.columnDef.enableColumnFilter)
  }, [tableColumns])

  const definitions = React.useMemo(
    () => columns.map((column) => column.columnDef),
    [columns],
  )
  const { filters, setFilters } = useTableFilters(
    definitions,
    table.options.meta?.queryKeys,
  )

  const [joinOperator, setJoinOperator] = useQueryState(
    table.options.meta?.queryKeys?.joinOperator ?? 'joinOperator',
    parseAsStringEnum(['and', 'or']).withDefault('and').withOptions({
      clearOnDefault: true,
      shallow,
    }),
  )

  const onFilterAdd = React.useCallback(() => {
    if (columns.length === 0) return

    const column = columns[0]

    void setFilters([
      ...filters,
      {
        id: column.id as Extract<keyof TData, string>,
        value: '',
        variant: column.columnDef.meta?.variant ?? 'text',
        operator: getDefaultFilterOperator(
          column.columnDef.meta?.variant ?? 'text',
        ),
        filterId: generateId({ length: 8 }),
      },
    ])
  }, [columns, filters, setFilters])

  const onFilterUpdate = React.useCallback(
    (
      filterId: string,
      updates: Partial<Omit<ExtendedColumnFilter<TData>, 'filterId'>>,
      expected?: Pick<
        ExtendedColumnFilter<TData>,
        'id' | 'variant' | 'operator'
      >,
    ) => {
      if (!mounted.current) return
      void setFilters((prevFilters) => {
        const updatedFilters = prevFilters.map((filter) => {
          if (
            filter.filterId === filterId &&
            (!expected ||
              (filter.id === expected.id &&
                filter.variant === expected.variant &&
                filter.operator === expected.operator))
          ) {
            return { ...filter, ...updates }
          }
          return filter
        })
        return updatedFilters
      })
    },
    [setFilters],
  )

  const onFilterRemove = React.useCallback(
    (filterId: string) => {
      const updatedFilters = filters.filter(
        (filter) => filter.filterId !== filterId,
      )
      void setFilters(updatedFilters)
      requestAnimationFrame(() => {
        addButtonRef.current?.focus()
      })
    },
    [filters, setFilters],
  )

  const onFiltersReset = React.useCallback(() => {
    void setFilters(null)
    void setJoinOperator('and')
  }, [setFilters, setJoinOperator])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement &&
          event.target.contentEditable === 'true')
      ) {
        return
      }

      if (
        event.key.toLowerCase() === FILTER_SHORTCUT_KEY &&
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey
      ) {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const onTriggerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (
        REMOVE_FILTER_SHORTCUTS.includes(event.key.toLowerCase()) &&
        filters.length > 0
      ) {
        event.preventDefault()
        onFilterRemove(filters[filters.length - 1]?.filterId ?? '')
      }
    },
    [filters, onFilterRemove],
  )

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              className="font-normal"
              onKeyDown={onTriggerKeyDown}
              disabled={disabled}
            />
          }
        >
          <ListFilter className="text-muted-foreground" />
          Filters
          {filters.length > 0 && (
            <Badge
              variant="secondary"
              className="h-[18.24px] rounded-[3.2px] px-[5.12px] font-mono font-normal text-[10.4px]"
            >
              {filters.length}
            </Badge>
          )}
        </PopoverTrigger>
        <PopoverContent
          aria-describedby={descriptionId}
          aria-labelledby={labelId}
          className="flex w-[min(48rem,calc(100vw-2rem))] flex-col gap-4 p-4"
          {...props}
        >
          <div className="flex flex-col gap-1">
            <h4 id={labelId} className="font-medium leading-none">
              {filters.length > 0 ? 'Filters' : 'No filters applied'}
            </h4>
            <p
              id={descriptionId}
              className={cn(
                'text-muted-foreground text-sm',
                filters.length > 0 && 'sr-only',
              )}
            >
              {filters.length > 0
                ? 'Modify filters to refine your rows.'
                : 'Add filters to refine your rows.'}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            Match
            <Select
              value={joinOperator}
              onValueChange={(value) => {
                if (value) void setJoinOperator(value)
                table.setPageIndex(0)
              }}
            >
              <SelectTrigger
                aria-label="Filter match mode"
                className="h-7 w-28 rounded-md"
              >
                <SelectValue>
                  {joinOperator === 'and' ? 'All rules' : 'Any rule'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="and">All rules</SelectItem>
                <SelectItem value="or">Any rule</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {filters.length > 0 ? (
            <div
              role="list"
              className="flex max-h-80 flex-col gap-2 overflow-y-auto p-1"
            >
              {filters.map((filter, index) => (
                <DataTableFilterItem<TData>
                  key={filter.filterId}
                  filter={filter}
                  index={index}
                  filterItemId={`${id}-filter-${filter.filterId}`}
                  joinOperator={joinOperator}
                  setJoinOperator={setJoinOperator}
                  columns={columns}
                  onFilterUpdate={onFilterUpdate}
                  onFilterRemove={onFilterRemove}
                />
              ))}
            </div>
          ) : null}
          <div className="flex w-full items-center gap-2">
            <Button
              className="rounded"
              ref={addButtonRef}
              onClick={onFilterAdd}
            >
              Add filter
            </Button>
            {filters.length > 0 ? (
              <Button
                variant="outline"
                className="rounded"
                onClick={onFiltersReset}
              >
                Reset filters
              </Button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}

interface DataTableFilterItemProps<TData> {
  filter: ExtendedColumnFilter<TData>
  index: number
  filterItemId: string
  joinOperator: JoinOperator
  setJoinOperator: (value: JoinOperator) => void
  columns: Column<TData>[]
  onFilterUpdate: FilterUpdate<TData>
  onFilterRemove: (filterId: string) => void
}

function DataTableFilterItem<TData>({
  filter,
  index,
  filterItemId,
  joinOperator,
  setJoinOperator,
  columns,
  onFilterUpdate,
  onFilterRemove,
}: DataTableFilterItemProps<TData>) {
  const [showFieldSelector, setShowFieldSelector] = React.useState(false)
  const [showOperatorSelector, setShowOperatorSelector] = React.useState(false)
  const [showValueSelector, setShowValueSelector] = React.useState(false)

  const column = columns.find((col) => col.id === filter.id)

  const joinOperatorListboxId = `${filterItemId}-join-operator-listbox`
  const fieldListboxId = `${filterItemId}-field-listbox`
  const operatorListboxId = `${filterItemId}-operator-listbox`
  const inputId = `${filterItemId}-input`

  const columnMeta = column?.columnDef.meta
  const filterOperators = getFilterOperators(filter.variant).filter(
    (operator) => operator.value !== 'isRelativeToToday',
  )

  const onItemKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return
      }

      if (showFieldSelector || showOperatorSelector || showValueSelector) {
        return
      }

      if (REMOVE_FILTER_SHORTCUTS.includes(event.key.toLowerCase())) {
        event.preventDefault()
        onFilterRemove(filter.filterId)
      }
    },
    [
      filter.filterId,
      showFieldSelector,
      showOperatorSelector,
      showValueSelector,
      onFilterRemove,
    ],
  )

  if (!column) return null

  return (
    <div
      role="listitem"
      id={filterItemId}
      tabIndex={-1}
      className="flex flex-wrap items-center gap-2"
      onKeyDown={onItemKeyDown}
    >
      <div className="min-w-[72px] text-center">
        {index === 0 ? (
          <span className="text-muted-foreground text-sm">Where</span>
        ) : index === 1 ? (
          <Select
            value={joinOperator}
            onValueChange={(value) => {
              if (value) setJoinOperator(value)
            }}
          >
            <SelectTrigger
              aria-label="Select join operator"
              aria-controls={joinOperatorListboxId}
              className="rounded lowercase"
            >
              <SelectValue placeholder={joinOperator} />
            </SelectTrigger>
            <SelectContent
              id={joinOperatorListboxId}

              className="lowercase"
            >
              <SelectGroup>
                {dataTableConfig.joinOperators.map((op) => (
                  <SelectItem key={op} value={op}>
                    {op}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : (
          <span className="text-muted-foreground text-sm">{joinOperator}</span>
        )}
      </div>
      <Popover open={showFieldSelector} onOpenChange={setShowFieldSelector}>
        <PopoverTrigger
          render={
            <Button
              aria-controls={fieldListboxId}
              variant="outline"
              className="w-32 justify-between rounded font-normal"
            />
          }
        >
          <span className="truncate">
            {columns.find((col) => col.id === filter.id)?.columnDef.meta
              ?.label ?? 'Select field'}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </PopoverTrigger>
        <PopoverContent id={fieldListboxId} align="start" className="w-40 p-0">
          <Command>
            <CommandInput placeholder="Search fields..." />
            <CommandList>
              <CommandEmpty>No fields found.</CommandEmpty>
              <CommandGroup>
                {columns.map((col) => (
                  <CommandItem
                    key={col.id}
                    value={col.id}
                    onSelect={(value) => {
                      onFilterUpdate(filter.filterId, {
                        id: value as Extract<keyof TData, string>,
                        variant: col.columnDef.meta?.variant ?? 'text',
                        operator: getDefaultFilterOperator(
                          col.columnDef.meta?.variant ?? 'text',
                        ),
                        value: '',
                      })

                      setShowFieldSelector(false)
                    }}
                  >
                    <span className="truncate">
                      {col.columnDef.meta?.label}
                    </span>
                    <Check
                      className={cn(
                        'ms-auto',
                        col.id === filter.id ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Select
        open={showOperatorSelector}
        onOpenChange={setShowOperatorSelector}
        value={filter.operator}
        onValueChange={(value) =>
          value &&
          onFilterUpdate(filter.filterId, {
            operator: value,
            value: getFilterValueForOperator(filter.value, value),
          })
        }
      >
        <SelectTrigger
          aria-label="Filter operator"
          aria-controls={operatorListboxId}
          className="w-48 rounded lowercase"
        >
          <div className="truncate">
            <SelectValue>
              {filterOperators.find((entry) => entry.value === filter.operator)
                ?.label ?? filter.operator}
            </SelectValue>
          </div>
        </SelectTrigger>
        <SelectContent id={operatorListboxId}>
          <SelectGroup>
            {filterOperators.map((operator) => (
              <SelectItem
                key={operator.value}
                value={operator.value}
                className="lowercase"
              >
                {operator.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <div className="min-w-36 max-w-60 flex-1">
        {onFilterInputRender({
          filter,
          inputId,
          column,
          columnMeta,
          // A closing input must not overwrite a newly selected field/operator.
          onFilterUpdate: (filterId, updates) =>
            onFilterUpdate(filterId, updates, filter),
          showValueSelector,
          setShowValueSelector,
        })}
      </div>
      <Button
        aria-label={`Remove ${columnMeta?.label ?? column.id} rule`}
        aria-controls={filterItemId}
        variant="outline"
        size="icon"
        className="size-8 rounded"
        onClick={() => onFilterRemove(filter.filterId)}
      >
        <Trash2 />
      </Button>
    </div>
  )
}

function onFilterInputRender<TData>({
  filter,
  inputId,
  column,
  columnMeta,
  onFilterUpdate,
  showValueSelector,
  setShowValueSelector,
}: {
  filter: ExtendedColumnFilter<TData>
  inputId: string
  column: Column<TData>
  columnMeta?: ColumnMeta<TData, unknown>
  onFilterUpdate: (
    filterId: string,
    updates: Partial<Omit<ExtendedColumnFilter<TData>, 'filterId'>>,
  ) => void
  showValueSelector: boolean
  setShowValueSelector: (value: boolean) => void
}) {
  if (filter.operator === 'isEmpty' || filter.operator === 'isNotEmpty') {
    return (
      <div
        id={inputId}
        role="status"
        aria-label={`${columnMeta?.label} filter is ${
          filter.operator === 'isEmpty' ? 'empty' : 'not empty'
        }`}
        aria-live="polite"
        className="h-8 w-full rounded border bg-transparent dark:bg-input/30"
      />
    )
  }

  switch (filter.variant) {
    case 'text':
    case 'number':
    case 'range': {
      if (
        (filter.variant === 'range' && filter.operator === 'isBetween') ||
        filter.operator === 'isBetween'
      ) {
        return (
          <DataTableRangeFilter
            key={`${filter.filterId}:${filter.id}:${filter.operator}`}
            filter={filter}
            column={column}
            inputId={inputId}
            onFilterUpdate={onFilterUpdate}
          />
        )
      }

      const isNumber = filter.variant === 'number' || filter.variant === 'range'

      return (
        <FilterTextInput
          key={`${filter.filterId}:${filter.id}:${filter.operator}`}
          id={inputId}
          type={isNumber ? 'number' : filter.variant}
          aria-label={`${columnMeta?.label} filter value`}
          aria-describedby={`${inputId}-description`}
          inputMode={isNumber ? 'numeric' : undefined}
          placeholder={columnMeta?.placeholder ?? 'Enter a value...'}
          className="h-8 w-full rounded"
          value={typeof filter.value === 'string' ? filter.value : ''}
          onValueChange={(value) => onFilterUpdate(filter.filterId, { value })}
        />
      )
    }

    case 'boolean': {
      if (Array.isArray(filter.value)) return null

      const inputListboxId = `${inputId}-listbox`

      return (
        <Select
          open={showValueSelector}
          onOpenChange={setShowValueSelector}
          value={filter.value}
          onValueChange={(value) =>
            onFilterUpdate(filter.filterId, {
              value: value ?? '',
            })
          }
        >
          <SelectTrigger
            id={inputId}
            aria-controls={inputListboxId}
            aria-label={`${columnMeta?.label} boolean filter`}
            className="w-full rounded"
          >
            <SelectValue placeholder={filter.value ? 'True' : 'False'} />
          </SelectTrigger>
          <SelectContent id={inputListboxId}>
            <SelectGroup>
              <SelectItem value="true">True</SelectItem>
              <SelectItem value="false">False</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      )
    }

    case 'select':
    case 'multiSelect': {
      const inputListboxId = `${inputId}-listbox`

      const multiple = filter.variant === 'multiSelect'
      const selectedValues = multiple
        ? Array.isArray(filter.value)
          ? filter.value
          : []
        : typeof filter.value === 'string'
          ? filter.value
          : undefined

      return (
        <Faceted
          open={showValueSelector}
          onOpenChange={setShowValueSelector}
          value={selectedValues}
          onValueChange={(value) => {
            onFilterUpdate(filter.filterId, {
              value: value ?? '',
            })
          }}
          multiple={multiple}
        >
          <FacetedTrigger
            render={
              <Button
                id={inputId}
                aria-controls={inputListboxId}
                aria-label={`${columnMeta?.label} filter value${multiple ? 's' : ''}`}
                variant="outline"
                className="w-full rounded font-normal"
              />
            }
          >
            <FacetedBadgeList
              options={columnMeta?.options}
              placeholder={
                columnMeta?.placeholder ??
                `Select option${multiple ? 's' : ''}...`
              }
            />
          </FacetedTrigger>
          <FacetedContent id={inputListboxId} className="w-[200px]">
            <FacetedInput
              aria-label={`Search ${columnMeta?.label} options`}
              placeholder={columnMeta?.placeholder ?? 'Search options...'}
            />
            <FacetedList>
              <FacetedEmpty>No options found.</FacetedEmpty>
              <FacetedGroup>
                {columnMeta?.options?.map((option) => (
                  <FacetedItem key={option.value} value={option.value}>
                    {option.icon && <option.icon />}
                    <span>{option.label}</span>
                    {option.count && (
                      <span className="ms-auto font-mono text-xs">
                        {option.count}
                      </span>
                    )}
                  </FacetedItem>
                ))}
              </FacetedGroup>
            </FacetedList>
          </FacetedContent>
        </Faceted>
      )
    }

    case 'date':
    case 'dateRange': {
      const inputListboxId = `${inputId}-listbox`

      const dateValue = Array.isArray(filter.value)
        ? filter.value.filter(Boolean)
        : [filter.value, filter.value].filter(Boolean)

      const startDate = dateValue[0]
        ? new Date(Number(dateValue[0]))
        : undefined
      const endDate = dateValue[1] ? new Date(Number(dateValue[1])) : undefined

      const isSameDate =
        startDate &&
        endDate &&
        startDate.toDateString() === endDate.toDateString()

      const displayValue =
        filter.operator === 'isBetween' && dateValue.length === 2 && !isSameDate
          ? `${formatDate(startDate, { month: 'short' })} - ${formatDate(endDate, { month: 'short' })}`
          : startDate
            ? formatDate(startDate, { month: 'short' })
            : 'Pick a date'

      return (
        <Popover open={showValueSelector} onOpenChange={setShowValueSelector}>
          <PopoverTrigger
            render={
              <Button
                id={inputId}
                aria-controls={inputListboxId}
                aria-label={`${columnMeta?.label} date filter`}
                variant="outline"
                className={cn(
                  'w-full justify-start rounded text-start font-normal',
                  !filter.value && 'text-muted-foreground',
                )}
              />
            }
          >
            <CalendarIcon />
            <span className="truncate">{displayValue}</span>
          </PopoverTrigger>
          <PopoverContent
            id={inputListboxId}
            align="start"
            className="w-auto p-0"
          >
            {filter.operator === 'isBetween' ? (
              <Calendar
                aria-label={`Select ${columnMeta?.label} date range`}
                autoFocus
                captionLayout="dropdown"
                mode="range"
                selected={
                  dateValue.length === 2
                    ? {
                        from: new Date(Number(dateValue[0])),
                        to: new Date(Number(dateValue[1])),
                      }
                    : {
                        from: new Date(),
                        to: new Date(),
                      }
                }
                onSelect={(date) => {
                  onFilterUpdate(filter.filterId, {
                    value: date
                      ? [
                          (date.from?.getTime() ?? '').toString(),
                          (date.to?.getTime() ?? '').toString(),
                        ]
                      : [],
                  })
                }}
              />
            ) : (
              <Calendar
                aria-label={`Select ${columnMeta?.label} date`}
                autoFocus
                captionLayout="dropdown"
                mode="single"
                selected={
                  dateValue[0] ? new Date(Number(dateValue[0])) : undefined
                }
                onSelect={(date) => {
                  onFilterUpdate(filter.filterId, {
                    value: (date?.getTime() ?? '').toString(),
                  })
                  setShowValueSelector(false)
                }}
              />
            )}
          </PopoverContent>
        </Popover>
      )
    }

    default:
      return null
  }
}

function FilterTextInput({
  value,
  onValueChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
}) {
  const { draft, change, flush } = useDebouncedInput(value, onValueChange)
  return (
    <Input
      {...props}
      value={draft}
      onChange={(event) => change(event.target.value)}
      onBlur={flush}
    />
  )
}
