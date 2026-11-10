import { useState } from 'react'
import type * as ApiModule from '@/lib/api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { OrderManageDialog } from './order-manage-dialog'
import { OrderTableActions } from './order-table-actions'
import type { OrderDetail, OrderStageEntry } from '../types/orders'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  apiClient: { get: vi.fn(), post: vi.fn() },
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    ...props
  }: {
    children: React.ReactNode
    to: string
    params: Record<string, string>
  }) => (
    <a href={to.replace('$orderId', params.orderId)} {...props}>
      {children}
    </a>
  ),
}))

const cutting: OrderStageEntry = {
  stageId: 'cutting',
  name: 'Cutting',
  sortOrder: 1,
  requiresDelivery: false,
  applicable: true,
  status: 'pending',
  startedAt: null,
  completedAt: null,
  locationId: null,
  location: null,
  notes: null,
  assigneeId: null,
  assigneeName: null,
}
const stitching: OrderStageEntry = {
  ...cutting,
  stageId: 'stitching',
  name: 'Stitching',
  sortOrder: 2,
}
const order: OrderDetail = {
  id: 'order-1',
  orderNumber: 7,
  invoiceId: 'invoice-1',
  invoiceNumber: 42,
  invoiceDate: new Date('2026-11-01'),
  measurementId: 'm1',
  customerNumber: 1,
  customerName: 'Ahmed',
  customerMobile: '+97333112233',
  material: 'Cotton',
  materialSource: 'shop',
  materialSku: 'COT',
  materialAmount: 3,
  price: 25,
  isUrgent: false,
  urgentCharge: 0,
  status: 'pending',
  outcome: 'active',
  closureReason: null,
  closedAt: null,
  closedBy: null,
  creditAmount: null,
  retainedCharge: 0,
  restoredMaterialQuantity: 0,
  collectedAt: null,
  thobeType: null,
  fPocket: null,
  sPocket: null,
  collar: null,
  sleeve: null,
  patti: null,
  emd: null,
  moreDetails: null,
  productionLocationId: 'factory',
  productionLocation: 'Factory',
  productionLocationInferred: false,
  receivingLocationId: 'branch',
  receivingLocation: 'Manama',
  stages: [cutting, stitching],
  currentStage: 'Cutting',
  repairs: [],
  invoiceTotalPrice: 25,
  invoiceAmountPaid: 0,
  invoicePaymentStatus: 'unpaid',
  invoiceBalanceDue: 25,
  invoiceGiftCardRedeemed: 0,
  invoicePaymentMethod: null,
  measurement: {
    id: 'm1',
    customerId: 'c1',
    readableId: 'C-1-001',
    date: new Date('2026-11-01'),
  },
}

function Actions({ value }: { value: OrderDetail }) {
  const [orderId, setOrderId] = useState<string | null>(null)
  return (
    <>
      <OrderTableActions
        order={value}
        onManage={(selected) => setOrderId(selected.id)}
        onCollect={vi.fn()}
      />
      <OrderManageDialog
        orderId={orderId}
        onOpenChange={(open) => !open && setOrderId(null)}
      />
    </>
  )
}

let liveOrder = order
function setup(value = order, cached = true) {
  liveOrder = value
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (cached) client.setQueryData(['orders', value.id], value)
  client.setQueryData(['users'], [])
  render(
    <QueryClientProvider client={client}>
      <Actions value={value} />
    </QueryClientProvider>,
  )
  return client
}

async function openManagement() {
  fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Manage Order' }))
  return screen.findByRole('dialog', { name: 'Manage Order ORD-7' })
}

const defaultSession = vi.mocked(useAuth).getMockImplementation()!
afterEach(() => vi.mocked(useAuth).mockImplementation(defaultSession))
beforeEach(() => {
  vi.mocked(apiClient.get).mockReset()
  vi.mocked(apiClient.post).mockReset()
  vi.mocked(apiClient.get).mockImplementation((url: string) =>
    Promise.resolve({
      data:
        url === '/orders/order-1'
          ? liveOrder
          : url.startsWith('/locations')
            ? { data: [], total: 0, page: 1, perPage: 20, pageCount: 0 }
            : [],
    }),
  )
})

