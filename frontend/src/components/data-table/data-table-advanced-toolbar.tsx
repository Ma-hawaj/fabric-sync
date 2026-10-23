'use client'

import * as React from 'react'
import { useState } from 'react'
import type { DataTableColumnId, DataTableInstance } from '@/types/data-table'
import type { Column, ColumnDef, Table } from '@tanstack/react-table'
import { SearchIcon, XIcon } from 'lucide-react'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { DataTableFilterList } from './data-table-filter-list'
import { DataTableViewOptions } from './data-table-view-options'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTableFilters } from '@/hooks/use-table-filters'
import { useDebouncedCallback } from '@/hooks/use-debounced-callback'
import { getDefaultFilterOperator, getFilterOperators } from '@/lib/data-table'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import { parseFilterDate } from '@/lib/filter-date'

interface DataTableAdvancedToolbarProps<TData, TColumnId extends string> {
  table: Table<TData>
  className?: string
  defaultSearchColumnId?: TColumnId
  quickFilter?: { columnId: TColumnId; allLabel: string }
}

export function DataTableAdvancedToolbar<
  TData,
  TColumns extends ColumnDef<TData, any>[],
>(
  props: DataTableAdvancedToolbarProps<
    TData,
    NoInfer<DataTableColumnId<TColumns>>
  > & { table: DataTableInstance<TData, TColumns> },
): React.JSX.Element
export function DataTableAdvancedToolbar<TData>({
  table,
  className,
  defaultSearchColumnId,
  quickFilter,
}: DataTableAdvancedToolbarProps<TData, string>) {
  const tableColumns = table.getAllColumns()
  const definitions = React.useMemo(
    () => tableColumns.map((column) => column.columnDef),
    [tableColumns],
  )
  const { filters, validFilters, setFilters } = useTableFilters(
    definitions,
    table.options.meta?.queryKeys,
  )
  const searchColumns = table
    .getAllColumns()
    .filter(
      (column) =>
        column.getCanFilter() &&
        ['text', 'number'].includes(column.columnDef.meta?.variant ?? ''),
    )
  const [searchId, setSearchId] = useState(
    () =>
      searchColumns.find((column) => column.id === defaultSearchColumnId)?.id ??
      searchColumns.at(0)?.id ??
      '',
  )
  const searchColumn = searchId ? table.getColumn(searchId) : undefined
  const variant = searchColumn?.columnDef.meta?.variant ?? 'text'
  const operator = getDefaultFilterOperator(variant)
  const searchFilter = filters.find(
    (filter) => filter.id === searchId && filter.operator === operator,
  )
  const searchValue =
    typeof searchFilter?.value === 'string' ? searchFilter.value : ''
  const [draft, setDraft] = useState(searchValue)
  React.useEffect(() => setDraft(searchValue), [searchValue, searchId])
  const updateSearch = useDebouncedCallback((id: string, value: string) => {
    const column = table.getColumn(id)
    const fieldVariant = column?.columnDef.meta?.variant ?? 'text'
    const fieldOperator = getDefaultFilterOperator(fieldVariant)
    void setFilters((previous) => [
      ...previous.filter(
        (filter) => !(filter.id === id && filter.operator === fieldOperator),
      ),
      ...(value
        ? [
            {
              id: id as Extract<keyof TData, string>,
              value,
              variant: fieldVariant,
              operator: fieldOperator,
              filterId: `quick:${id}`,
            },
          ]
        : []),
    ])
  }, 300)
  const quickFilterColumn = table
    .getAllColumns()
    .find(
      (column) =>
        column.id === quickFilter?.columnId &&
        column.getCanFilter() &&
        column.columnDef.meta?.options?.length,
    )
  const quickFilterRule = filters.find(
    (filter) => filter.id === quickFilterColumn?.id,
  )
  const quickFilterValue = !quickFilterRule
    ? 'all'
    : quickFilterRule.operator !==
        getDefaultFilterOperator(
          quickFilterColumn?.columnDef.meta?.variant ?? 'multiSelect',
        )
      ? 'custom'
      : Array.isArray(quickFilterRule.value)
        ? quickFilterRule.value.length === 1
          ? quickFilterRule.value[0]
          : 'custom'
        : quickFilterRule.value
  const [join] = useQueryState(
    table.options.meta?.queryKeys?.joinOperator ?? 'joinOperator',
    parseAsStringLiteral(['and', 'or']).withDefault('and'),
  )

  function filterLabel(
    column: Column<TData> | undefined,
    value: string | string[],
  ) {
    return (Array.isArray(value) ? value : [value])
      .map(
        (entry) =>
          column?.columnDef.meta?.options?.find(
            (option) => option.value === entry,
          )?.label ?? entry,
      )
      .join(', ')
  }

  return (
    <div className={cn('shrink-0 space-y-2 border-b p-3', className)}>
      <div
        role="toolbar"
        aria-label="Table tools"
        className="flex flex-wrap items-center gap-2"
      >
        {searchColumns.length > 0 && (
          <div className="flex min-w-0 basis-full items-center gap-2 sm:max-w-md sm:flex-1 sm:basis-auto">
            <Select
              value={searchId}
              onValueChange={(value) => {
                if (value) {
                  updateSearch.cancel()
                  setSearchId(value)
                }
              }}
            >
              <SelectTrigger
                aria-label="Search field"
                className="h-8 w-36 shrink-0"
              >
                <SelectValue>
                  {searchColumn?.columnDef.meta?.label ?? searchId}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {searchColumns.map((column) => (
                  <SelectItem key={column.id} value={column.id}>
                    {column.columnDef.meta?.label ?? column.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute start-2.5 top-2 size-4 text-muted-foreground" />
              <Input
                aria-label={`Search ${searchColumn?.columnDef.meta?.label ?? searchId}`}
                placeholder={
                  searchColumn?.columnDef.meta?.placeholder ??
                  'Search records...'
                }
                value={draft}
                inputMode={variant === 'number' ? 'numeric' : undefined}
                className="h-8 ps-8"
                onChange={(event) => {
                  setDraft(event.target.value)
                  updateSearch(searchId, event.target.value)
                }}
              />
            </div>
          </div>
        )}
        {quickFilterColumn && (
          <Select
            value={quickFilterValue}
            onValueChange={(value) => {
              if (!value) return
              const meta = quickFilterColumn.columnDef.meta!
              void setFilters((previous) => [
                ...previous.filter(
                  (filter) => filter.id !== quickFilterColumn.id,
                ),
                ...(value === 'all'
                  ? []
                  : [
                      {
                        id: quickFilterColumn.id as Extract<
                          keyof TData,
                          string
                        >,
                        value: meta.variant === 'multiSelect' ? [value] : value,
                        variant: meta.variant!,
                        operator: getDefaultFilterOperator(meta.variant!),
                        filterId: `quick:${quickFilterColumn.id}`,
                      },
                    ]),
              ])
            }}
          >
            <SelectTrigger
              aria-label={`Quick ${quickFilterColumn.columnDef.meta?.label} filter`}
              className="h-8 w-32 sm:w-36"
            >
              <SelectValue>
                {quickFilterColumn.columnDef.meta?.options?.find(
                  (option) => option.value === quickFilterValue,
                )?.label ??
                  (quickFilterValue === 'custom'
                    ? 'Custom rules'
                    : quickFilter?.allLabel)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {quickFilterValue === 'custom' && (
                <SelectItem value="custom" disabled>
                  Custom rules
                </SelectItem>
              )}
              <SelectItem value="all">{quickFilter?.allLabel}</SelectItem>
              {quickFilterColumn.columnDef.meta?.options?.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DataTableFilterList table={table} align="start" />
        <div className="ms-auto">
          <DataTableViewOptions table={table} align="end" />
        </div>
      </div>
      {validFilters.length > 0 && (
        <div
          className="flex items-center gap-1.5 overflow-x-auto"
          aria-label="Active filters"
        >
          <span className="shrink-0 text-xs text-muted-foreground">
            Match {join === 'and' ? 'all' : 'any'}
          </span>
          {validFilters.map((filter) => {
            const column = table.getColumn(filter.id)
            const label = column?.columnDef.meta?.label ?? filter.id
            const operation =
              getFilterOperators(filter.variant).find(
                (entry) => entry.value === filter.operator,
              )?.label ?? filter.operator
            return (
              <Button
                key={filter.filterId}
                variant="secondary"
                size="xs"
                className="max-w-64 shrink-0"
                aria-label={`Remove ${label} filter`}
                onClick={() => {
                  updateSearch.cancel()
                  void setFilters((previous) =>
                    previous.filter(
                      (entry) => entry.filterId !== filter.filterId,
                    ),
                  )
                }}
              >
                <span className="truncate">
                  {label} {operation.toLowerCase()}{' '}
                  {['date', 'dateRange'].includes(filter.variant)
                    ? (Array.isArray(filter.value)
                        ? filter.value
                        : [filter.value]
                      )
                        .filter(Boolean)
                        .map((value) =>
                          formatDate(parseFilterDate(value), {
                            month: 'short',
                          }),
                        )
                        .join(' – ')
                    : filterLabel(column, filter.value)}
                </span>
                <XIcon />
              </Button>
            )
          })}
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0"
            onClick={() => {
              updateSearch.cancel()
              void setFilters([])
            }}
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  )
}
