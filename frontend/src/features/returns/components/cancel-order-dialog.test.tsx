import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient, ApiError } from '@/lib/api'
import { CANCELLATION } from '../test-fixtures'
import type { CancellationContext } from '../types/returns'
import { CancelOrderDialog } from './cancel-order-dialog'

function renderDialog(context: CancellationContext = CANCELLATION) {
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CancelOrderDialog context={context} onClose={onClose} />
    </QueryClientProvider>,
  )
  return onClose
}

afterEach(() => vi.restoreAllMocks())

describe('cancellation dialog', () => {
  it('cancels and refunds in one request with explicit unused fabric confirmation', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ data: { id: 'cancellation-1' } })
    const onClose = renderDialog()
    fireEvent.change(screen.getByLabelText('Reason for cancellation'), {
      target: { value: 'Travel plans changed' },
    })
    fireEvent.click(
      screen.getByLabelText('Restore confirmed unused fabric to Manama'),
    )
    fireEvent.change(
      screen.getByLabelText('Unused fabric to restore (up to 3.5 m)'),
      { target: { value: '3.5' } },
    )
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Cash' }), {
      pointerType: 'mouse',
    })
    fireEvent.click(screen.getByRole('option', { name: 'Cash' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm Cancellation & Refund' }),
    )
    await waitFor(() => expect(post).toHaveBeenCalledOnce())
    expect(post).toHaveBeenCalledWith('/orders/order-1/cancel', {
      requestId: expect.any(String),
      reason: 'Travel plans changed',
      retainedCharge: 0,
      restoredMaterialQuantity: 3.5,
      workChargeConfirmed: false,
      unusedMaterialConfirmed: true,
      refund: {
        timing: 'now',
        payments: [{ amount: 10, paymentType: 'cash', giftCardId: null }],
      },
    })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('preserves the form and request ID after an uncertain response', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockRejectedValueOnce(new ApiError('Could not confirm save', 503))
      .mockResolvedValueOnce({ data: { id: 'cancellation-1' } })
    const onClose = renderDialog()
    fireEvent.change(screen.getByLabelText('Reason for cancellation'), {
      target: { value: 'Changed plans' },
    })
    fireEvent.click(screen.getByLabelText('Refund later'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm Cancellation' }),
    )
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Could not confirm save',
      ),
    )
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm Cancellation' }),
    )
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    expect(post.mock.calls[0][1]).toEqual(post.mock.calls[1][1])
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })
})
