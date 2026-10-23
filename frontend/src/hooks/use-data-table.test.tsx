import type { ColumnDef } from '@tanstack/react-table'
import { act, renderHook, waitFor } from '@testing-library/react'
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing'
import { describe, expect, it } from 'vitest'

import { useDataTable } from './use-data-table'

interface Record {
  name: string
  score: number
}

const columns: ColumnDef<Record>[] = [
  {
    accessorKey: 'name',
    enableColumnFilter: true,
    meta: { label: 'Title', variant: 'text' },
  },
  { accessorKey: 'score', size: 90, minSize: 40 },
  { id: 'actions', header: 'Tools' },
]
const data: Record[] = Array.from({ length: 60 }, (_, index) => ({
  name: `Record ${String(index).padStart(2, '0')}`,
  score: index,
}))

describe('useDataTable configuration', () => {
  it('honors caller widths, labels, and pinning without interpreting column IDs', () => {
    const { result } = renderHook(
      () =>
        useDataTable({
          data,
          columns,
          defaultColumn: { size: 212, minSize: 24, maxSize: 420 },
          initialState: { columnPinning: { right: ['score'] } },
        }),
      { wrapper: withNuqsTestingAdapter({}) },
    )
    const { table } = result.current
    expect(table.getColumn('name')?.getSize()).toBe(212)
    expect(table.getColumn('name')?.columnDef.meta?.label).toBe('Title')
    expect(table.getColumn('score')?.getSize()).toBe(90)
    expect(table.getColumn('score')?.columnDef.minSize).toBe(40)
    expect(table.getColumn('actions')?.getSize()).toBe(212)
    expect(table.getColumn('actions')?.getIsPinned()).toBe(false)
    expect(table.getColumn('score')?.getIsPinned()).toBe('right')
  })

  it('keeps local pagination, sorting, and filtering working with explicit column configuration', async () => {
    const { result } = renderHook(
      () =>
        useDataTable({
          data,
          columns,
          manualPagination: false,
          manualSorting: false,
          manualFiltering: false,
        }),
      {
        wrapper: withNuqsTestingAdapter({
          hasMemory: true,
          resetUrlUpdateQueueOnMount: false,
        }),
      },
    )
    const table = () => result.current.table
    expect(table().getPageCount()).toBe(3)
    expect(table().getRowModel().rows).toHaveLength(25)
    act(() => table().setPageIndex(2))
    await waitFor(() => expect(table().getState().pagination.pageIndex).toBe(2))
    expect(table().getRowModel().rows).toHaveLength(10)
    act(() => table().setSorting([{ id: 'name', desc: true }]))
    await waitFor(() =>
      expect(table().getRowModel().rows[0].original.name).toBe('Record 59'),
    )
    expect(table().getState().pagination.pageIndex).toBe(0)
    act(() => table().getColumn('name')?.setFilterValue('Record 0'))
    await waitFor(() =>
      expect(table().getFilteredRowModel().rows).toHaveLength(10),
    )
    expect(table().getPageCount()).toBe(1)
    expect(table().getCanNextPage()).toBe(false)
    act(() => table().resetColumnFilters())
    await waitFor(() =>
      expect(table().getFilteredRowModel().rows).toHaveLength(60),
    )
  })
})
