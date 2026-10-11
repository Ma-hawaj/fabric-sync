import { describe, expect, it, vi } from 'vitest'
import { getLocationColumns } from './location-columns'

const onToggleActive = vi.fn()

describe('getLocationColumns', () => {
  it('includes the actions column for admins by default', () => {
    const columns = getLocationColumns(onToggleActive, false)
    expect(columns.some((column) => column.id === 'actions')).toBe(true)
  })

  it('drops the actions column when the caller cannot edit', () => {
    const columns = getLocationColumns(onToggleActive, false, false)
    expect(columns.some((column) => column.id === 'actions')).toBe(false)
    // The read-only columns survive.
    expect(
      columns.some(
        (column) => 'accessorKey' in column && column.accessorKey === 'name',
      ),
    ).toBe(true)
  })
})
