'use client'

import type { Column } from '@tanstack/react-table'
import * as React from 'react'

import { Input } from '@/components/ui/input'
import { useDebouncedInput } from '@/hooks/use-debounced-input'
import { cn } from '@/lib/utils'
import type { ExtendedColumnFilter } from '@/types/data-table'

interface DataTableRangeFilterProps<TData> extends React.ComponentProps<'div'> {
  filter: ExtendedColumnFilter<TData>
  column: Column<TData>
  inputId: string
  onFilterUpdate: (
    filterId: string,
    updates: Partial<Omit<ExtendedColumnFilter<TData>, 'filterId'>>,
  ) => void
}

export function DataTableRangeFilter<TData>({
  filter,
  column,
  inputId,
  onFilterUpdate,
  className,
  ...props
}: DataTableRangeFilterProps<TData>) {
  const meta = column.columnDef.meta

  // Loaded rows are only one page of a server-filtered dataset, not its bounds.
  const [min, max] = meta?.range ?? []
  const value = React.useMemo<[string, string]>(
    () =>
      Array.isArray(filter.value)
        ? [filter.value[0] ?? '', filter.value[1] ?? '']
        : [filter.value, ''],
    [filter.value],
  )
  const { draft, change, flush } = useDebouncedInput(value, (next) =>
    onFilterUpdate(filter.filterId, { value: next }),
  )

  const onRangeValueChange = (inputValue: string, isMin?: boolean) => {
    const numValue = Number(inputValue)

    if (
      inputValue === '' ||
      (Number.isFinite(numValue) &&
        (min === undefined || numValue >= min) &&
        (max === undefined || numValue <= max))
    ) {
      change((previous) =>
        isMin ? [inputValue, previous[1]] : [previous[0], inputValue],
      )
    }
  }

  return (
    <div
      data-slot="range"
      className={cn('flex w-full items-center gap-2', className)}
      {...props}
    >
      <Input
        id={`${inputId}-min`}
        type="number"
        step="any"
        aria-label={`${meta?.label} minimum value`}
        aria-valuemin={min}
        aria-valuemax={max}
        data-slot="range-min"
        inputMode="numeric"
        placeholder={min?.toString() ?? 'Min'}
        min={min}
        max={max}
        className="h-8 w-full rounded"
        value={draft[0]}
        onChange={(event) => onRangeValueChange(event.target.value, true)}
        onBlur={flush}
      />
      <span className="sr-only shrink-0 text-muted-foreground">to</span>
      <Input
        id={`${inputId}-max`}
        type="number"
        step="any"
        aria-label={`${meta?.label} maximum value`}
        aria-valuemin={min}
        aria-valuemax={max}
        data-slot="range-max"
        inputMode="numeric"
        placeholder={max?.toString() ?? 'Max'}
        min={min}
        max={max}
        className="h-8 w-full rounded"
        value={draft[1]}
        onChange={(event) => onRangeValueChange(event.target.value)}
        onBlur={flush}
      />
    </div>
  )
}
