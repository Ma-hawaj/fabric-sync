import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { RepairsPage } from './repairs'
import { printRepairDocument } from './lib/print-repair'
import { useAuth } from '@/lib/auth'
import type { RepairListItem } from './types/orders'

const callbacks = vi.hoisted(() => ({ print: (_repair: RepairListItem) => {} }))
vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }))
vi.mock('./lib/print-repair', () => ({ printRepairDocument: vi.fn() }))
vi.mock('@/hooks/use-list-params', () => ({
  useListParams: () => ({ searchParams: new URLSearchParams() }),
}))
vi.mock('@/hooks/use-data-table', () => ({
  useDataTable: () => ({ table: {} }),
}))
vi.mock('./hooks/use-repairs', () => ({
  useRepairs: () => ({ data: [], pageCount: 0, total: 0, isLoading: false }),
}))
vi.mock('./components/repair-columns', () => ({
  getRepairColumns: (_receive: unknown, print: typeof callbacks.print) => {
    callbacks.print = print
    return []
  },
}))
vi.mock('@/components/data-table/data-table', () => ({ DataTable: () => null }))
vi.mock('@/components/data-table/data-table-toolbar', () => ({
  DataTableToolbar: () => null,
}))
vi.mock('./components/receive-repair-dialog', () => ({
  ReceiveRepairDialog: () => null,
}))
vi.mock('./components/create-repair-dialog', () => ({
  CreateRepairDialog: ({
    onOpenChange,
  }: {
    onOpenChange: (open: boolean) => void
  }) => (
    <div role="dialog">
      <button onClick={() => onOpenChange(false)}>Cancel</button>
    </div>
  ),
}))
afterEach(cleanup)

describe('repair receipt errors', () => {
  it('passes the rejected print promise to the error toast', async () => {
    vi.mocked(printRepairDocument).mockRejectedValueOnce(
      new Error('Printing failed'),
    )
    render(<RepairsPage />)
    callbacks.print({ orderId: 'order-1', id: 'repair-1' } as RepairListItem)
    const [pending, messages] = vi.mocked(toast.promise).mock.calls[0]
    await expect(pending).rejects.toThrow('Printing failed')
    expect(messages?.error).toBe(
      'Could not prepare this receipt. Please try again.',
    )
  })
})

describe('create repair access', () => {
  it('opens creation from the repairs page and closes on cancel', () => {
    render(<RepairsPage />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create Repair' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('hides creation from production staff', () => {
    const auth = vi.mocked(useAuth).getMockImplementation()!()
    vi.mocked(useAuth).mockReturnValue({
      ...auth,
      user: { ...auth.user!, roles: ['production'] },
    })
    render(<RepairsPage />)
    expect(screen.queryByRole('button', { name: 'Create Repair' })).toBeNull()
  })
})
