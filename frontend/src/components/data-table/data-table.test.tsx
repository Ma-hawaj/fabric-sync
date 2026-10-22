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

function Harness() {
  const table = useReactTable({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
  })
  return <DataTable table={table} />
}

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
