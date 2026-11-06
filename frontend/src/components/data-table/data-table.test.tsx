import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DataTable } from './data-table'

const columns: ColumnDef<{ reference: string }>[] = [
  {
    accessorKey: 'reference',
    header: 'Reference',
    size: 80,
    minSize: 50,
    maxSize: 90,
    meta: { label: 'Reference' },
  },
]
const data = [{ reference: 'A-1' }]

function Harness({
  rows = data,
  isLoading = false,
  isFetching = false,
}: {
  rows?: typeof data
  isLoading?: boolean
  isFetching?: boolean
}) {
  const table = useReactTable({
    columns,
    data: rows,
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <DataTable table={table} isLoading={isLoading} isFetching={isFetching} />
  )
}

describe('DataTable loading', () => {
  it('shows skeleton rows during the initial request', () => {
    render(<Harness rows={[]} isLoading isFetching />)

    const table = screen.getByRole('table', { name: 'Records' })
    expect(table.closest('[aria-busy]')?.getAttribute('aria-busy')).toBe('true')
    expect(table.querySelectorAll('tbody tr')).toHaveLength(8)
    expect(screen.queryByText('No results.')).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('indicates refreshes even when the previous result was empty', () => {
    const { rerender } = render(<Harness rows={[]} isFetching />)

    expect(
      screen.getByRole('progressbar', { name: 'Updating records' }),
    ).toBeTruthy()
    expect(screen.getByText('No results.')).toBeTruthy()

    rerender(<Harness rows={[]} />)

    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByText('No results.')).toBeTruthy()
    expect(
      screen
        .getByRole('table')
        .closest('[aria-busy]')
        ?.getAttribute('aria-busy'),
    ).toBe('false')
  })
})

describe('DataTable resizing', () => {
  it("respects each column's configured limits for keyboard resizing", () => {
    render(<Harness />)
    const resizer = screen.getByRole('separator', {
      name: 'Resize Reference column',
    })
    const header = resizer.closest('th')!
    for (let index = 0; index < 6; index++) {
      fireEvent.keyDown(resizer, { key: 'ArrowLeft' })
    }
    expect(header.style.width).toBe('50px')
    for (let index = 0; index < 6; index++) {
      fireEvent.keyDown(resizer, { key: 'ArrowRight' })
    }
    expect(header.style.width).toBe('90px')
  })
})
