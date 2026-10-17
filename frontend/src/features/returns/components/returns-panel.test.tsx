import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient, ApiError } from '@/lib/api'
import { CONTEXT, PRODUCT } from '../test-fixtures'
import type { ReturnContext } from '../types/returns'
import { ReturnsPanel } from './returns-panel'

function renderPanel(context: ReturnContext = CONTEXT) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['invoices', 'invoice-1', 'returns'], context)
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: context })
  render(
    <QueryClientProvider client={client}>
      <ReturnsPanel invoiceId="invoice-1" />
    </QueryClientProvider>,
  )
  return client
}

afterEach(() => vi.restoreAllMocks())

describe('ReturnsPanel', () => {
  it('disables actions for uncollected goods and an invoice without customer credit', () => {
    renderPanel({
      ...CONTEXT,
      lines: [{ ...PRODUCT, collected: false }],
      settlement: { ...CONTEXT.settlement, refundDue: 0 },
    })
    expect(
      screen
        .getByRole('button', { name: 'Return Items' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen
        .getByRole('button', { name: 'Record Refund' })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('submits the selected quantity and restock choice and refreshes affected data', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ data: { id: 'return-1' } })
    const client = renderPanel()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(screen.getByRole('button', { name: 'Return Items' }))
    fireEvent.change(screen.getByLabelText('Reason for return'), {
      target: { value: 'Wrong size' },
    })
    fireEvent.change(screen.getByLabelText('Quantity to return — Buttons'), {
      target: { value: '1' },
    })
    fireEvent.click(
      screen.getByLabelText('Restock at the original sale location'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Record Return' }))
    await waitFor(() => expect(post).toHaveBeenCalledOnce())
    expect(post).toHaveBeenCalledWith('/invoices/invoice-1/returns', {
      requestId: expect.any(String),
      reason: 'Wrong size',
      lines: [{ lineId: PRODUCT.lineId, quantity: 1, restock: true }],
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
    fireEvent.click(screen.getByRole('button', { name: 'Return Items' }))
    fireEvent.change(screen.getByLabelText('Reason for return'), {
      target: { value: 'Wrong size' },
    })
    fireEvent.change(screen.getByLabelText('Quantity to return — Buttons'), {
      target: { value: '1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Record Return' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Temporarily unavailable',
      ),
    )
    expect(screen.queryByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Record Return' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    expect(post.mock.calls[0][1]).toEqual(post.mock.calls[1][1])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
