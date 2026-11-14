import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/lib/api'
import { apiGetMock } from '@/lib/list-fixtures'
import { typeSearchText } from '@/lib/test-events'
import { CreateRepairDialog } from './create-repair-dialog'
import type { OrderDetail } from '../types/orders'

vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }))

const order = {
  id: 'order-1',
  orderNumber: 101,
  invoiceNumber: 51,
  customerName: 'Test customer',
  customerMobile: '39001234',
  material: 'Cotton',
  outcome: 'active',
  measurement: {
    id: 'measurement-1',
    readableId: 'C-100-001',
    date: new Date('2026-10-01'),
    type: 'body',
    fit: 'fit',
    chest: 42,
  },
} as OrderDetail

beforeEach(() => {
  vi.mocked(apiClient.get).mockReset()
  vi.mocked(apiClient.post).mockReset()
  vi.mocked(apiClient.post).mockResolvedValue({ data: {} })
})

function renderDialog(selectedOrder: OrderDetail = order, seedDetail = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(
    [
      'repair-order-picker',
      [
        { id: 'orderNumber', type: 'number', prefix: 'ORD-' },
        'customerName',
        'customerMobile',
      ],
      '[]',
      '',
      20,
    ],
    {
      pages: [{ data: [selectedOrder], page: 1, pageCount: 1, total: 1 }],
      pageParams: [1],
    },
  )
  if (seedDetail)
    client.setQueryData(['orders', selectedOrder.id], selectedOrder)
  client.setQueryData(['repairs', ''], { data: [] })
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <CreateRepairDialog onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
  return { client, onOpenChange }
}

async function selectOrder() {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Order' }), {
    key: 'ArrowDown',
  })
  fireEvent.click(await screen.findByRole('option', { name: /ORD-101/ }))
}

describe('CreateRepairDialog', () => {
  it.each(['101', 'ORD-101', 'ord-101', 'Test customer', '39001234'])(
    'finds and selects an order by %s',
    async (search) => {
      vi.mocked(apiClient.get).mockImplementation(
        apiGetMock({ '/orders': [order] }),
      )
      renderDialog()
      const picker = screen.getByRole<HTMLInputElement>('combobox', {
        name: 'Order',
      })
      act(() => typeSearchText(picker, search))
      await waitFor(() => expect(apiClient.get).toHaveBeenCalled())
      const [requestUrl] = vi.mocked(apiClient.get).mock.calls[0]
      const params = new URL(String(requestUrl), 'http://localhost')
        .searchParams
      expect(params.get('joinOperator')).toBe('or')
      if (search.toLowerCase().includes('101')) {
        expect(JSON.parse(params.get('filters')!)).toContainEqual({
          id: 'orderNumber',
          value: '101',
          variant: 'number',
          operator: 'eq',
        })
      }
      fireEvent.click(await screen.findByRole('option', { name: /ORD-101/ }))
      expect(screen.getByLabelText('Reason')).toBeTruthy()
    },
  )

  it('requires an order and reason, saves repair details, and refreshes repairs', async () => {
    const { client, onOpenChange } = renderDialog()
    const submit = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Create Repair',
    })
    expect(submit.disabled).toBe(true)
    await selectOrder()
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: '  Shorten sleeves  ' },
    })
    fireEvent.change(screen.getByLabelText(/Charge/), {
      target: { value: '2.50' },
    })
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: '  Customer will collect Friday  ' },
    })
    fireEvent.click(submit)
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(apiClient.post).toHaveBeenCalledWith('/orders/order-1/repairs', {
      reason: 'Shorten sleeves',
      charge: 2.5,
      notes: 'Customer will collect Friday',
    })
    expect(client.getQueryState(['repairs', ''])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['orders', order.id])?.isInvalidated).toBe(true)
  })

  it.each(['cancelled', 'returned'] as const)(
    'blocks repair creation for a %s order',
    async (outcome) => {
      renderDialog({ ...order, outcome })
      await selectOrder()
      expect(screen.getByRole('alert').textContent).toContain(
        `This order is ${outcome}`,
      )
      expect(screen.queryByLabelText('Reason')).toBeNull()
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Create Repair' })
          .disabled,
      ).toBe(true)
      expect(apiClient.post).not.toHaveBeenCalled()
    },
  )

  it('loads the selected order measurements before allowing a repair', async () => {
    let resolveOrder!: (value: { data: unknown }) => void
    vi.mocked(apiClient.get).mockReturnValue(
      new Promise((resolve) => {
        resolveOrder = resolve
      }),
    )
    renderDialog(order, false)
    await selectOrder()
    expect(screen.getByRole('status').textContent).toContain('Loading order')
    expect(screen.queryByLabelText('Reason')).toBeNull()
    resolveOrder({
      data: {
        ...order,
        invoiceDate: '2026-10-01',
        measurement: { ...order.measurement, date: '2026-10-01' },
      },
    })
    await screen.findByLabelText('Reason')
    fireEvent.click(screen.getByRole('radio', { name: 'Update measurements' }))
    expect(screen.getByLabelText<HTMLInputElement>('Chest').value).toBe('42')
  })

  it('allows retrying an order detail failure', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('Offline'))
    renderDialog(order, false)
    await selectOrder()
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not load this order',
    )
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: {
        ...order,
        invoiceDate: '2026-10-01',
        measurement: { ...order.measurement, date: '2026-10-01' },
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByLabelText('Reason')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
