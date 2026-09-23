'use client'

import type { Column, Table } from '@tanstack/react-table'
import { X } from 'lucide-react'
import * as React from 'react'

import { DataTableDateFilter } from '@/components/data-table/data-table-date-filter'
import { DataTableFacetedFilter } from '@/components/data-table/data-table-faceted-filter'
import { DataTableSliderFilter } from '@/components/data-table/data-table-slider-filter'
import { DataTableViewOptions } from '@/components/data-table/data-table-view-options'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface DataTableToolbarProps<TData> extends React.ComponentProps<'div'> {
  table: Table<TData>
}

export function DataTableToolbar<TData>({
  table,
  children,
  className,
  ...props
}: DataTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0

  const columns = React.useMemo(
    () => table.getAllColumns().filter((column) => column.getCanFilter()),
    [table],
  )

  const onReset = React.useCallback(() => {
    table.resetColumnFilters()
  }, [table])

  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      className={cn(
        'flex w-full items-start justify-between gap-2 p-1',
        className,
      )}
      {...props}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {columns.map((column) => (
          <DataTableToolbarFilter key={column.id} column={column} />
        ))}
        {isFiltered && (
          <Button
            aria-label="Reset filters"
            variant="outline"
            className="border-dashed"
            onClick={onReset}
          >
            <X />
            Reset
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {children}
        <DataTableViewOptions table={table} align="end" />
      </div>
    </div>
  )
}
interface DataTableToolbarFilterProps<TData> {
  column: Column<TData>
}

function DataTableTextFilter<TData>({
  column,
  placeholder,
  type = 'text',
  unit,
}: {
  column: Column<TData>
  placeholder: string
  type?: 'text' | 'number'
  unit?: string
}) {
  // The column's value only changes once the debounced URL write lands, so a
  // value fed straight from `column.getFilterValue()` would drop every
  // keystroke. Keep a local draft for instant feedback and push each change
  // into the column; the URL round-trip then only has to catch up. The effect
  // syncs external changes back (Reset, browser back/forward) but not the
  // user's own keystrokes, since those don't move `getFilterValue()` until the
  // debounce lands.
  const [draft, setDraft] = React.useState(() => {
    return (column.getFilterValue() as string | undefined) ?? ''
  })

  const columnValue = (column.getFilterValue() as string | undefined) ?? ''

  React.useEffect(() => {
    setDraft(columnValue)
  }, [columnValue])

  const onDraftChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value
    setDraft(next)
    column.setFilterValue(next)
  }

  const input = (
    <Input
      type={type}
      inputMode={type === 'number' ? 'numeric' : undefined}
      placeholder={placeholder}
      value={draft}
      onChange={onDraftChange}
      className={cn(
        'h-8',
        type === 'number' ? 'w-[120px]' : 'w-40 lg:w-56',
        unit && 'pe-8',
      )}
    />
  )

  if (!unit) return input

  return (
    <div className="relative">
      {input}
      <span className="absolute top-0 end-0 bottom-0 flex items-center rounded-e-md bg-accent px-2 text-muted-foreground text-sm">
        {unit}
      </span>
    </div>
  )
}

function DataTableToolbarFilter<TData>({
  column,
}: DataTableToolbarFilterProps<TData>) {
  {
    const columnMeta = column.columnDef.meta

    const onFilterRender = React.useCallback(() => {
      if (!columnMeta?.variant) return null

      switch (columnMeta.variant) {
        case 'text':
          return (
            <DataTableTextFilter
              column={column}
              placeholder={columnMeta.placeholder ?? columnMeta.label}
            />
          )

        case 'number':
          return (
            <DataTableTextFilter
              column={column}
              type="number"
              placeholder={columnMeta.placeholder ?? columnMeta.label}
              unit={columnMeta.unit}
            />
          )

        case 'range':
          return (
            <DataTableSliderFilter
              column={column}
              title={columnMeta.label ?? column.id}
            />
          )

        case 'date':
        case 'dateRange':
          return (
            <DataTableDateFilter
              column={column}
              title={columnMeta.label ?? column.id}
              multiple={columnMeta.variant === 'dateRange'}
            />
          )

        case 'select':
        case 'multiSelect':
          return (
            <DataTableFacetedFilter
              column={column}
              title={columnMeta.label ?? column.id}
              options={columnMeta.options ?? []}
              multiple={columnMeta.variant === 'multiSelect'}
            />
          )

        default:
          return null
      }
    }, [column, columnMeta])

    return onFilterRender()
  }
}
