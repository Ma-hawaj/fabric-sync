import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type {
  CreateRefundInput,
  CreateReturnInput,
  CreateCancellationInput,
  CancellationContext,
  ReturnContext,
} from '../types/returns'

export function useReturns(invoiceId: string | null) {
  return useQuery({
    queryKey: ['invoices', invoiceId, 'returns'],
    queryFn: async () => {
      const { data } = await apiClient.get<ReturnContext>(
        `/invoices/${invoiceId}/returns`,
      )
      return data
    },
    staleTime: 1000 * 60 * 5,
    enabled: invoiceId !== null,
  })
}

function useAdjustment<T>(path: string) {
  const client = useQueryClient()
  // Keep one ID for this dialog, including edits after an uncertain response.
  // A changed retry must conflict if the first attempt already committed.
  const requestId = useRef<string | null>(null)
  return useMutation({
    mutationFn: async (input: T) => {
      requestId.current ??= crypto.randomUUID()
      const { data } = await apiClient.post<{ id: string }>(path, {
        ...input,
        requestId: requestId.current,
      })
      return data
    },
    // A failed response can still mean the server committed the operation.
    // Refresh the history and stock even when the outcome was uncertain.
    onSettled: async () => {
      await Promise.all(
        [
          'invoices',
          'orders',
          'products',
          'materials',
          'invoice-material',
          'invoice-order-material',
          'gift-cards',
          'gift-card',
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      )
    },
  })
}

export function useCreateReturn(invoiceId: string) {
  return useAdjustment<CreateReturnInput>(`/invoices/${invoiceId}/returns`)
}

export function useCreateRefund(invoiceId: string) {
  return useAdjustment<CreateRefundInput>(`/invoices/${invoiceId}/refunds`)
}

export function useCancelOrder(orderId: string) {
  return useAdjustment<CreateCancellationInput>(`/orders/${orderId}/cancel`)
}

export function useCancellation(orderId: string | null) {
  return useQuery({
    queryKey: ['orders', orderId, 'cancellation'],
    queryFn: async () => {
      const { data } = await apiClient.get<CancellationContext>(
        `/orders/${orderId}/cancel`,
      )
      return data
    },
    enabled: orderId !== null,
    staleTime: 1000 * 60 * 5,
  })
}
