import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient, ApiError } from '@/lib/api'
import { useRecordPayment } from './use-record-payment'

function setup() {
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { ...renderHook(useRecordPayment, { wrapper }), invalidate }
}

const payment = {
  invoiceId: 'invoice-1',
  amount: 20,
  paymentType: 'cash' as const,
}
afterEach(() => vi.restoreAllMocks())

describe('payment request identity', () => {
  it('keeps the original ID for edited retries and identical replay after a lost response', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockRejectedValueOnce(new ApiError('Response lost', 503))
      .mockRejectedValueOnce(new ApiError('Different values', 409))
      .mockResolvedValueOnce({ data: { payment: { id: 'payment-1' } } })
    const { result, invalidate } = setup()
    await act(async () => {
      await expect(result.current.mutateAsync(payment)).rejects.toMatchObject({
        status: 503,
      })
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['invoices'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders'] })
    await act(async () => {
      await expect(
        result.current.mutateAsync({ ...payment, amount: 30 }),
      ).rejects.toMatchObject({ status: 409 })
    })
    await act(async () => {
      await result.current.mutateAsync(payment)
    })
    const original = post.mock.calls[0][1] as { requestId: string }
    expect(original.requestId).toEqual(expect.any(String))
    expect(post.mock.calls[1][1]).toEqual({ ...original, amount: 30 })
    expect(post.mock.calls[2]).toEqual(post.mock.calls[0])
    expect(post.mock.calls[0][0]).toBe('/invoices/invoice-1/payments')
  })

  it('allows corrected input with the same ID when the first attempt failed', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockRejectedValueOnce(new ApiError('Too much', 400))
      .mockResolvedValueOnce({ data: {} })
    const { result } = setup()
    await act(async () => {
      await expect(result.current.mutateAsync(payment)).rejects.toMatchObject({
        status: 400,
      })
    })
    await act(async () => {
      await result.current.mutateAsync({ ...payment, amount: 10 })
    })
    expect(post.mock.calls[1][1]).toEqual({
      ...(post.mock.calls[0][1] as object),
      amount: 10,
    })
  })

  it('gives a new dialog a new payment ID', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} })
    const first = setup()
    await act(async () => {
      await first.result.current.mutateAsync(payment)
    })
    first.unmount()
    const second = setup()
    await act(async () => {
      await second.result.current.mutateAsync(payment)
    })
    const ids = post.mock.calls.map(
      ([, input]) => (input as { requestId: string }).requestId,
    )
    expect(ids[1]).not.toBe(ids[0])
  })
})