describe('Order table management', () => {
  it('uses delivery readiness for orders delivered to the customer', async () => {
    setup({ ...order, collectionMethod: 'delivery' })
    const dialog = await openManagement()
    expect(
      within(dialog).getByRole('button', { name: 'Mark ready for delivery' }),
    ).toBeTruthy()
    expect(
      within(dialog).queryByRole('button', { name: 'Mark ready for pickup' }),
    ).toBeNull()
  })

  it('updates a stage in place and refreshes the order and invoice tables', async () => {
    const client = setup()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const dialog = await openManagement()
    const stages = within(dialog).getAllByRole('listitem')
    expect(
      within(stages[1])
        .getByRole('button', { name: 'Done' })
        .hasAttribute('disabled'),
    ).toBe(true)
    vi.mocked(apiClient.post).mockImplementationOnce(() => {
      liveOrder = {
        ...order,
        currentStage: 'Stitching',
        stages: [{ ...cutting, status: 'done' }, stitching],
      }
      return Promise.resolve({ data: liveOrder })
    })
    fireEvent.click(within(stages[0]).getByRole('button', { name: 'Done' }))
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        '/orders/order-1/stages/cutting',
        { status: 'done', locationId: undefined },
      ),
    )
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Undo' })).toBeTruthy(),
    )
    expect(
      within(dialog)
        .getByRole('button', { name: 'Done' })
        .hasAttribute('disabled'),
    ).toBe(false)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['invoices'] })
    expect(
      screen.getByRole('dialog', { name: 'Manage Order ORD-7' }),
    ).toBeTruthy()
  })

  it('keeps the current stage available when saving fails', async () => {
    setup()
    const dialog = await openManagement()
    vi.mocked(apiClient.post).mockRejectedValueOnce(
      new ApiError('Complete Cutting first.', 400),
    )
    const first = within(dialog).getAllByRole('listitem')[0]
    fireEvent.click(within(first).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        within(first)
          .getByRole('button', { name: 'Done' })
          .hasAttribute('disabled'),
      ).toBe(false),
    )
    expect(within(dialog).queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it.each(['skipped', 'pending'] as const)(
    'can record %s from the management window',
    async (status) => {
      setup({
        ...order,
        stages: [
          { ...cutting, status: status === 'pending' ? 'done' : 'pending' },
        ],
      })
      const dialog = await openManagement()
      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: order })
      fireEvent.click(
        within(dialog).getByRole('button', {
          name: status === 'pending' ? 'Undo' : 'Skip',
        }),
      )
      await waitFor(() =>
        expect(apiClient.post).toHaveBeenCalledWith(
          '/orders/order-1/stages/cutting',
          { status, locationId: undefined },
        ),
      )
    },
  )

  it.each([true, false])(
    'uses the invoice branch for delivery (branch available: %s)',
    async (available) => {
      setup({
        ...order,
        receivingLocationId: available ? 'branch' : null,
        stages: [{ ...cutting, requiresDelivery: true }],
      })
      const dialog = await openManagement()
      const done = within(dialog).getByRole('button', { name: 'Done' })
      expect(done.hasAttribute('disabled')).toBe(!available)
      if (available) {
        vi.mocked(apiClient.post).mockResolvedValueOnce({ data: order })
        fireEvent.click(done)
        await waitFor(() =>
          expect(apiClient.post).toHaveBeenCalledWith(
            '/orders/order-1/stages/cutting',
            { status: 'done', locationId: 'branch' },
          ),
        )
      }
    },
  )

  it.each(['cancelled', 'returned'] as const)(
    'keeps %s orders read-only',
    async (outcome) => {
      setup({ ...order, outcome })
      const dialog = await openManagement()
      expect(within(dialog).getByText('Production history')).toBeTruthy()
      expect(within(dialog).queryByRole('button', { name: 'Done' })).toBeNull()
      expect(
        within(dialog).queryByRole('button', { name: 'Mark Collected' }),
      ).toBeNull()
    },
  )

  it.each(['sales', 'production'] as const)(
    'respects %s permissions',
    async (role) => {
      const session = defaultSession()
      vi.mocked(useAuth).mockReturnValue({
        ...session,
        user: { ...session.user!, roles: [role] },
      })
      setup()
      const dialog = await openManagement()
      expect(
        within(dialog).queryAllByRole('button', { name: 'Done' }).length,
      ).toBe(role === 'production' ? 2 : 0)
      expect(
        within(dialog).queryByRole('button', { name: 'Log Repair' }) !== null,
      ).toBe(role === 'sales')
      expect(
        within(dialog).queryByRole('button', { name: 'Mark Collected' }) !==
          null,
      ).toBe(role === 'sales')
    },
  )

  it('loads the selected order on demand and can retry a failed load', async () => {
    setup(order, false)
    expect(apiClient.get).not.toHaveBeenCalled()
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Manage Order' }),
    )
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('dialog', { name: 'Manage Order ORD-7' }),
    ).toBeTruthy()
  })
})
