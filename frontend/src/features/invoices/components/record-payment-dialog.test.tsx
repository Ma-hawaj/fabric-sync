import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient, ApiError } from '@/lib/api'
import type { Invoice } from '../types/invoices'
import { RecordPaymentDialog } from './record-payment-dialog'

const invoice: Invoice = {
  createdBy: null,
  id: 'invoice-1',
  invoiceNumber: 42,
  collectionMethod: 'pickup',
  urgentCharge: 0,
  date: '2026-10-24T10:00:00Z',
  targetDate: null,
  customers: [{ name: 'Omar', mobileNo: '33112233' }],
  itemCount: 1,
  materials: ['Cotton'],
  totalPrice: 100,
  netTotal: 80,
  amountCredited: 20,
  amountRefunded: 0,
  refundDue: 0,
  paymentStatus: 'partial',
  amountPaid: 30,
  balanceDue: 50,
  paymentMethod: 'cash',
  giftCardRedeemed: 0,
  collected: false,
  orderCount: 1,
  collectedOrderCount: 0,
  lastCollectedAt: null,
  receivingLocation: 'Manama',
  productionLocations: [],
}

function setup() {
  const client = new QueryClient()
  const onOpenChange = vi.fn()
  const dialog = (value: Invoice) => (
    <QueryClientProvider client={client}>
      <RecordPaymentDialog invoice={value} onOpenChange={onOpenChange} />
    </QueryClientProvider>
  )
  const view = render(dialog(invoice))
  return {
    onOpenChange,
    refresh: (value: Invoice) => view.rerender(dialog(value)),
  }
}

function chooseCash() {
  fireEvent.click(screen.getByRole('combobox'))
  fireEvent.pointerDown(screen.getByRole('option', { name: 'Cash' }), {
    pointerType: 'mouse',
  })
  fireEvent.click(screen.getByRole('option', { name: 'Cash' }))
}

afterEach(() => vi.restoreAllMocks())

describe('Record Payment retry behavior', () => {
  it('preserves input and permits the original replay after a refresh shows zero balance', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockRejectedValueOnce(new ApiError('Response lost', 503))
      .mockResolvedValueOnce({ data: { payment: { id: 'payment-1' } } })
    const { onOpenChange, refresh } = setup()
    chooseCash()
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Could not confirm the payment',
      ),
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    refresh({
      ...invoice,
      balanceDue: 0,
      amountPaid: 80,
      paymentStatus: 'paid',
    })
    expect(screen.getByLabelText<HTMLInputElement>('Amount (BHD)').value).toBe(
      '50',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[1]).toEqual(post.mock.calls[0])
    expect(post.mock.calls[0][1]).toMatchObject({
      amount: 50,
      paymentType: 'cash',
      requestId: expect.any(String),
    })
  })

  it('keeps edited retries on the original ID and explains a conflict without closing', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockRejectedValueOnce(new ApiError('Response lost', 503))
      .mockRejectedValueOnce(new ApiError('Different values', 409))
    const { onOpenChange } = setup()
    chooseCash()
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Amount (BHD)'), {
      target: { value: '40' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Refresh the payment history',
      ),
    )
    expect(post.mock.calls[1][1]).toEqual({
      ...(post.mock.calls[0][1] as object),
      amount: 40,
    })
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByLabelText<HTMLInputElement>('Amount (BHD)').value).toBe(
      '40',
    )
  })

  it('prevents changes and dismissal while a payment is pending', async () => {
    let finish!: (value: { data: object }) => void
    vi.spyOn(apiClient, 'post').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { onOpenChange } = setup()
    chooseCash()
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }))
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Record Payment' })
          .hasAttribute('disabled'),
      ).toBe(true),
    )
    expect(screen.getByLabelText('Amount (BHD)').matches(':disabled')).toBe(
      true,
    )
    expect(
      screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled'),
    ).toBe(true)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => {
      finish({ data: {} })
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
