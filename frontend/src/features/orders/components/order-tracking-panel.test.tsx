import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrderTrackingPanel } from './order-tracking-panel'
import type { OrderDetail } from '../types/orders'

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
vi.mock('../hooks/use-update-repair', () => ({
  useUpdateRepair: () => ({ mutateAsync, isPending: false }),
}))
vi.mock('@/features/users/hooks/use-users', () => ({
  useUsers: () => ({ data: [] }),
}))
vi.mock('@/features/locations/hooks/use-default-location', () => ({
  useApplicableDefaultLocation: () => null,
}))
vi.mock('@/features/notifications/notification-dialog', () => ({
  NotificationDialog: ({
    invoiceId,
    repairId,
  }: {
    invoiceId: string | null
    repairId?: string
  }) =>
    invoiceId ? (
      <div role="dialog">
        Notify {repairId} for {invoiceId}
      </div>
    ) : null,
}))
vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }))

const order = {
  id: 'order-1',
  invoiceId: 'invoice-1',
  outcome: 'active',
  status: 'collected',
  stages: [],
  productionLocationId: null,
  productionLocation: null,
  repairs: [
    {
      id: 'repair-1',
      status: 'in_progress',
      reason: 'Shorten sleeves',
      reportedOn: '2026-11-04',
      charge: 0,
    },
  ],
} as unknown as OrderDetail

function mount(value = order) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <OrderTrackingPanel order={value} onLogRepair={vi.fn()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mutateAsync.mockReset()
  mutateAsync.mockResolvedValue(order)
})

describe('repair ready notification', () => {
  it('opens the pickup notification for this repair after marking it ready', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Mark Ready' }))
    await waitFor(() =>
      expect(screen.getByRole('dialog').textContent).toBe(
        'Notify repair-1 for invoice-1',
      ),
    )
    expect(mutateAsync).toHaveBeenCalledWith({
      orderId: 'order-1',
      repairId: 'repair-1',
      status: 'completed',
    })
  })

  it('does not offer notification when the status update fails', async () => {
    mutateAsync.mockRejectedValue(new Error('Save failed'))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Mark Ready' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('allows opening the preview again for an already ready repair', () => {
    mount({ ...order, repairs: [{ ...order.repairs[0], status: 'completed' }] })
    fireEvent.click(
      screen.getByRole('button', { name: 'Notify ready for pickup' }),
    )
    expect(screen.getByRole('dialog').textContent).toBe(
      'Notify repair-1 for invoice-1',
    )
    expect(mutateAsync).not.toHaveBeenCalled()
  })
})
