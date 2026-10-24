import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient, ApiError } from '@/lib/api'
import { apiGetMock } from '@/lib/list-fixtures'
import { STAFF_USER } from '@/features/users/test-fixtures'
import { typeSearchText } from '@/lib/test-events'
import { CONTEXT, PRODUCT } from '../test-fixtures'
import type { CreateReturnInput, ReturnContext } from '../types/returns'
import { ReturnsPanel } from './returns-panel'

function renderPanel(context: ReturnContext = CONTEXT) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['invoices', 'invoice-1', 'returns'], context)
  client.setQueryData(['users'], [STAFF_USER])
  const locations = apiGetMock({
    '/locations': [
      {
        id: 'location-original',
        name: 'Manama',
        isActive: true,
        holdsStock: true,
        receivesOrders: true,
      },
      {
        id: 'location-riffa',
        name: 'Riffa',
        isActive: true,
        holdsStock: true,
        receivesOrders: true,
      },
      {
        id: 'location-retired',
        name: 'Retired store',
        isActive: false,
        holdsStock: true,
        receivesOrders: true,
      },
      {
        id: 'location-pickup',
        name: 'Pickup only',
        isActive: true,
        holdsStock: false,
        receivesOrders: true,
      },
    ],
  })
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) =>
    url.startsWith('/locations') ? locations(url) : { data: context },
  )
  render(
    <QueryClientProvider client={client}>
      <ReturnsPanel invoiceId="invoice-1" />
    </QueryClientProvider>,
  )
  return client
}

afterEach(() => vi.restoreAllMocks())

