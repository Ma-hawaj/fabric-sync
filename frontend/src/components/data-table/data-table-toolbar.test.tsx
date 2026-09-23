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
import type { ColumnDef } from '@tanstack/react-table'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'

interface Row {
  name: string
}

const columns: ColumnDef<Row>[] = [
  {
    accessorKey: 'name',
    enableColumnFilter: true,
    meta: { label: 'Name', placeholder: 'Filter name...', variant: 'text' },
  },
  { id: 'actions', enablePinning: true },
]

function ToolbarHarness() {
  const table = useReactTable({
    data: [],
    columns,
    state: { columnFilters: [] },
    onColumnFiltersChange: vi.fn(),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getFacetedMinMaxValues: getFacetedMinMaxValues(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return <DataTableToolbar table={table} />
}

describe('DataTableToolbar text filter', () => {
  it('shows each keystroke immediately rather than dropping it', () => {
    render(<ToolbarHarness />)

    const input =
      screen.getByPlaceholderText<HTMLInputElement>('Filter name...')

    // A controlled input fed straight from `column.getFilterValue()` would
    // drop these keystrokes, because that value only moves once the debounced
    // URL write lands. The draft keeps the box responsive in the gap.
    fireEvent.change(input, { target: { value: 'W' } })
    fireEvent.change(input, { target: { value: 'Woo' } })

    expect(input.value).toBe('Woo')
  })
})
