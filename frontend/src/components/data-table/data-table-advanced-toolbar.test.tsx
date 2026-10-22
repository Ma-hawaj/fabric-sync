import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing'
import { describe, expect, it } from 'vitest'

import { DataTableAdvancedToolbar } from './data-table-advanced-toolbar'
import { useListParams } from '@/hooks/use-list-params'

interface Record {
  title: string
  mobileNo: string
  status: string
  lifecycle: string
}

const columns: ColumnDef<Record>[] = [
  {
    accessorKey: 'title',
    enableColumnFilter: true,
    meta: { label: 'Title', variant: 'text' },
  },
  {
    accessorKey: 'mobileNo',
    enableColumnFilter: true,
    meta: { label: 'Contact', variant: 'text' },
  },
  {
    accessorKey: 'status',
    enableColumnFilter: true,
    meta: {
      label: 'Status',
      variant: 'multiSelect',
      options: [{ label: 'Active', value: 'active' }],
    },
  },
  {
    accessorKey: 'lifecycle',
    enableColumnFilter: true,
    meta: {
      label: 'Phase',
      variant: 'multiSelect',
      options: [{ label: 'Queued', value: 'queued' }],
    },
  },
]
const data: Record[] = []

function Harness({ configured = false }: { configured?: boolean }) {
  const table = useReactTable({
    data,
    columns,
    manualFiltering: true,
    getCoreRowModel: getCoreRowModel(),
  })
  const { searchParams } = useListParams({ columns })
  return (
    <>
      <DataTableAdvancedToolbar
        table={table}
        defaultSearchColumnId={configured ? 'mobileNo' : undefined}
        quickFilter={
          configured
            ? { columnId: 'lifecycle', allLabel: 'All phases' }
            : undefined
        }
      />
      <output data-testid="request">
        {searchParams.get('filters') ?? '[]'}
      </output>
    </>
  )
}

describe('advanced toolbar configuration', () => {
  it('uses explicit search and quick-filter columns with arbitrary field names', async () => {
    render(<Harness configured />, {
      wrapper: withNuqsTestingAdapter({
        hasMemory: true,
        resetUrlUpdateQueueOnMount: false,
      }),
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Search Contact' }), {
      target: { value: '123' },
    })
    fireEvent.click(
      screen.getByRole('combobox', { name: 'Quick Phase filter' }),
    )
    const queued = await screen.findByRole('option', { name: 'Queued' })
    fireEvent.pointerDown(queued)
    fireEvent.click(queued)
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId('request').textContent)).toEqual(
        expect.arrayContaining([
          { id: 'mobileNo', value: '123', operator: 'iLike', variant: 'text' },
          {
            id: 'lifecycle',
            value: ['queued'],
            operator: 'inArray',
            variant: 'multiSelect',
          },
        ]),
      ),
    )
    expect(
      screen.queryByRole('combobox', { name: 'Quick Status filter' }),
    ).toBeNull()
    fireEvent.click(
      screen.getByRole('combobox', { name: 'Quick Phase filter' }),
    )
    const allPhases = await screen.findByRole('option', { name: 'All phases' })
    fireEvent.pointerDown(allPhases)
    fireEvent.click(allPhases)
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId('request').textContent)).toEqual([
        { id: 'mobileNo', value: '123', operator: 'iLike', variant: 'text' },
      ]),
    )
  })

  it('does not guess search or quick-filter defaults from business field names', () => {
    render(<Harness />, { wrapper: withNuqsTestingAdapter({}) })
    expect(screen.getByRole('textbox', { name: 'Search Title' })).toBeTruthy()
    expect(
      screen.queryByRole('combobox', { name: /Quick .* filter/ }),
    ).toBeNull()
  })
})
