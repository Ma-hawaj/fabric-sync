import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import { toCustomer } from '../types/customers'

interface MergeCustomerInput {
  sourceId: string
  targetId: string
}

export function useMergeCustomer() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ sourceId, targetId }: MergeCustomerInput) => {
      const { data } = await apiClient.post(`/customers/${sourceId}/merge`, {
        targetCustomerId: targetId,
      })
      return toCustomer(data)
    },
    onSuccess: () => {
      for (const key of [
        'customers',
        'orders',
        'repairs',
        'invoices',
        'gift-cards',
        'gift-card',
        'notifications',
        'invoice-customer',
        'merge-customer',
      ]) {
        void client.invalidateQueries({ queryKey: [key] })
      }
    },
  })
}
