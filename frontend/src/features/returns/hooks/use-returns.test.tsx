import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient, ApiError } from '@/lib/api'
import { useCancelOrder, useCreateRefund, useCreateReturn } from './use-returns'

type SubmittedAdjustment = { requestId: string; reason: string }

function useReturnSubmission() {
  const mutation = useCreateReturn('invoice-1')
  return (reason: string) =>
    mutation.mutateAsync({
      reason,
      lines: [{ lineId: 'product-1', quantity: 1, restock: false }],
      refund: { timing: 'later' },
    })
}

function useRefundSubmission() {
  const mutation = useCreateRefund('invoice-1')
  return (reason: string) =>
    mutation.mutateAsync({
      reason,
      amount: 10,
      paymentType: 'cash',
      giftCardId: null,
    })
}

function useCancellationSubmission() {
  const mutation = useCancelOrder('order-1')
  return (reason: string) =>
    mutation.mutateAsync({
      reason,
      retainedCharge: 0,
      restoredMaterialQuantity: 0,
      workChargeConfirmed: false,
      unusedMaterialConfirmed: false,
      refund: { timing: 'later' },
    })
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  )
}

afterEach(() => vi.restoreAllMocks())

describe.each([
  ['return', useReturnSubmission, '/invoices/invoice-1/returns'],
  ['refund', useRefundSubmission, '/invoices/invoice-1/refunds'],
  ['cancellation', useCancellationSubmission, '/orders/order-1/cancel'],
] as const)('%s request identity', (_name, useSubmit, path) => {
  it('preserves the ID for edited retries after an uncertain response and the original replay', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockRejectedValueOnce(new ApiError('Response lost', 503))
      .mockRejectedValueOnce(
        new ApiError('Already recorded with different values', 409),
      )
      .mockResolvedValueOnce({ data: { id: 'adjustment-1' } })
    const { result } = renderHook(useSubmit, { wrapper })
    await act(async () => {
      await expect(result.current('Original reason')).rejects.toMatchObject({
        status: 503,
      })
    })
    await act(async () => {
      await expect(result.current('Edited reason')).rejects.toMatchObject({
        status: 409,
      })
    })
    await act(async () => {
      await result.current('Original reason')
    })
    expect(post.mock.calls.map(([url]) => url)).toEqual([path, path, path])
    const payloads = post.mock.calls.map(
      ([, payload]) => payload as SubmittedAdjustment,
    )
    expect(payloads[1]).toEqual({ ...payloads[0], reason: 'Edited reason' })
    expect(payloads[2]).toEqual(payloads[0])
    expect(payloads[0].requestId).toEqual(expect.any(String))
  })

  it('allows corrected values with the same ID when the first attempt rolled back', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockRejectedValueOnce(new ApiError('Invalid values', 400))
      .mockResolvedValueOnce({ data: { id: 'adjustment-1' } })
    const { result } = renderHook(useSubmit, { wrapper })
    await act(async () => {
      await expect(result.current('Original reason')).rejects.toMatchObject({
        status: 400,
      })
    })
    await act(async () => {
      await result.current('Corrected reason')
    })
    const original = post.mock.calls[0][1] as SubmittedAdjustment
    expect(post.mock.calls[1][1]).toEqual({
      ...original,
      reason: 'Corrected reason',
    })
  })

  it('gives a newly opened dialog its own request ID', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ data: { id: 'adjustment-1' } })
    const first = renderHook(useSubmit, { wrapper })
    await act(async () => {
      await first.result.current('Same reason')
    })
    first.unmount()
    const second = renderHook(useSubmit, { wrapper })
    await act(async () => {
      await second.result.current('Same reason')
    })
    const ids = post.mock.calls.map(
      ([, payload]) => (payload as SubmittedAdjustment).requestId,
    )
    expect(ids[1]).not.toBe(ids[0])
  })
})
