import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type {
  CreateRefundInput,
  CreateReturnInput,
  ReturnContext,
} from '../types/returns'

export function useReturns(invoiceId: string) {
  return useQuery({
    queryKey: ['invoices', invoiceId, 'returns'],
    queryFn: async () => {
      const { data } = await apiClient.get<ReturnContext>(
        `/invoices/${invoiceId}/returns`,
      )
      return data
    },
    staleTime: 1000 * 60 * 5,
  })
}

function useAdjustment<T>(invoiceId: string, endpoint: 'returns' | 'refunds') {
  const client = useQueryClient()
  // Retrying unchanged values after a lost response uses the same request ID.
  // Each dialog mounts a fresh hook for the next intentional operation.
  const requests = useRef(new Map<string, string>())
  return useMutation({
    mutationFn: async (input: T) => {
      const key = JSON.stringify(input)
      const requestId = requests.current.get(key) ?? crypto.randomUUID()
      requests.current.set(key, requestId)
      const { data } = await apiClient.post<{ id: string }>(
        `/invoices/${invoiceId}/${endpoint}`,
        { ...input, requestId },
      )
      return data
    },
    // A failed response can still mean the server committed the operation.
    // Refresh the history and stock even when the outcome was uncertain.
    onSettled: async () => {
      await Promise.all(
        ['invoices', 'orders', 'products', 'gift-cards', 'gift-card'].map(
          (key) => client.invalidateQueries({ queryKey: [key] }),
        ),
      )
    },
  })
}

export function useCreateReturn(invoiceId: string) {
  return useAdjustment<CreateReturnInput>(invoiceId, 'returns')
}

export function useCreateRefund(invoiceId: string) {
  return useAdjustment<CreateRefundInput>(invoiceId, 'refunds')
}