describe('ReturnsPanel', () => {
  it('defaults to the sale location and lets staff choose another active stock location', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ data: { id: 'return-1' } })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Return & Refund' }))
    fireEvent.change(screen.getByLabelText('Reason for return'), {
      target: { value: 'Returned at another branch' },
    })
    fireEvent.change(screen.getByLabelText('Quantity to return — Buttons'), {
      target: { value: '1' },
    })
    fireEvent.click(screen.getByLabelText('Restock Buttons'))
    const location = screen.getByLabelText<HTMLInputElement>(
      'Restock location — Buttons',
    )
    expect(location.value).toBe('Manama')
    fireEvent.click(location)
    act(() => typeSearchText(location, 'Riffa'))
    await screen.findByRole('option', { name: 'Riffa' })
    await waitFor(
      () =>
        expect(
          screen.queryByRole('option', { name: 'Manama', exact: true }),
        ).toBeNull(),
      { timeout: 3000 },
    )
    expect(screen.queryByRole('option', { name: 'Retired store' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'Pickup only' })).toBeNull()
    fireEvent.keyDown(location, { key: 'ArrowDown' })
    fireEvent.keyDown(location, { key: 'Enter' })
    await waitFor(() =>
      expect(location.getAttribute('aria-expanded')).toBe('false'),
    )
    fireEvent.click(screen.getByLabelText('Refund later'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }))
    await waitFor(() => expect(post).toHaveBeenCalledOnce())
    expect(post.mock.calls[0][1]).toMatchObject({
      lines: [
        {
          lineId: PRODUCT.lineId,
          quantity: 1,
          restock: true,
          restockLocationId: 'location-riffa',
        },
      ],
    })
  })

  it('requires an explicit destination when no eligible original location can be defaulted', async () => {
    const post = vi.spyOn(apiClient, 'post')
    renderPanel({
      ...CONTEXT,
      lines: [{ ...PRODUCT, defaultRestockLocationId: null }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Return & Refund' }))
    fireEvent.change(screen.getByLabelText('Reason for return'), {
      target: { value: 'Original branch closed' },
    })
    fireEvent.change(screen.getByLabelText('Quantity to return — Buttons'), {
      target: { value: '1' },
    })
    fireEvent.click(screen.getByLabelText('Restock Buttons'))
    fireEvent.click(screen.getByLabelText('Refund later'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }))
    await screen.findByText('Select a restock location.')
    expect(post).not.toHaveBeenCalled()
  })

  it('shows the receiving and original locations in restock history', () => {
    renderPanel({
      ...CONTEXT,
      returns: [
        {
          id: 'return-1',
          kind: 'return',
          reason: 'Returned in Riffa',
          amount: 10,
          createdAt: '2026-10-24T12:00:00Z',
          createdBy: 'staff',
          lines: [
            {
              lineId: PRODUCT.lineId,
              description: PRODUCT.description,
              quantity: 1,
              amount: 10,
              restocked: true,
              originalLocationId: 'location-original',
              originalLocationName: 'Manama',
              restockLocationId: 'location-riffa',
              restockLocationName: 'Riffa',
            },
          ],
        },
      ],
    })
    expect(
      screen.getByText(/Restocked at Riffa \(sold from Manama\)/),
    ).toBeTruthy()
  })

  it('caps quantities at the purchased amount less previous returns, including typed values', () => {
    renderPanel({
      ...CONTEXT,
      lines: [{ ...PRODUCT, returnedQuantity: 2, creditedAmount: 6.67 }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Return & Refund' }))
    const quantity = screen.getByLabelText('Quantity to return — Buttons')
    expect(
      screen.getByText(/Purchased: 3 · Already returned: 2 · Available: 1/),
    ).toBeTruthy()
    const increase = screen.getByRole('button', {
      name: 'Increase Quantity to return — Buttons',
    })
    fireEvent.change(quantity, { target: { value: '0' } })
    fireEvent.click(increase)
    expect((quantity as HTMLInputElement).value).toBe('1')
    expect(increase.hasAttribute('disabled')).toBe(true)
    fireEvent.change(quantity, { target: { value: '9' } })
    fireEvent.blur(quantity)
    expect((quantity as HTMLInputElement).value).toBe('1')
    fireEvent.change(quantity, { target: { value: '-1' } })
    fireEvent.blur(quantity)
    expect((quantity as HTMLInputElement).value).toBe('0')
  })

  it('keeps fractional retail quantities within the remaining purchased quantity', () => {
    renderPanel({
      ...CONTEXT,
      lines: [{ ...PRODUCT, quantity: 2.5, returnedQuantity: 1.25 }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Return & Refund' }))
    const quantity = screen.getByLabelText('Quantity to return — Buttons')
    fireEvent.change(quantity, { target: { value: '1.25' } })
    fireEvent.blur(quantity)
    expect((quantity as HTMLInputElement).value).toBe('1.25')
    expect(
      screen
        .getByRole('button', { name: 'Increase Quantity to return — Buttons' })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('records the return and its mixed-tender refund in one confirmation', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ data: { id: 'return-1' } })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Return & Refund' }))
    fireEvent.change(screen.getByLabelText('Reason for return'), {
      target: { value: 'Wrong size' },
    })
    fireEvent.change(screen.getByLabelText('Quantity to return — Buttons'), {
      target: { value: '1' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm Return & Refund' }),
    )
    await waitFor(() =>
      expect(
        screen.getByText('Select the method used to pay the customer back.'),
      ).toBeTruthy(),
    )
    expect(post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Benefit' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm Return & Refund' }),
    )
    await waitFor(() => expect(post).toHaveBeenCalledOnce())
    expect(post).toHaveBeenCalledWith('/invoices/invoice-1/returns', {
      requestId: expect.any(String),
      reason: 'Wrong size',
      lines: [
        {
          lineId: PRODUCT.lineId,
          quantity: 1,
          restock: false,
          restockLocationId: null,
        },
      ],
      refund: {
        timing: 'now',
        payments: [
          { amount: 30, paymentType: 'benefit', giftCardId: null },
          { amount: 23.33, paymentType: 'gift_card', giftCardId: 'gift-1' },
        ],
      },
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('disables returns for uncollected goods and leaves deferred refunds to payment history', () => {
    renderPanel({
      ...CONTEXT,
      lines: [{ ...PRODUCT, collected: false }],
      settlement: { ...CONTEXT.settlement, refundDue: 0 },
    })
    expect(
      screen
        .getByRole('button', { name: 'Return & Refund' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen.queryByRole('button', { name: 'Refund Pending Credit' }),
    ).toBeNull()
  })

  it('submits the selected quantity and restock choice and refreshes affected data', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ data: { id: 'return-1' } })
    const client = renderPanel()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(screen.getByRole('button', { name: 'Return & Refund' }))
    fireEvent.change(screen.getByLabelText('Reason for return'), {
      target: { value: 'Wrong size' },
    })
    fireEvent.change(screen.getByLabelText('Quantity to return — Buttons'), {
      target: { value: '1' },
    })
    fireEvent.click(screen.getByLabelText('Restock Buttons'))
    fireEvent.click(screen.getByLabelText('Refund later'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }))
    await waitFor(() => expect(post).toHaveBeenCalledOnce())
    expect(post).toHaveBeenCalledWith('/invoices/invoice-1/returns', {
      requestId: expect.any(String),
      reason: 'Wrong size',
      lines: [
        {
          lineId: PRODUCT.lineId,
          quantity: 1,
          restock: true,
          restockLocationId: PRODUCT.defaultRestockLocationId,
        },
      ],
      refund: { timing: 'later' },
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['invoices'] })
  })

  it('keeps a failed return open and reuses the request ID when retrying', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockRejectedValueOnce(new ApiError('Temporarily unavailable', 503))
      .mockResolvedValueOnce({ data: { id: 'return-1' } })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Return & Refund' }))
    fireEvent.change(screen.getByLabelText('Reason for return'), {
      target: { value: 'Wrong size' },
    })
    fireEvent.change(screen.getByLabelText('Quantity to return — Buttons'), {
      target: { value: '1' },
    })
    fireEvent.click(screen.getByLabelText('Refund later'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Temporarily unavailable',
      ),
    )
    expect(screen.queryByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Refund later'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    expect(post.mock.calls[0][1]).toEqual(post.mock.calls[1][1])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('warns staff to refresh history when an edited retry may already be recorded', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockRejectedValueOnce(new ApiError('Response lost', 503))
      .mockRejectedValueOnce(
        new ApiError('Request ID already used with different values', 409),
      )
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Return & Refund' }))
    fireEvent.change(screen.getByLabelText('Reason for return'), {
      target: { value: 'Wrong size' },
    })
    fireEvent.change(screen.getByLabelText('Quantity to return — Buttons'), {
      target: { value: '1' },
    })
    fireEvent.click(screen.getByLabelText('Refund later'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }))
    await screen.findByText('Response lost')
    fireEvent.change(screen.getByLabelText('Reason for return'), {
      target: { value: 'Wrong size — corrected reason' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'This operation may already be recorded. Refresh the history before trying again.',
      ),
    )
    const original = post.mock.calls[0][1] as CreateReturnInput & {
      requestId: string
    }
    expect(post.mock.calls[1][1]).toEqual({
      ...original,
      reason: 'Wrong size — corrected reason',
    })
    expect(
      screen.getByDisplayValue('Wrong size — corrected reason'),
    ).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeTruthy()
  })
})
