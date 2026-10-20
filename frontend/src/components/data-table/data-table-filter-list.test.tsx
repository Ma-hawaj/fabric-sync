import {
  getCoreRowModel,
  getFacetedMinMaxValues,
  getFacetedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing'
import { describe, expect, it } from 'vitest'

import { DataTableFilterList } from './data-table-filter-list'
import { useListParams } from '@/hooks/use-list-params'
import type { ExtendedColumnFilter } from '@/types/data-table'

interface Row {
  amountPaid: number
  quantity: number
  date: string
  targetDate: string
}

const columns: ColumnDef<Row>[] = [
  {
    accessorKey: 'amountPaid',
    enableColumnFilter: true,
    meta: { label: 'Paid', variant: 'range' },
  },
  {
    accessorKey: 'quantity',
    enableColumnFilter: true,
    meta: { label: 'Quantity', variant: 'number' },
  },
  {
    accessorKey: 'date',
    enableColumnFilter: true,
    meta: { label: 'Date', variant: 'date' },
  },
  {
    accessorKey: 'targetDate',
    enableColumnFilter: true,
    meta: { label: 'Target date', variant: 'dateRange' },
  },
]

function FilterHarness() {
  const table = useReactTable({
    columns,
    data: [10, 20].map((amountPaid) => ({
      amountPaid,
      quantity: 1,
      date: '2026-10-20',
      targetDate: '2026-10-21',
    })),
    manualFiltering: true,
    getCoreRowModel: getCoreRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedMinMaxValues: getFacetedMinMaxValues(),
  })
  const { searchParams } = useListParams({ columns })

  return (
    <>
      <DataTableFilterList table={table} />
      <output data-testid="request">
        {searchParams.get('filters') ?? '[]'}
      </output>
    </>
  )
}

function renderFilter(filter: ExtendedColumnFilter<Row>) {
  render(<FilterHarness />, {
    wrapper: withNuqsTestingAdapter({
      searchParams: `?filters=${encodeURIComponent(JSON.stringify([filter]))}`,
      hasMemory: true,
      // Preserve pending writes when the in-memory adapter rerenders.
      resetUrlUpdateQueueOnMount: false,
    }),
  })
  fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
}

function requestFilters() {
  return JSON.parse(screen.getByTestId('request').textContent)
}

async function selectOperator(label: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Filter operator' }))
  const option = await screen.findByRole('option', { name: label, exact: true })
  fireEvent.pointerDown(option)
  fireEvent.click(option)
}

describe('advanced filter requests', () => {
  it.each([
    ['amountPaid', 'range', '25.125'],
    ['quantity', 'number', '5'],
    ['date', 'date', '1792454400000'],
    ['targetDate', 'dateRange', '1792540800000'],
  ] as const)(
    'converts %s between scalar and range operators before requesting data',
    async (id, variant, value) => {
      renderFilter({ id, variant, value, operator: 'eq', filterId: 'one' })

      await selectOperator('Is between')
      await waitFor(() =>
        expect(requestFilters()).toEqual([
          { id, variant, value: [value, ''], operator: 'isBetween' },
        ]),
      )

      await selectOperator('Is')
      await waitFor(() =>
        expect(requestFilters()).toEqual([
          { id, variant, value, operator: 'eq' },
        ]),
      )
    },
  )

  it.each([
    { value: ['10', '20'], expected: '10' },
    { value: ['', '20'], expected: '20' },
  ])(
    'converts the range $value into a scalar comparison',
    async ({ value, expected }) => {
      renderFilter({
        id: 'amountPaid',
        variant: 'range',
        value,
        operator: 'isBetween',
        filterId: 'one',
      })

      await selectOperator('Is')
      await waitFor(() => expect(requestFilters()[0]?.value).toBe(expected))
      expect(
        screen.getByRole<HTMLInputElement>('spinbutton', {
          name: 'Paid filter value',
        }).value,
      ).toBe(expected)
    },
  )

  it('clears values for empty operators and leaves a blank range inactive', async () => {
    renderFilter({
      id: 'amountPaid',
      variant: 'range',
      value: '25',
      operator: 'eq',
      filterId: 'one',
    })

    await selectOperator('Is empty')
    await waitFor(() =>
      expect(requestFilters()).toEqual([
        { id: 'amountPaid', variant: 'range', value: '', operator: 'isEmpty' },
      ]),
    )
    await selectOperator('Is between')
    await waitFor(() => expect(requestFilters()).toEqual([]))
  })

  it('allows Paid bounds outside the loaded page and preserves decimal values', async () => {
    renderFilter({
      id: 'amountPaid',
      variant: 'range',
      value: ['', ''],
      operator: 'isBetween',
      filterId: 'one',
    })

    const minimum = screen.getByRole<HTMLInputElement>('spinbutton', {
      name: 'Paid minimum value',
    })
    const maximum = screen.getByRole<HTMLInputElement>('spinbutton', {
      name: 'Paid maximum value',
    })

    fireEvent.change(minimum, { target: { value: '500.125' } })
    await waitFor(() =>
      expect(requestFilters()[0]?.value).toEqual(['500.125', '']),
    )
    fireEvent.change(maximum, { target: { value: '5000.875' } })
    await waitFor(() =>
      expect(requestFilters()[0]?.value).toEqual(['500.125', '5000.875']),
    )
    expect(minimum.value).toBe('500.125')
    expect(maximum.value).toBe('5000.875')

    // Zero is a real bound, and clearing one side keeps the other side open.
    fireEvent.change(minimum, { target: { value: '0' } })
    await waitFor(() =>
      expect(requestFilters()[0]?.value).toEqual(['0', '5000.875']),
    )
    fireEvent.change(maximum, { target: { value: '' } })
    await waitFor(() => expect(requestFilters()[0]?.value).toEqual(['0', '']))
  })
})
