import { describe, expect, it, vi } from 'vitest'
import { getOrderStageColumns } from './order-stage-columns'

const onToggleActive = vi.fn()

describe('getOrderStageColumns', () => {
  it('includes the actions column for admins by default', () => {
    const columns = getOrderStageColumns(onToggleActive, false)
    expect(columns.some((column) => column.id === 'actions')).toBe(true)
  })

  it('drops the actions column when the caller cannot edit', () => {
    const columns = getOrderStageColumns(onToggleActive, false, false)
    expect(columns.some((column) => column.id === 'actions')).toBe(false)
    // The read-only columns survive.
    expect(
      columns.some(
        (column) => 'accessorKey' in column && column.accessorKey === 'name',
      ),
    ).toBe(true)
  })
})
